const { contextBridge, ipcRenderer } = require("electron");

const invokeChannels = new Set([
  "get-saved-printers", "save-printer-config", "discover-printers", "purge-printer-data", "check-printer-online",
  "get-user-session", "set-user-session", "configure-print-polling", "get-print-history", "reprint-ticket",
  "print-job", "test-printer-protocols", "get-target-config", "get-app-version", "get-service-status",
  "open-ticket-pdf", "open-debug-console", "restart-service",
  "terminals:list", "terminals:save", "terminals:delete", "terminals:list-serial-ports",
  "terminals:test-connection", "terminal-payments:start", "terminal-payments:get", "terminal-payments:cancel",
]);
const sendChannels = new Set(["save-printer-config", "test-printer", "printer-device-response", "printer-device-selection-intent"]);
const eventChannels = new Set(["printer-device-request", "printer-device-cancel", "printers-updated", "print-history-updated", "service-status-updated", "test-printer-response"]);
const listeners = new Map();
const safeIpc = {
  invoke(channel, ...args) { if (!invokeChannels.has(channel)) return Promise.reject(new Error("Action non autorisée")); return ipcRenderer.invoke(channel, ...args); },
  send(channel, ...args) { if (!sendChannels.has(channel)) throw new Error("Action non autorisée"); ipcRenderer.send(channel, ...args); },
  on(channel, callback) {
    if (!eventChannels.has(channel) || typeof callback !== "function") throw new Error("Événement non autorisé");
    if (!listeners.has(channel)) listeners.set(channel, new Map());
    const entries = listeners.get(channel);
    if (entries.has(callback)) return;
    const wrapped = (_event, ...args) => callback(null, ...args);
    entries.set(callback, wrapped); ipcRenderer.on(channel, wrapped);
  },
  removeListener(channel, callback) {
    const entries = listeners.get(channel); const wrapped = entries?.get(callback);
    if (wrapped) { ipcRenderer.removeListener(channel, wrapped); entries.delete(callback); }
  },
};

contextBridge.exposeInMainWorld("require", name => {
  if (name !== "electron") throw new Error("Module non autorisé");
  return { ipcRenderer: safeIpc };
});
