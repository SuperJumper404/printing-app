const crypto = require("node:crypto");

const REQUEST_CHANNEL = "printer-device-request";
const RESPONSE_CHANNEL = "printer-device-response";

function toBridgeError(details) {
  const source = typeof details === "string" ? { message: details } : details || {};
  const error = new Error(source.message || "Erreur du transport peripherique");
  if (source.name) error.name = source.name;
  for (const [key, value] of Object.entries(source)) {
    if (key !== "message" && key !== "name") error[key] = value;
  }
  return error;
}

function createDeviceBridgeClient(webContents, options = {}) {
  const ipc = options.ipc;
  if (!ipc?.on || !ipc?.off) throw new Error("Un emetteur IPC est requis");
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const defaultTimeoutMs = Number(options.timeoutMs) || 5000;
  const pending = new Map();
  let disposed = false;

  const rejectPending = (message) => {
    for (const entry of pending.values()) {
      clearTimer(entry.timer);
      entry.reject(new Error(message));
    }
    pending.clear();
  };

  const onResponse = (event, response = {}) => {
    if (event?.sender && event.sender !== webContents) return;
    const entry = pending.get(response.requestId);
    if (!entry) return;
    pending.delete(response.requestId);
    clearTimer(entry.timer);
    if (response.success) entry.resolve(response.result);
    else entry.reject(toBridgeError(response.error));
  };

  const onDestroyed = () => rejectPending("La fenetre peripherique a ete fermee");
  ipc.on(RESPONSE_CHANNEL, onResponse);
  webContents.once("destroyed", onDestroyed);

  return {
    request(operation, payload = {}, timeoutMs = defaultTimeoutMs) {
      if (disposed || webContents.isDestroyed?.()) {
        return Promise.reject(new Error("La fenetre peripherique a ete fermee"));
      }
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          if (!pending.delete(requestId)) return;
          reject(new Error(`Delai depasse pour ${operation}`));
        }, Number(timeoutMs) || defaultTimeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        webContents.send(REQUEST_CHANNEL, { requestId, operation, payload });
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      ipc.off(RESPONSE_CHANNEL, onResponse);
      webContents.off("destroyed", onDestroyed);
      rejectPending("Le pont peripherique a ete ferme");
    },
  };
}

module.exports = {
  REQUEST_CHANNEL,
  RESPONSE_CHANNEL,
  createDeviceBridgeClient,
};
