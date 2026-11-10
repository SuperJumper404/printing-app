const crypto = require("node:crypto");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const { execFile } = require("node:child_process");
const express = require("express");
const fetch = require("node-fetch");
const { createDurableJobs } = require("./durableJobs");
const { migratePrinterConfigurations } = require("../printers/configMigration");
const { correlatePrinterObservations } = require("../printers/correlateDevices");
const { discoverWindowsPrinterObservations } = require("../printers/discovery/windows");
const { discoverNetworkPrinterObservations } = require("../printers/discovery/network");
const { dispatchEscPosJob, dispatchCashDrawerOpen, testPrinterTransports, quarantinePrinterResources } = require("../printers/dispatch");
const { createJobPoller } = require("../printers/jobPoller");
const { createPowerShellRunner } = require("../printers/powershell");
const { createWindowsRawSender } = require("../printers/transports/windowsRaw");
const { createSerialSender } = require("../printers/transports/serial");
const { createNetworkSender } = require("../printers/transports/network");
const { createIppSender } = require("../printers/transports/ipp");
const { createLprSender } = require("../printers/transports/lpr");
const { createEposHttpSender } = require("../printers/transports/eposHttp");
const { buildPrinterTestPayload } = require("../printers/testTicket");
const { resolvePrinterProfile } = require("../printers/printerProfiles");
const { decoratePrintHistoryEntry } = require("../printers/printHistoryText");
const { getPrimaryLocalIP } = require("../printers/localNetwork");
const { deviceMetadata, normalizeDeviceHex } = require("../printers/devicePermissions");
const { createTerminalService } = require("../terminals/service");
const { registerTerminalIpc } = require("../terminals/ipc");
const { registerTerminalRoutes } = require("../terminals/http");
const { createCaisseApProtocol } = require("../terminals/protocols/caisseAp");
const { createNeptingProtocol } = require("../terminals/protocols/nepting");
const { createTcpTransport } = require("../terminals/transports/tcp");
const { createSerialTransport } = require("../terminals/transports/serial");

function controlError(code, message) { return Object.assign(new Error(message), { code, publicMessage: message }); }
const COMPANION_CONTROL_MESSAGES = Object.freeze({
  BROKER_RESTARTED: "Le service a redémarré. Reconnexion du compagnon requise.",
  COMPANION_OWNER_MISMATCH: "Ce compagnon ne possède pas le pont matériel. Reconnexion requise.",
  COMPANION_BUSY: "Un autre compagnon utilise encore le pont matériel.",
  COMPANION_OFFLINE: "Le compagnon de session est absent. Ouvrez une session Windows.",
  COMPANION_UNAVAILABLE: "Le compagnon de session est indisponible.",
  DEVICE_BUSY: "Un envoi antérieur attend la libération du périphérique.",
  CONFIGURATION: "Configuration du compagnon invalide.",
});
function authenticated(header, expected) {
  const supplied = /^Bearer ([^\s]+)$/i.exec(String(header || ""))?.[1];
  if (!supplied || !expected) return false;
  const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();
  return crypto.timingSafeEqual(digest(supplied), digest(expected));
}

function createAgentRuntime(options = {}) {
  const { store, bridge, dataDir, version = "unknown", controlToken, publicPort = 8989, controlPort = 8990,
    publicHost = "0.0.0.0", discoveryIntervalMs = 30000, pollIntervalMs = 30000, fetchTimeoutMs = 15000,
    onError = () => {}, } = options;
  if (!store || !controlToken) throw new Error("Configuration du service incomplète");
  if (!options.controlTls && options.allowInsecureControlForTests !== true) throw new Error("TLS requis pour le contrôle du service");
  let running = false;
  let stopping = false;
  let publicServer;
  let controlServer;
  let actualPublicPort = publicPort;
  let actualControlPort = controlPort;
  let discoveryTimer;
  let discoveryPending;
  let discoveryGeneration = 0;
  let discoveryCycle = 0;
  let bonjour;
  const lifecycle = new AbortController();
  const powerShell = options.runPowerShell || createPowerShellRunner({ execFile });
  const serial = createSerialSender({ runPowerShell: powerShell });
  const senders = options.senders || {
    windowsRaw: createWindowsRawSender({ runPowerShell: powerShell }),
    network9100: createNetworkSender({ createSocket: () => new net.Socket() }),
    ipp: createIppSender(), lpr: createLprSender(), eposHttp: createEposHttpSender({ fetch }),
    usbSerial: serial, bluetoothSerial: serial,
    ...Object.fromEntries(["usbRaw", "usbHid", "bluetoothGatt"].map((id) => [id, {
      send({ printer, transport, base64Data, signal }) {
        if (!bridge?.request) throw Object.assign(new Error("Compagnon de session indisponible"), {
          code: "COMPANION_UNAVAILABLE", deliveryState: "not-sent", retryable: false,
        });
        return bridge.request(`${id}.send`, { config: transport.config, printerId: printer.id, base64Data }, id === "bluetoothGatt" ? 15000 : 10000, { signal });
      },
    }])),
  };
  const getPrinters = () => migratePrinterConfigurations(store.get("printers", []));
  const getHistory = () => store.get("printHistory", []).map(decoratePrintHistoryEntry);
  function addHistory(payload, result) {
    const history = store.get("printHistory", []);
    const previous = result.durableJobId ? history.find((entry) => entry.durableJobId === result.durableJobId) : null;
    const entry = { id: previous?.id || crypto.randomUUID(), durableJobId: result.durableJobId,
      printedAt: previous?.printedAt || new Date().toISOString(), ticketType: payload.ticketType || "unknown",
      status: result.status || (result.success ? "success" : "error"), printerCount: result.printerCount || 0,
      protocolCount: result.protocolCount || 0, transportCount: result.transportCount || 0,
      results: result.results || [], error: result.error || null, pending: Boolean(result.pending), payload };
    store.set("printHistory", [entry, ...history.filter((item) => item.id !== entry.id)].slice(0, 100));
    return decoratePrintHistoryEntry(entry);
  }
  const recoveries = new Set();
  function recoveryPrinters(payload = {}) {
    const printers = getPrinters();
    if (payload.printerId) {
      const exact = printers.filter((printer) => printer.id === payload.printerId);
      if (exact.length) return exact;
    }
    const expected = payload.config || {};
    const normalized = (value) => String(value || "").trim().toUpperCase();
    const matching = printers.filter((printer) => [printer, ...Object.values(printer.transports).map((transport) => transport.config)].some((config) => {
      if (expected.deviceId && config.deviceId === expected.deviceId) return true;
      if (expected.vendorId && expected.productId && expected.serialNumber &&
          normalizeDeviceHex(config.vendorId) === normalizeDeviceHex(expected.vendorId) &&
          normalizeDeviceHex(config.productId) === normalizeDeviceHex(expected.productId) &&
          String(config.serialNumber || "") === String(expected.serialNumber)) return true;
      if (expected.portName && normalized(config.portName).replace(/:$/, "") === normalized(expected.portName).replace(/:$/, "")) return true;
      if (expected.printerName && normalized(config.printerName) === normalized(expected.printerName)) return true;
      return expected.host && expected.port && normalized(config.host) === normalized(expected.host) && Number(config.port) === Number(expected.port);
    }));
    return matching.length ? matching : null;
  }
  function quarantineRecovery(cleanup, payload) {
    if (!cleanup || typeof quarantinePrinterResources !== "function") return;
    const printers = payload ? recoveryPrinters(payload) : null;
    for (const printer of printers || getPrinters()) quarantinePrinterResources(senders, printer, cleanup);
  }
  bridge?.setOnRecovery?.(({ cleanup, payload, operation }) => {
    const entry = { cleanup, payload, operation };
    recoveries.add(entry);
    quarantineRecovery(cleanup, payload);
    cleanup.then(() => recoveries.delete(entry), () => {});
  });
  function guardRecovery() {
    const pending = bridge?.recoveryCleanup?.();
    if (recoveries.size) for (const entry of recoveries) quarantineRecovery(entry.cleanup, entry.payload);
    else quarantineRecovery(pending);
  }
  const jobs = createDurableJobs({ store, shutdownTimeoutMs: options.shutdownTimeoutMs || 10000,
    retryIntervalMs: options.jobRetryIntervalMs || 30000, maxRetryAgeMs: options.jobMaxRetryAgeMs || 24 * 60 * 60 * 1000,
    onResult: async (payload, result) => ({ ...result, historyEntry: addHistory(payload, result) }),
    execute: async (payload, executionOptions) => {
      guardRecovery();
      const allPrinters = getPrinters();
      const selectedPrinters = executionOptions.retryTargets ? allPrinters.map((printer) => ({ ...printer,
        transports: Object.fromEntries(Object.entries(printer.transports).map(([id, transport]) => [id, { ...transport,
          enabled: transport.enabled && executionOptions.retryTargets.some((target) => target.printerId === printer.id && target.transportId === id),
        }])),
      })) : allPrinters;
      const result = payload.action === "open_cash_drawer"
        ? await dispatchCashDrawerOpen(selectedPrinters, senders, { ...executionOptions, ticketType: payload.ticketType || "caisse" })
        : await dispatchEscPosJob(payload, selectedPrinters, senders, executionOptions);
      return result;
    },
  });
  async function fetchJobs(session, { signal }) {
    const endpoint = store.get("pollingEndpoint", null);
    if (!endpoint) return [];
    if (options.fetchJobs) return options.fetchJobs(session, { signal, endpoint });
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(abort, fetchTimeoutMs);
    try {
      const response = await fetch(endpoint, { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ID: session.shopid }) });
      if (!response.ok) throw new Error("Récupération des tickets indisponible");
      const body = await response.json();
      return Array.isArray(body?.data) ? body.data : [];
    } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
  }
  const poller = createJobPoller({
    getSession: () => store.get("pollingEndpoint") ? store.get("userSession", null) : null,
    fetchJobs, intervalMs: pollIntervalMs, onError: () => onError("Récupération des tickets indisponible"),
    printJob: (job) => {
      const upstreamId = job.jobId ?? job.printingJobId ?? job.id ?? job.ID;
      const shopid = store.get("userSession.shopid");
      return jobs.submit(job, upstreamId === undefined ? {} : { dedupeKey: `poll:${shopid}:${upstreamId}` });
    },
  });
  const terminalService = options.terminalService || createTerminalService({ store,
    protocols: { "caisse-ap": createCaisseApProtocol(), nepting: createNeptingProtocol() },
    transports: { tcp: createTcpTransport(), serial: createSerialTransport() },
  });
  const terminalActions = new Map();
  registerTerminalIpc({ service: terminalService, ipc: {
    handle(name, handler) { terminalActions.set(name, handler); }, removeHandler(name) { terminalActions.delete(name); },
  } });

  async function defaultDiscover(discoveryOptions = {}) {
    const modes = { bluetooth: true, usb: true, com: true, ipScan: true, ...discoveryOptions.modes };
    const windows = process.platform === "win32" && (modes.bluetooth || modes.usb || modes.com)
      ? await discoverWindowsPrinterObservations(async (script) => {
        const output = await powerShell(script, {}, { signal: lifecycle.signal, timeoutMs: 20000 });
        if (!output) return [];
        const parsed = JSON.parse(output);
        return Array.isArray(parsed) ? parsed : [parsed];
      }, { useFilters: discoveryOptions.useFilters === true }) : [];
    const selected = windows.filter((observation) => {
      const transports = observation.transports || {};
      if (transports.bluetoothGatt || transports.bluetoothSerial) return modes.bluetooth;
      if (transports.usbRaw || transports.usbHid || transports.usbSerial) return modes.usb;
      const port = transports.windowsRaw?.config?.portName || "";
      return /BTH|Bluetooth/i.test(port) ? modes.bluetooth : /USB|DOT4/i.test(port) ? modes.usb : modes.com;
    });
    const saved = getPrinters();
    if (modes.ipScan && !bonjour) bonjour = require("bonjour")();
    const network = modes.ipScan ? await discoverNetworkPrinterObservations({ networkInterfaces: os.networkInterfaces(), bonjour,
      knownHosts: saved.flatMap((printer) => [...printer.addresses, ...Object.values(printer.transports).map((transport) => transport.config.host)]).filter(Boolean),
      knownEposHosts: saved.filter((printer) => printer.transports.eposHttp.enabled || printer.transports.eposHttp.verified)
        .map((printer) => printer.transports.eposHttp.config.host).filter(Boolean),
      cursor: discoveryCycle++, signal: lifecycle.signal,
    }) : [];
    const associations = getPrinters().map((printer) => ({ printerId: printer.id,
      observationIds: printer.observations.map((observation) => observation.observationId || observation.id).filter(Boolean) }));
    return correlatePrinterObservations([...selected, ...network], associations);
  }
  function discover(discoveryOptions = {}) {
    if (discoveryPending) return discoveryPending;
    const generation = discoveryGeneration;
    discoveryPending = (async () => {
      const detected = await (options.discoverPrinters || defaultDiscover)(discoveryOptions);
      if (stopping || generation !== discoveryGeneration) return getPrinters();
      const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
      if (stopping || generation !== discoveryGeneration) return getPrinters();
      const merged = mergeDiscoveredAndSavedPrinters(detected, getPrinters());
      store.set("printers", merged);
      return merged;
    })();
    discoveryPending.then(() => { discoveryPending = null; }, () => { discoveryPending = null; });
    return discoveryPending;
  }
  function scheduleDiscovery() {
    if (!running || discoveryIntervalMs <= 0) return;
    discoveryTimer = setTimeout(async () => {
      try { await discover(); } catch { onError("Recherche des imprimantes indisponible"); }
      scheduleDiscovery();
    }, discoveryIntervalMs);
    discoveryTimer.unref?.();
  }
  async function control(action, payload) {
    if (String(action).startsWith("companion:")) {
      if (!bridge?.control) throw controlError("COMPANION_UNAVAILABLE", "Compagnon de session indisponible");
      const wasOnline = bridge.status?.().online;
      const value = await bridge.control(action, payload);
      if (!wasOnline && bridge.status?.().online) jobs.retryPending({ wakeCompanion: true }).catch(() => onError("Reprise des impressions indisponible"));
      return value;
    }
    if (terminalActions.has(action)) return terminalActions.get(action)({}, payload);
    switch (action) {
      case "get-service-status": return status();
      case "get-app-version": return version;
      case "get-target-config": {
        const targetIp = getPrimaryLocalIP(os.networkInterfaces());
        return { targetIp, targetPort: actualPublicPort, targetBaseUrl: `http://${targetIp}:${actualPublicPort}` };
      }
      case "get-saved-printers": return getPrinters();
      case "save-printer-config":
        if (!Array.isArray(payload)) throw controlError("INVALID_CONFIGURATION", "Configuration des imprimantes invalide");
        store.set("printers", migratePrinterConfigurations(payload)); return { success: true };
      case "discover-printers": return discover(payload || {});
      case "get-user-session": return store.get("userSession", null);
      case "set-user-session": store.set("userSession", payload || null); poller.wake(); return { success: true };
      case "configure-print-polling": {
        if (!payload?.endpoint) return { success: true };
        let url;
        try { url = new URL(payload.endpoint); } catch { throw controlError("INVALID_CONFIGURATION", "Adresse de récupération invalide"); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw controlError("INVALID_CONFIGURATION", "Adresse de récupération invalide");
        store.set("pollingEndpoint", url.href); poller.wake(); return { success: true };
      }
      case "disable-print-polling": store.delete("pollingEndpoint"); poller.wake(); return { success: true };
      case "get-device-grants": return store.get("devicePermissionGrants", []);
      case "save-device-grant": {
        if (!["usb", "hid", "bluetooth"].includes(payload?.deviceType) || !payload.device) throw controlError("INVALID_CONFIGURATION", "Autorisation invalide");
        const grant = deviceMetadata(payload.deviceType, payload.device);
        const grants = store.get("devicePermissionGrants", []).filter((item) => !(item.deviceType === grant.deviceType &&
          ((grant.deviceId && item.deviceId === grant.deviceId) || (grant.serialNumber && item.serialNumber === grant.serialNumber && item.vendorId === grant.vendorId && item.productId === grant.productId))));
        store.set("devicePermissionGrants", [...grants, grant]); return { success: true };
      }
      case "get-print-history": return getHistory();
      case "get-durable-jobs": return jobs.list();
      case "retry-pending-jobs": return jobs.retryPending();
      case "print-job": return jobs.submit(payload || {});
      case "open-cash-drawer": return jobs.submit({ ...payload, action: "open_cash_drawer", ticketType: payload?.ticketType || "caisse" });
      case "reprint-ticket": {
        const entry = getHistory().find((item) => item.id === payload);
        if (!entry) throw controlError("NOT_FOUND", "Ticket introuvable dans l'historique");
        return jobs.submit(entry.payload);
      }
      case "test-printer":
      case "test-printer-protocols": {
        const printer = payload?.transports ? migratePrinterConfigurations([payload])[0]
          : getPrinters().find((item) => item.id === payload?.id || (payload?.ip && item.addresses.includes(payload.ip)));
        if (!printer) return { success: false, message: "Imprimante introuvable dans la configuration" };
        guardRecovery();
        const result = await testPrinterTransports(printer, buildPrinterTestPayload(printer, resolvePrinterProfile(printer)), senders, { signal: lifecycle.signal });
        return { ...result, message: result.success ? "Test transmis. Vérifiez le ticket sur l'imprimante." : result.error };
      }
      case "check-printer-online": return probeEndpoint(payload);
      case "check-usb-printer-online":
      case "check-bluetooth-printer-online":
      case "check-local-printer-online": return getPrinters().some((printer) => printer.id === payload?.id && Object.values(printer.transports).some((transport) => transport.available));
      case "purge-printer-data": discoveryGeneration += 1; store.set("printers", []); store.set("printHistory", []); return { success: true };
      default: throw controlError("UNKNOWN_ACTION", "Action de contrôle inconnue");
    }
  }
  function probeEndpoint({ ip, port } = {}) {
    if (!net.isIP(ip) || !Number.isInteger(Number(port)) || port < 1 || port > 65535) return Promise.resolve(false);
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const finish = (value) => { socket.destroy(); resolve(value); };
      socket.once("error", () => finish(false)); socket.once("close", () => finish(false));
      socket.setTimeout(1000, () => finish(false)); socket.connect(Number(port), ip, () => finish(true));
    });
  }
  function status() {
    const records = jobs.list();
    return { running, version, publicPort: actualPublicPort, controlPort: actualControlPort,
      companion: bridge?.status?.() || { online: false }, pollingConfigured: Boolean(store.get("pollingEndpoint")),
      jobs: { queued: records.filter((record) => record.state === "queued").length,
        waiting: records.filter((record) => record.state === "waiting").length,
        sending: records.filter((record) => record.state === "sending").length,
        unknown: records.filter((record) => record.state === "unknown").length,
        failed: records.filter((record) => record.state === "failed").length } };
  }
  const publicApp = express();
  publicApp.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); if (req.method === "OPTIONS") return res.sendStatus(204); next(); });
  publicApp.use(express.json({ limit: "10mb" }));
  publicApp.use(express.urlencoded({ extended: false, limit: "10mb" }));
  publicApp.get("/test", (_req, res) => res.json({ status: "ok", ip: getPrimaryLocalIP(os.networkInterfaces()), message: "SmartEat Agent en ligne" }));
  for (const route of ["/print", "/print-legacy", "/cash-drawer/open"]) publicApp.post(route, async (req, res) => {
    try {
      const payload = route === "/cash-drawer/open" ? { ...req.body, action: "open_cash_drawer", ticketType: req.body?.ticketType || "caisse" } : req.body;
      const result = await jobs.submit(payload || {});
      res.status(result.success ? 200 : 500).json({ ...result, message: result.success ? `Impression envoyée à ${result.transportCount || 0} transport(s)` : result.error });
    } catch { res.status(500).json({ success: false, error: "Impression indisponible. Vérifiez le journal des impressions." }); }
  });
  registerTerminalRoutes({ app: publicApp, service: terminalService, getSessionToken: () => store.get("userSession.token") });
  publicApp.use((_error, _req, res, _next) => res.status(400).json({ error: "Requête invalide" }));
  const controlApp = express();
  controlApp.use((req, res, next) => {
    if (req.headers.origin !== undefined || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "none")) return res.status(403).json({ ok: false, error: { code: "ORIGIN_FORBIDDEN", message: "Origine navigateur refusée" } });
    if (!authenticated(req.headers.authorization, controlToken)) return res.status(401).json({ ok: false, error: { code: "AUTHENTICATION_REQUIRED", message: "Authentification requise" } });
    next();
  });
  controlApp.use(express.json({ limit: "10mb" }));
  controlApp.post("/control", async (req, res) => {
    try { const value = await control(req.body?.action, req.body?.payload); res.json({ ok: true, value: value === undefined ? null : value }); }
    catch (error) {
      const companionMessage = String(req.body?.action).startsWith("companion:") && Object.hasOwn(COMPANION_CONTROL_MESSAGES, error.code)
        ? COMPANION_CONTROL_MESSAGES[error.code] : null;
      res.status(400).json({ ok: false, error: {
        code: companionMessage || error.publicMessage ? error.code : "CONTROL_FAILED",
        message: companionMessage || error.publicMessage || "Opération du service indisponible",
      } });
    }
  });
  controlApp.use((_error, _req, res, _next) => res.status(400).json({ ok: false, error: { code: "INVALID_REQUEST", message: "Requête invalide" } }));
  function listen(application, port, host, tls) {
    return new Promise((resolve, reject) => {
      const server = tls ? https.createServer(tls, application).listen(port, host) : application.listen(port, host);
      server.once("listening", () => resolve(server)); server.once("error", reject);
    });
  }
  function close(server) {
    if (!server) return Promise.resolve();
    return new Promise((resolve) => { server.close(resolve); server.closeIdleConnections?.(); server.closeAllConnections?.(); });
  }
  return { control, status,
    async start() {
      if (running) return status();
      if (stopping) throw controlError("STOPPED", "Le service est arrêté");
      try {
        publicServer = await listen(publicApp, publicPort, publicHost);
        actualPublicPort = publicServer.address().port;
        controlServer = await listen(controlApp, controlPort, "127.0.0.1", options.controlTls);
        actualControlPort = controlServer.address().port;
        running = true;
        jobs.start().catch(() => onError("Récupération des impressions interrompue"));
        poller.start();
        if (discoveryIntervalMs > 0) discover().catch(() => onError("Recherche des imprimantes indisponible"));
        scheduleDiscovery();
        return status();
      } catch (error) { await Promise.all([close(publicServer), close(controlServer)]); throw error; }
    },
    async stop() {
      if (stopping) return;
      stopping = true; running = false; discoveryGeneration += 1;
      clearTimeout(discoveryTimer); lifecycle.abort(); poller.stop();
      await jobs.stop();
      await bridge?.stop?.();
      bonjour?.destroy?.();
      await Promise.all([close(publicServer), close(controlServer)]);
    },
  };
}

module.exports = { createAgentRuntime };
