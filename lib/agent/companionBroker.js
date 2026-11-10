const crypto = require("node:crypto");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { createDeviceBridgeClient, REQUEST_CHANNEL, RESPONSE_CHANNEL, CANCEL_CHANNEL } = require("../printers/deviceBridgeClient");

function companionError(code, message, { retryable = false, deliveryState = "not-sent", cleanup } = {}) {
  return Object.assign(new Error(message), { code, retryable, deliveryState, ...(cleanup ? { cleanup } : {}) });
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

function readProcessIdentity(pid, options) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if ((options.platform || process.platform) === "win32") {
    const script = "$ErrorActionPreference = 'Stop'\ntry { $companionProcess = [System.Diagnostics.Process]::GetProcessById([int]$env:SMARTEAT_COMPANION_PROCESS_ID) } catch [System.ArgumentException] { exit 0 }\n$companionProcess.StartTime.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)";
    return String((options.execFileSync || execFileSync)("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      windowsHide: true, timeout: 3000, encoding: "utf8", maxBuffer: 4096,
      env: { ...process.env, SMARTEAT_COMPANION_PROCESS_ID: String(pid) },
    })).trim() || null;
  }
  // Linux is useful for isolated worker tests; include the boot ID as PID/start
  // counters can both be reused after a machine restart.
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const startTicks = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/)[19];
    const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (!/^\d+$/.test(startTicks || "") || !bootId) throw new Error("Process start identity unavailable");
    return `${bootId}:${startTicks}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function recoveryPayload(payload = {}) {
  const allowed = ["vendorId", "productId", "serialNumber", "productName", "configurationValue", "interfaceNumber", "alternateSetting", "endpointNumber", "packetSize", "reportId", "padReports", "deviceId", "name", "serviceUuid", "characteristicUuid", "maxChunkSize"];
  const config = Object.fromEntries(allowed.filter((key) => payload.config?.[key] !== undefined).map((key) => [key, payload.config[key]]));
  return { config, ...(payload.printerId ? { printerId: payload.printerId } : {}) };
}

function recoveryOverlaps(entry, operation, payload) {
  const previous = entry.payload || {};
  if (previous.printerId && previous.printerId === payload.printerId) return true;
  const hardware = (operation_, payload_) => {
    const config = payload_.config || {};
    if (config.vendorId || config.productId || config.serialNumber) {
      const hex = (value) => value ? Number.parseInt(value, 16).toString(16) : "";
      return ["usb", hex(config.vendorId), hex(config.productId), config.serialNumber || ""];
    }
    if (config.deviceId || (operation_?.startsWith("bluetooth") && config.name)) return ["bluetooth", config.deviceId || "", config.name || ""];
    return null;
  };
  const first = hardware(entry.operation, previous);
  const second = hardware(operation, payload);
  if (first && second) {
    if (first[0] !== second[0]) return false;
    if (first[0] === "bluetooth") {
      if (first[1] && second[1]) return first[1] === second[1];
      return !first[2] || !second[2] || first[2] === second[2];
    }
    return first.slice(1).every((value, index) => !value || !second[index + 1] || value === second[index + 1]);
  }
  if (previous.printerId && payload.printerId) return previous.printerId === payload.printerId;
  // Missing physical and logical identities cannot safely prove independence.
  return true;
}

function createCompanionBroker(options = {}) {
  const clock = typeof options.clock === "function" ? options.clock : () => Date.now();
  const leaseMs = Math.max(1, Number(options.leaseMs) || 15000);
  const identityCheckIntervalMs = Math.max(1, Number(options.identityCheckIntervalMs) || 5000);
  const isProcessAlive = options.isProcessAlive || processIsAlive;
  const getProcessIdentity = options.getProcessIdentity || ((pid) => readProcessIdentity(pid, options));
  const lookupIdentity = (pid) => {
    const identity = getProcessIdentity(pid);
    if (identity === null) return null;
    if (typeof identity !== "string" || !identity.trim() || identity.length > 200) throw new Error("Process creation identity unavailable");
    return identity.trim();
  };
  const brokerId = options.brokerId || crypto.randomUUID();
  let onRecovery = options.onRecovery;
  let owner = null;
  let stopped = false;

  const persist = (session = owner) => {
    if (!options.stateStore) return;
    options.stateStore.set("companionState", session ? {
      instanceId: session.instanceId, processId: session.processId, processIdentity: session.processIdentity,
      requests: [...session.requests.entries()].map(([requestId, entry]) => ({ requestId, brokerId, operation: entry.operation, payload: recoveryPayload(entry.payload) })),
    } : null);
  };

  const offline = () => companionError("COMPANION_OFFLINE", "Le compagnon de session est absent. Ouvrez une session Windows pour ce transport.", { retryable: true });
  const isOnline = () => !stopped && Boolean(owner?.connected && clock() < owner.leaseExpiresAt);
  const currentRecovery = () => [...(owner?.requests.values() || [])].filter((entry) => entry.recovered);
  const refreshOwnerLiveness = () => {
    if (!owner) return;
    if (!isProcessAlive(owner.processId)) { endOwner(); return; }
    if (!owner.processIdentity || !currentRecovery().length || clock() < owner.leaseExpiresAt || clock() < owner.nextIdentityCheckAt) return;
    owner.nextIdentityCheckAt = clock() + identityCheckIntervalMs;
    try { if (lookupIdentity(owner.processId) !== owner.processIdentity) endOwner(); } catch {}
  };
  const recoveryCleanup = () => {
    refreshOwnerLiveness();
    const entries = currentRecovery();
    return entries.length ? Promise.all(entries.map((entry) => entry.cleanup)) : null;
  };

  const endOwner = () => {
    if (!owner) return;
    const previous = owner;
    owner = null;
    previous.webContents.emit("destroyed");
    previous.bridge.dispose();
    for (const entry of previous.requests.values()) entry.resolveCleanup?.();
    previous.requests.clear();
    previous.commands.clear();
    persist();
  };

  function makeOwner(instanceId, processId, processIdentity = null) {
    const ipc = new EventEmitter();
    const webContents = new EventEmitter();
    const session = { instanceId, processId, processIdentity, identityVerified: Boolean(processIdentity), nextIdentityCheckAt: clock() + identityCheckIntervalMs, connected: true, leaseExpiresAt: clock() + leaseMs, ipc, webContents, requests: new Map(), commands: new Map() };
    webContents.isDestroyed = () => owner !== session;
    webContents.send = (channel, message) => {
      if (channel === REQUEST_CHANNEL) {
        session.requests.set(message.requestId, { operation: message.operation, payload: recoveryPayload(message.payload), cancelled: false });
        // Never deliver a hardware request that cannot be recovered after a crash.
        try { persist(session); }
        catch (error) { session.requests.delete(message.requestId); throw error; }
      }
      const commandId = crypto.randomUUID();
      session.commands.set(commandId, { commandId, channel, message });
      if (channel === CANCEL_CHANNEL) {
        const entry = session.requests.get(message.requestId);
        if (entry) entry.cancelled = true;
      }
    };
    session.bridge = createDeviceBridgeClient(webContents, { ipc, timeoutMs: options.timeoutMs, setTimer: options.setTimer, clearTimer: options.clearTimer });
    return session;
  }

  function adopt(session, pending) {
    let resolveCleanup;
    const cleanup = new Promise((resolve) => { resolveCleanup = resolve; });
    const entry = { operation: pending.operation, payload: recoveryPayload(pending.payload), recovered: true, cancelled: true, cleanup, resolveCleanup };
    session.requests.set(pending.requestId, entry);
    session.webContents.send(CANCEL_CHANNEL, { requestId: pending.requestId });
    return entry;
  }

  function validateIdentity(payload) {
    if (typeof payload.instanceId !== "string" || !payload.instanceId.trim() || payload.instanceId.length > 200) {
      throw companionError("CONFIGURATION", "Identité du compagnon invalide.");
    }
  }

  function requireOwner(payload) {
    if (payload.brokerId !== brokerId) throw companionError("BROKER_RESTARTED", "Le service a redémarré. Reconnexion du compagnon requise.");
    if (!owner || owner.instanceId !== payload.instanceId) throw companionError("COMPANION_OWNER_MISMATCH", "Ce compagnon ne possède pas le pont matériel.");
    return owner;
  }

  function verifiedBirth(processId) {
    let identity;
    try { identity = lookupIdentity(processId); }
    catch { throw companionError("COMPANION_IDENTITY_UNAVAILABLE", "Impossible de vérifier le processus du compagnon. Réessayez la connexion."); }
    if (identity === null) throw offline();
    if (typeof identity !== "string" || !identity.trim() || identity.length > 200) throw companionError("COMPANION_IDENTITY_UNAVAILABLE", "Identité de création du processus indisponible.");
    return identity.trim();
  }

  async function poll(payload) {
    validateIdentity(payload);
    const processId = Number(payload.processId);
    if (!Number.isInteger(processId) || processId <= 0) throw companionError("CONFIGURATION", "Processus du compagnon invalide.");
    if (owner && owner.instanceId !== payload.instanceId) {
      let dead = !isProcessAlive(owner.processId);
      // A live PID may now belong to a different process. Only query creation
      // time during startup/ownership changes, not on normal heartbeats.
      if (!dead && owner.processIdentity && !isOnline()) {
        try { dead = lookupIdentity(owner.processId) !== owner.processIdentity; } catch {}
      }
      const idleExpired = owner.requests.size === 0 && clock() >= owner.leaseExpiresAt;
      if (!dead && !idleExpired) throw companionError("COMPANION_BUSY", "Un autre compagnon possède encore le périphérique.");
      endOwner();
    }
    if (!owner) {
      if (stopped) throw offline();
      owner = makeOwner(payload.instanceId, processId, verifiedBirth(processId));
      persist();
    } else if (owner.processId !== processId) {
      throw companionError("COMPANION_OWNER_MISMATCH", "L'identité du processus compagnon a changé.");
    }
    if (!owner.identityVerified) {
      const identity = verifiedBirth(processId);
      if (owner.processIdentity && owner.processIdentity !== identity) {
        endOwner();
        owner = makeOwner(payload.instanceId, processId, identity);
      } else {
        // This supports only the never-shipped internal metadata format. A live
        // PID alone does not release legacy writes; its original instance must
        // reconnect before creation identity can be established.
        owner.processIdentity = identity;
        owner.identityVerified = true;
      }
      persist();
    }
    const session = owner;
    for (const commandId of payload.acknowledged || []) session.commands.delete(commandId);
    // The desktop survives a service restart. Its native writes must finish before
    // the new service may use another protocol for those physical printers.
    for (const pending of (payload.activeRequests || []).slice(0, 1000)) {
      if (!pending || typeof pending.requestId !== "string" || !pending.brokerId || pending.brokerId === brokerId || session.requests.has(pending.requestId)) continue;
      const entry = adopt(session, pending);
      persist(session);
      if (onRecovery) await onRecovery({ operation: entry.operation, payload: entry.payload, cleanup: entry.cleanup });
    }
    session.connected = true;
    session.leaseExpiresAt = clock() + leaseMs;
    return { brokerId, leaseMs, commands: [...session.commands.values()].slice(0, 100) };
  }

  const saved = options.stateStore?.get("companionState", null);
  if (saved) {
    if (typeof saved.instanceId !== "string" || !Number.isInteger(saved.processId) || saved.processId <= 0 || !Array.isArray(saved.requests) || (saved.processIdentity !== undefined && saved.processIdentity !== null && (typeof saved.processIdentity !== "string" || !saved.processIdentity.trim() || saved.processIdentity.length > 200))) {
      throw companionError("CONFIGURATION", "État persistant du compagnon invalide.");
    }
    let ended = !isProcessAlive(saved.processId);
    let identityVerified = false;
    if (!ended && saved.processIdentity) {
      try {
        ended = lookupIdentity(saved.processId) !== saved.processIdentity;
        identityVerified = !ended;
      } catch {}
    }
    if (ended) persist(null);
    else {
      owner = makeOwner(saved.instanceId, saved.processId, saved.processIdentity || null);
      owner.identityVerified = identityVerified;
      owner.connected = false;
      owner.leaseExpiresAt = 0;
      for (const pending of saved.requests) {
        if (typeof pending?.requestId !== "string" || !pending.requestId || typeof pending.operation !== "string") throw companionError("CONFIGURATION", "Envoi persistant du compagnon invalide.");
        const entry = adopt(owner, pending);
        if (onRecovery) onRecovery({ operation: entry.operation, payload: entry.payload, cleanup: entry.cleanup });
      }
    }
  }

  return {
    request(operation, payload = {}, timeoutMs, { signal } = {}) {
      refreshOwnerLiveness();
      if (!isOnline()) return Promise.reject(offline());
      const overlapping = currentRecovery().filter((entry) => recoveryOverlaps(entry, operation, payload));
      if (overlapping.length) return Promise.reject(companionError("DEVICE_BUSY", "Un envoi antérieur attend la libération du compagnon.", { retryable: true, cleanup: Promise.all(overlapping.map((entry) => entry.cleanup)) }));
      return owner.bridge.request(operation, payload, timeoutMs, { signal });
    },

    async control(action, payload = {}) {
      if (action === "companion:poll") return poll(payload);
      if (action === "companion:respond") {
        const session = requireOwner(payload);
        const response = payload.response || {};
        if (typeof response.requestId !== "string" || typeof response.success !== "boolean") throw companionError("CONFIGURATION", "Réponse du compagnon invalide.");
        const entry = session.requests.get(response.requestId);
        if (!entry) return { accepted: true, brokerId };
        const completed = response.cleanupComplete !== false && (!entry.cancelled || (response.cancelled === true && response.cleanupComplete === true));
        if (completed) {
          session.requests.delete(response.requestId);
          try { persist(session); }
          catch (error) { session.requests.set(response.requestId, entry); throw error; }
          for (const [id, command] of session.commands) if (command.message.requestId === response.requestId) session.commands.delete(id);
        }
        if (entry.recovered) {
          if (completed) entry.resolveCleanup();
        } else session.ipc.emit(RESPONSE_CHANNEL, { sender: session.webContents }, response);
        if (response.cleanupComplete === false) entry.cancelled = true;
        return { accepted: true, brokerId };
      }
      if (action === "companion:disconnect") {
        if (payload.ended === true && !owner) return { accepted: true, brokerId };
        // A renderer can end during a service outage. Its authenticated main may
        // still know only the previous broker ID; match both persisted owner IDs.
        const endedRestoredOwner = payload.ended === true && owner?.instanceId === payload.instanceId && owner.processId === Number(payload.processId);
        const session = endedRestoredOwner ? owner : requireOwner(payload);
        session.connected = false;
        session.leaseExpiresAt = 0;
        // This flag is supplied only by the authenticated desktop main after it
        // observes renderer destruction, never after a loopback/network timeout.
        if (payload.ended === true) endOwner();
        return { accepted: true, brokerId };
      }
      throw companionError("CONFIGURATION", "Commande du compagnon inconnue.");
    },

    status() {
      return { online: isOnline(), instanceId: owner?.instanceId || null, leaseExpiresAt: owner?.leaseExpiresAt || 0, pendingCount: owner?.requests.size || 0, recoveringCount: currentRecovery().length };
    },

    recoveryCleanup,

    setOnRecovery(handler) {
      onRecovery = handler;
      if (handler) for (const entry of currentRecovery()) handler({ operation: entry.operation, payload: entry.payload || {}, cleanup: entry.cleanup });
    },

    stop() {
      if (stopped) return;
      stopped = true;
      if (owner) {
        owner.connected = false;
        owner.leaseExpiresAt = 0;
        // Disposing cancels requests but deliberately preserves their cleanup
        // barriers. A stopping service is not proof that its desktop has stopped.
        owner.bridge.dispose();
      }
    },
  };
}

module.exports = { createCompanionBroker };
