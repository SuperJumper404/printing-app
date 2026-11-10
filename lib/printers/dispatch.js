const { TRANSPORT_IDS } = require("./deviceModel");
const { prepareEscPosPayload } = require("./escposCompatibility");
const { resolvePrinterProfile } = require("./printerProfiles");
const { formatPrintError } = require("./errors");
const {
  renderTicketDataEposXml,
  renderTicketDataEscPos,
  validateTicketData,
} = require("./ticketDataRenderer");

const CASH_DRAWER_KICK_BASE64 = Buffer.from([
  0x1b,
  0x70,
  0x00,
  0x19,
  0xfa,
]).toString("base64");

function enabledAttempts(printers, ticketType) {
  const attempts = [];
  for (const printer of printers || []) {
    if (ticketType && !printer.ticketTypes?.[ticketType]) continue;
    for (const transportId of TRANSPORT_IDS) {
      const transport = printer.transports?.[transportId];
      if (transport?.enabled) attempts.push({ printer, transportId, transport });
    }
  }
  return attempts;
}

function failure(error) {
  return {
    success: false,
    printerCount: 0,
    transportCount: 0,
    protocolCount: 0,
    results: [],
    error,
  };
}

function buildReceivedPayload(attempt, base64Data) {
  return {
    base64Data: prepareEscPosPayload(base64Data, resolvePrinterProfile(attempt.printer)),
  };
}

function buildTicketDataPayload(attempt, ticketData) {
  const profile = resolvePrinterProfile(attempt.printer);
  if (attempt.transportId === "eposHttp") {
    return {
      xmlData: renderTicketDataEposXml(ticketData, profile),
    };
  }

  return {
    base64Data: prepareEscPosPayload(
      renderTicketDataEscPos(ticketData, profile),
      { ...profile, encoding: "raw" },
    ),
  };
}

function buildAttemptPayload(attempt, job, receivedBase64Data) {
  if (attempt.printer.ticketSource === "ticketData") {
    return buildTicketDataPayload(attempt, job.ticketData);
  }
  if (!receivedBase64Data) return null;
  return buildReceivedPayload(attempt, receivedBase64Data);
}

// Shared by real jobs, test tickets and drawer commands using the same sender set.
const coordinators = new WeakMap();
const quarantines = new WeakMap();
function quarantineMap(senders) {
  if (!quarantines.has(senders)) quarantines.set(senders, new Map());
  return quarantines.get(senders);
}
function resourceKeys({ printer, transportId, transport }) {
  const config = transport?.config || {};
  const keys = [`printer:${printer.id}`];
  if (printer.containerId) keys.push(`container:${printer.containerId}`);
  if (config.host) keys.push(`host:${String(config.host).toLowerCase()}`);
  if (config.portName) keys.push(`port:${String(config.portName).replace(/:$/, "").toUpperCase()}`);
  if (config.printerName) keys.push(`queue:${String(config.printerName).toLowerCase()}`);
  if (config.deviceId) keys.push(`device:${config.deviceId}`);
  if (["usbRaw", "usbHid"].includes(transportId)) {
    keys.push(`usb:${config.vendorId || printer.vendorId}:${config.productId || printer.productId}:${config.serialNumber || printer.serialNumber || "ambiguous"}`);
  }
  return keys;
}

function quarantinePrinterResources(senders, printer, cleanup) {
  if (!cleanup || typeof cleanup.then !== "function") return;
  const map = quarantineMap(senders);
  const keys = printer ? Object.entries(printer.transports || {}).flatMap(([transportId, transport]) => resourceKeys({ printer, transportId, transport })) : ["*"];
  for (const key of new Set(keys)) {
    const previous = map.get(key);
    const barrier = previous && previous !== cleanup ? Promise.all([previous, cleanup]) : cleanup;
    map.set(key, barrier);
    barrier.then(() => { if (map.get(key) === barrier) map.delete(key); }, () => {});
  }
}

function enqueue(senders, attempts, run) {
  let locks = coordinators.get(senders);
  if (!locks) { locks = new Map(); coordinators.set(senders, locks); }
  const keys = [...new Set(attempts.flatMap(resourceKeys))];
  const previous = [...new Set(keys.map(key => locks.get(key)).filter(Boolean))];
  const pending = Promise.all(previous.map(promise => promise.catch(() => {}))).then(run);
  keys.forEach(key => locks.set(key, pending));
  const cleanup = () => keys.forEach(key => { if (locks.get(key) === pending) locks.delete(key); });
  pending.then(cleanup, cleanup);
  return pending;
}

async function sendAttempt(attempt, senders, options) {
  const { printer, transportId, transport, payload, preparationError } = attempt;
  const sender = senders?.[transportId];
  const result = { printerId: printer.id, transportId, success: false, attemptCount: 0 };
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let index = 0; index < 3; index++) {
    result.attemptCount++;
    try {
      if (quarantineMap(senders).has("*") || resourceKeys(attempt).some(key => quarantineMap(senders).has(key))) {
        throw Object.assign(new Error("Périphérique en cours de libération"), { code: "DEVICE_BUSY", deliveryState: "not-sent", retryable: true });
      }
      if (preparationError) throw preparationError;
      if (!sender?.send) throw Object.assign(new Error("Transport non pris en charge"), { code: "CONFIGURATION" });
      await sender.send({ printer, transport, transportId, ...payload, signal: options.signal });
      return { ...result, success: true, deliveryState: "submitted" };
    } catch (error) {
      if (error.cleanup && typeof error.cleanup.then === "function") {
        quarantinePrinterResources(senders, printer, error.cleanup);
      }
      const retry = error.retryable === true && error.code !== "DEVICE_BUSY" && error.deliveryState === "not-sent" && index < 2 && !options.signal?.aborted;
      if (retry) { await delay([500, 1500][index]); continue; }
      return {
        ...result,
        error: preparationError ? preparationError.message : formatPrintError(error),
        code: error.code || "PRINT_FAILED",
        deliveryState: error.deliveryState || "unknown",
        retryable: error.retryable === true,
        ...(error.action ? { action: error.action } : {}),
      };
    }
  }
}

async function runSendableAttempts(sendableAttempts, senders, options = {}) {
  const groups = new Map();
  for (const attempt of sendableAttempts) {
    if (!groups.has(attempt.printer.id)) groups.set(attempt.printer.id, []);
    groups.get(attempt.printer.id).push(attempt);
  }
  const entries = await Promise.all([...groups.values()].map(attempts => enqueue(senders, attempts, async () => {
    const results = [];
    for (const attempt of attempts) results.push(await sendAttempt(attempt, senders, options));
    return results;
  })));
  const results = entries.flat();
  const success = results.some((result) => result.success);
  const allSucceeded = results.every((result) => result.success);
  const partial = success && !allSucceeded;
  const printerCount = new Set(sendableAttempts.map(({ printer }) => printer.id)).size;

  return {
    success,
    allSucceeded,
    partial,
    status: allSucceeded ? "success" : partial ? "partial" : results.some(result => result.deliveryState === "unknown") ? "unknown" : "error",
    printerCount,
    transportCount: sendableAttempts.length,
    protocolCount: sendableAttempts.length,
    results,
    ...(allSucceeded
      ? {}
      : { error: results.map((result) => result.error).filter(Boolean).join("; ") }),
  };
}

async function runAttempts(attempts, job, senders, options) {
  if (!attempts.length) return failure("Aucun transport actif pour cette impression");

  const receivedBase64Data = job?.dataFormatESCPOS || job?.base64Data;
  const sendableAttempts = attempts
    .map((attempt) => {
      try {
        if (attempt.printer.ticketSource === "ticketData") {
          const validation = validateTicketData(job?.ticketData);
          if (!validation.valid) throw new Error(`ticketData invalide : ${validation.error}`);
        } else if (!receivedBase64Data) throw new Error("Données ESC/POS manquantes");
        return { ...attempt, payload: buildAttemptPayload(attempt, job, receivedBase64Data) };
      } catch (error) {
        return { ...attempt, preparationError: Object.assign(error, { code: "CONFIGURATION", deliveryState: "not-sent" }) };
      }
    });

  if (!sendableAttempts.length) return failure("Aucun transport compatible pour cette impression");

  return runSendableAttempts(sendableAttempts, senders, options);
}

async function dispatchEscPosJob(job, printers, senders, options = {}) {
  return runAttempts(enabledAttempts(printers, job?.ticketType), job, senders, options);
}

async function testPrinterTransports(printer, base64Data, senders, options = {}) {
  return runAttempts(
    enabledAttempts([{ ...printer, ticketSource: "received" }]),
    { dataFormatESCPOS: base64Data },
    senders,
    options,
  );
}

async function dispatchCashDrawerOpen(printers, senders, options = {}) {
  const ticketType = options.ticketType || "caisse";
  const attempts = enabledAttempts(printers, ticketType);
  if (!attempts.length) return failure("Aucun transport actif pour le tiroir caisse");

  return runSendableAttempts(
    attempts.map((attempt) => ({
      ...attempt,
      payload: { base64Data: CASH_DRAWER_KICK_BASE64 },
    })),
    senders,
    options,
  );
}

module.exports = {
  CASH_DRAWER_KICK_BASE64,
  dispatchCashDrawerOpen,
  dispatchEscPosJob,
  testPrinterTransports,
  quarantinePrinterResources,
};
