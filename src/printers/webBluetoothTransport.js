import gattConfig from "../../lib/printers/bluetoothGattConfig.js";

const {
  chunkGattWrites,
  normalizeGattUuid,
  selectGattWriteMethod,
} = gattConfig;

function deviceError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, retryable: false, deliveryState: "not-sent", ...details });
}

function configuredUuid(value) {
  try { return normalizeGattUuid(value); }
  catch (error) { throw deviceError(error.message, "CONFIGURATION", { action: "configure-bluetooth-gatt" }); }
}

function selectionIntent(identity) {
  const { ipcRenderer } = window.require("electron");
  ipcRenderer.send("printer-device-selection-intent", {
    deviceType: "bluetooth",
    identity,
  });
}

export async function authorizeBluetoothDevice(identity = {}) {
  if (!navigator.bluetooth) throw deviceError("Web Bluetooth n'est pas disponible", "UNSUPPORTED", { action: "use-windows-spooler" });
  const serviceUuid = configuredUuid(identity.serviceUuid);
  const characteristicUuid = identity.characteristicUuid ? configuredUuid(identity.characteristicUuid) : null;
  selectionIntent(identity);
  const optionalServices = [serviceUuid];
  const options = identity.name
    ? { filters: [{ name: identity.name }], optionalServices }
    : { acceptAllDevices: true, optionalServices };
  const device = await navigator.bluetooth.requestDevice(options);
  return {
    deviceId: device.id,
    name: device.name || identity.name || null,
    serviceUuid,
    ...(characteristicUuid ? { characteristicUuid } : {}),
  };
}

export async function findAuthorizedBluetoothDevice(identity = {}) {
  if (!navigator.bluetooth?.getDevices) return null;
  const devices = await navigator.bluetooth.getDevices();
  // A stored ID must never silently select another same-name printer after unpairing.
  if (identity.deviceId) return devices.find((device) => device.id === identity.deviceId) || null;
  const matches = identity.name ? devices.filter((device) => device.name === identity.name) : [];
  if (matches.length > 1) throw deviceError("Plusieurs imprimantes Bluetooth portent ce nom. Associez l'appareil voulu.", "AMBIGUOUS_DEVICE", { action: "authorize-bluetooth" });
  return matches[0] || null;
}

export async function inspectGattServer(server, config) {
  const serviceUuid = normalizeGattUuid(config.serviceUuid);
  const characteristicUuid = normalizeGattUuid(config.characteristicUuid);
  const service = await server.getPrimaryService(serviceUuid);
  const characteristic = await service.getCharacteristic(characteristicUuid);
  return {
    characteristic,
    method: selectGattWriteMethod(characteristic),
    serviceUuid,
    characteristicUuid,
  };
}

export async function sendGattEscPos(device, config, bytes, { signal } = {}) {
  if (!device) {
    throw deviceError("Périphérique Bluetooth non associé", "PERMISSION_DENIED", { name: "NotAllowedError", action: "authorize-bluetooth" });
  }
  if (!device.gatt) {
    throw deviceError("Cet appareil ne propose pas de service Bluetooth GATT. Utilisez sa file Windows ou son port COM.", "UNSUPPORTED", { action: "use-windows-spooler" });
  }
  const serviceUuid = configuredUuid(config.serviceUuid);
  const characteristicUuid = configuredUuid(config.characteristicUuid);
  let chunks;
  try { chunks = chunkGattWrites(bytes, config.maxChunkSize === undefined ? 20 : Number(config.maxChunkSize)); }
  catch (error) { throw deviceError(error.message, "CONFIGURATION", { action: "configure-bluetooth-gatt" }); }
  let writing = false;
  let failure;
  const checkAbort = () => {
    if (signal?.aborted) throw deviceError("Envoi Bluetooth annulé", "ABORTED", { name: "AbortError", deliveryState: writing ? "unknown" : "not-sent" });
  };
  const disconnect = () => {
    // connect() may complete after cancellation; run cleanup again in finally.
    if (device.gatt.connected) device.gatt.disconnect();
  };
  const onAbort = () => { try { disconnect(); } catch {} };
  let result;
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    checkAbort();
    const server = await device.gatt.connect();
    checkAbort();
    const service = await server.getPrimaryService(serviceUuid);
    checkAbort();
    const characteristic = await service.getCharacteristic(characteristicUuid);
    checkAbort();
    let method;
    try { method = selectGattWriteMethod(characteristic); }
    catch (error) { throw deviceError(error.message, "CONFIGURATION", { action: "configure-bluetooth-gatt" }); }
    for (const chunk of chunks) {
      checkAbort();
      writing = true;
      await characteristic[method](chunk);
      checkAbort();
    }
    result = { chunkCount: chunks.length, bytesWritten: bytes.byteLength, method };
  } catch (error) {
    if (signal?.aborted) {
      failure = deviceError("Envoi Bluetooth annulé", "ABORTED", { name: "AbortError", deliveryState: writing ? "unknown" : "not-sent" });
    } else {
      const denied = ["SecurityError", "NotAllowedError"].includes(error.name);
      const invalid = error.name === "NotFoundError";
      failure = typeof error.code === "string" && typeof error.retryable === "boolean" ? error : deviceError(error.message, denied ? "PERMISSION_DENIED" : invalid ? "CONFIGURATION" : writing ? "WRITE_FAILED" : "CONNECTION_FAILED", {
        name: error.name, retryable: !writing && !denied && !invalid && error.name === "NetworkError", deliveryState: writing ? "unknown" : "not-sent",
        ...(denied ? { action: "authorize-bluetooth-service" } : invalid ? { action: "configure-bluetooth-gatt" } : {}),
      });
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try { disconnect(); }
    catch {
      failure ||= deviceError("Impossible de déconnecter le périphérique Bluetooth", "CLEANUP_FAILED", { deliveryState: writing ? "unknown" : "not-sent", action: "reconnect-bluetooth" });
      failure.cleanupComplete = false;
    }
  }
  if (failure) throw failure;
  return result;
}
