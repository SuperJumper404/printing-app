const crypto = require("node:crypto");

const REQUEST_CHANNEL = "printer-device-request";
const RESPONSE_CHANNEL = "printer-device-response";
const CANCEL_CHANNEL = "printer-device-cancel";

function bridgeError(message, code, deliveryState = "unknown") {
  return Object.assign(new Error(message), { code, retryable: false, deliveryState });
}

function toBridgeError(details) {
  const source = typeof details === "string" ? { message: details } : details || {};
  const error = bridgeError(source.message || "Erreur du transport périphérique", source.code || "PRINT_FAILED", source.deliveryState || "unknown");
  if (source.name) error.name = source.name;
  for (const [key, value] of Object.entries(source)) {
    if (key !== "message" && key !== "name") error[key] = value;
  }
  return error;
}

function deviceKey(operation, payload) {
  const config = payload?.config || {};
  if (config.vendorId || config.productId || config.serialNumber) {
    // USB and HID can address the same physical device.
    const hardwareId = (value) => value ? Number.parseInt(value, 16).toString(16) : "";
    return JSON.stringify(["usb", hardwareId(config.vendorId), hardwareId(config.productId), config.serialNumber || ""]);
  }
  if (config.deviceId || config.name) return JSON.stringify(["device", config.deviceId || "", config.name || ""]);
  return "*";
}

function keysOverlap(first, second) {
  if (first === "*" || second === "*" || first === second) return true;
  const left = JSON.parse(first);
  const right = JSON.parse(second);
  if (left[0] !== right[0]) return false;
  if (left[0] === "device") {
    if (left[1] && right[1]) return left[1] === right[1];
    return !left[2] || !right[2] || left[2] === right[2];
  }
  // A missing HID serial number must not bypass an active USB cancellation.
  return left.slice(1).every((value, index) => !value || !right[index + 1] || value === right[index + 1]);
}

function createDeviceBridgeClient(webContents, options = {}) {
  const ipc = options.ipc;
  if (!ipc?.on || !ipc?.off) throw new Error("Un emetteur IPC est requis");
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const defaultTimeoutMs = Number(options.timeoutMs) || 5000;
  const pending = new Map();
  let disposed = false;
  let destroyed = false;

  const removeListeners = (entry) => {
    clearTimer(entry.timer);
    entry.signal?.removeEventListener("abort", entry.onAbort);
  };

  const cancel = (requestId, entry, code) => {
    if (entry.cancelled || !pending.has(requestId)) return;
    entry.cancelled = true;
    removeListeners(entry);
    // Keep the device quarantined until every write and cleanup operation has ended.
    // A lost acknowledgement deliberately requires the renderer to be restarted.
    const error = bridgeError(code === "TIMEOUT" ? `Délai dépassé pour ${entry.operation}` : "Envoi périphérique annulé", code);
    error.cleanup = entry.cleanup;
    entry.reject(error);
    try { webContents.send(CANCEL_CHANNEL, { requestId }); } catch {}
  };

  const rejectPending = (message) => {
    for (const entry of pending.values()) {
      removeListeners(entry);
      entry.resolveCleanup();
      if (!entry.cancelled) entry.reject(bridgeError(message, "BRIDGE_CLOSED"));
    }
    pending.clear();
  };

  const detachListeners = () => {
    ipc.off(RESPONSE_CHANNEL, onResponse);
    webContents.off("destroyed", onDestroyed);
  };

  const onResponse = (event, response = {}) => {
    if (event?.sender && event.sender !== webContents) return;
    const entry = pending.get(response.requestId);
    if (!entry) return;
    if (entry.cancelled && !(response.cancelled && response.cleanupComplete)) return;
    if (!entry.cancelled && response.cleanupComplete === false) {
      removeListeners(entry);
      entry.cancelled = true;
      const error = toBridgeError(response.error);
      error.cleanup = entry.cleanup;
      entry.reject(error);
      return;
    }
    pending.delete(response.requestId);
    removeListeners(entry);
    entry.resolveCleanup();
    if (disposed && pending.size === 0) detachListeners();
    if (entry.cancelled) return;
    if (response.success) entry.resolve(response.result);
    else entry.reject(toBridgeError(response.error));
  };

  const onDestroyed = () => {
    destroyed = true;
    rejectPending("La fenêtre périphérique a été fermée");
    detachListeners();
  };
  ipc.on(RESPONSE_CHANNEL, onResponse);
  webContents.once("destroyed", onDestroyed);

  return {
    request(operation, payload = {}, timeoutMs = defaultTimeoutMs, { signal } = {}) {
      if (disposed || destroyed || webContents.isDestroyed?.()) {
        return Promise.reject(bridgeError("La fenêtre périphérique a été fermée", "BRIDGE_CLOSED", "not-sent"));
      }
      if (signal?.aborted) return Promise.reject(bridgeError("Envoi périphérique annulé", "ABORTED", "not-sent"));
      const key = deviceKey(operation, payload);
      const blocked = [...pending.values()].filter((entry) => entry.cancelled && keysOverlap(key, entry.key));
      if (blocked.length) {
        const error = bridgeError("Le précédent envoi attend la libération du périphérique. Patientez ou redémarrez l'application.", "DEVICE_BUSY", "not-sent");
        error.cleanup = Promise.all(blocked.map((entry) => entry.cleanup));
        return Promise.reject(error);
      }
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const entry = { resolve, reject, operation, key, signal, cancelled: false };
        entry.cleanup = new Promise((resolveCleanup) => { entry.resolveCleanup = resolveCleanup; });
        entry.onAbort = () => cancel(requestId, entry, "ABORTED");
        pending.set(requestId, entry);
        signal?.addEventListener("abort", entry.onAbort, { once: true });
        entry.timer = setTimer(() => cancel(requestId, entry, "TIMEOUT"), Number(timeoutMs) > 0 ? Number(timeoutMs) : defaultTimeoutMs);
        try { webContents.send(REQUEST_CHANNEL, { requestId, operation, payload }); }
        catch (error) {
          pending.delete(requestId);
          removeListeners(entry);
          entry.resolveCleanup();
          reject(bridgeError(error.message, "BRIDGE_CLOSED", "not-sent"));
        }
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [requestId, entry] of pending) cancel(requestId, entry, "ABORTED");
      if (pending.size === 0) detachListeners();
    },
  };
}

module.exports = {
  REQUEST_CHANNEL,
  RESPONSE_CHANNEL,
  CANCEL_CHANNEL,
  createDeviceBridgeClient,
};
