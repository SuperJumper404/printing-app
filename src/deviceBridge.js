import {
  findAuthorizedUsbDevice,
  sendUsbEscPos,
} from "./printers/webUsbTransport";

const operations = new Map();
let bridgeStarted = false;

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error || "Erreur peripherique"),
    ...(error?.action ? { action: error.action } : {}),
    ...(error?.code ? { code: error.code } : {}),
  };
}

export function registerDeviceOperation(name, handler) {
  operations.set(name, handler);
  return () => operations.delete(name);
}

export function announceDeviceSelection(deviceType, identity) {
  const { ipcRenderer } = window.require("electron");
  ipcRenderer.send("printer-device-selection-intent", { deviceType, identity });
}

export function startDeviceBridge() {
  if (bridgeStarted) return;
  bridgeStarted = true;
  const { ipcRenderer } = window.require("electron");
  ipcRenderer.on("printer-device-request", async (_, request) => {
    const response = { requestId: request?.requestId };
    try {
      const handler = operations.get(request?.operation);
      if (!handler) throw new Error(`Operation peripherique inconnue: ${request?.operation}`);
      response.success = true;
      response.result = await handler(request.payload || {});
    } catch (error) {
      response.success = false;
      response.error = serializeError(error);
    }
    ipcRenderer.send("printer-device-response", response);
  });
}

registerDeviceOperation("usbRaw.send", async ({ config, base64Data }) => {
  const device = await findAuthorizedUsbDevice(config);
  const bytes = Uint8Array.from(atob(base64Data), (character) => character.charCodeAt(0));
  return sendUsbEscPos(device, config, bytes);
});
