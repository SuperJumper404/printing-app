import {
  findAuthorizedUsbDevice,
  sendUsbEscPos,
} from "./printers/webUsbTransport.js";
import {
  findAuthorizedHidDevice,
  sendHidEscPos,
} from "./printers/webHidTransport.js";
import {
  findAuthorizedBluetoothDevice,
  sendGattEscPos,
} from "./printers/webBluetoothTransport.js";

const operations = new Map();
const activeRequests = new Map();
const deviceQueues = new Map();
const quarantinedDevices = new Set();
const failedCleanupRequests = new Set();
let bridgeStarted = false;

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error || "Erreur peripherique"),
    ...(error?.action ? { action: error.action } : {}),
    ...(error?.code ? { code: error.code } : {}),
    retryable: error?.retryable === true,
    deliveryState: error?.deliveryState === "not-sent" ? "not-sent" : "unknown",
  };
}

function abortError(deliveryState = "unknown") {
  return Object.assign(new Error("Envoi périphérique annulé"), { name: "AbortError", code: "ABORTED", retryable: false, deliveryState });
}

function deviceKey(operation, payload) {
  const config = payload?.config || {};
  if (config.vendorId || config.productId || config.serialNumber) {
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
  return left.slice(1).every((value, index) => !value || !right[index + 1] || value === right[index + 1]);
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
  ipcRenderer.on("printer-device-cancel", (_, request) => {
    const active = activeRequests.get(request?.requestId);
    if (active) active.controller.abort();
    else ipcRenderer.send("printer-device-response", { requestId: request?.requestId, success: false, cancelled: true, cleanupComplete: !failedCleanupRequests.has(request?.requestId), error: serializeError(abortError("not-sent")) });
  });
  ipcRenderer.on("printer-device-request", async (_, request) => {
    const response = { requestId: request?.requestId };
    const controller = new AbortController();
    const key = deviceKey(request?.operation, request?.payload);
    const active = { controller };
    activeRequests.set(request?.requestId, active);
    const previous = Promise.all([...deviceQueues.entries()].filter(([queuedKey]) => keysOverlap(key, queuedKey)).map(([, queue]) => queue));
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    deviceQueues.set(key, current);
    try {
      await previous;
      if (controller.signal.aborted) throw abortError("not-sent");
      if ([...quarantinedDevices].some((blocked) => keysOverlap(key, blocked))) throw Object.assign(new Error("Le périphérique attend sa libération. Redémarrez l'application."), { code: "DEVICE_BUSY", retryable: false, deliveryState: "not-sent", cleanupComplete: false });
      const handler = operations.get(request?.operation);
      if (!handler) throw new Error(`Operation peripherique inconnue: ${request?.operation}`);
      const result = await handler(request.payload || {}, { signal: controller.signal });
      if (controller.signal.aborted) throw abortError();
      response.success = true;
      response.result = result;
    } catch (error) {
      response.success = false;
      response.error = serializeError(error);
      if (error.cleanupComplete === false) {
        quarantinedDevices.add(key);
        failedCleanupRequests.add(request?.requestId);
        response.cleanupComplete = false;
      }
    } finally {
      if (controller.signal.aborted) {
        response.cancelled = true;
        response.cleanupComplete = ![...quarantinedDevices].some((blocked) => keysOverlap(key, blocked));
      }
      activeRequests.delete(request?.requestId);
      try { ipcRenderer.send("printer-device-response", response); }
      finally {
        release();
        if (deviceQueues.get(key) === current) deviceQueues.delete(key);
      }
    }
  });
}

registerDeviceOperation("usbRaw.send", async ({ config, base64Data }, { signal }) => {
  const device = await findAuthorizedUsbDevice(config);
  const bytes = Uint8Array.from(atob(base64Data), (character) => character.charCodeAt(0));
  return sendUsbEscPos(device, config, bytes, { signal });
});

registerDeviceOperation("usbHid.send", async ({ config, base64Data }, { signal }) => {
  const device = await findAuthorizedHidDevice(config);
  const bytes = Uint8Array.from(atob(base64Data), (character) => character.charCodeAt(0));
  return sendHidEscPos(device, config, bytes, { signal });
});

registerDeviceOperation("bluetoothGatt.send", async ({ config, base64Data }, { signal }) => {
  const device = await findAuthorizedBluetoothDevice(config);
  const bytes = Uint8Array.from(atob(base64Data), (character) => character.charCodeAt(0));
  return sendGattEscPos(device, config, bytes, { signal });
});
