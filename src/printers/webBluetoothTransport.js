import gattConfig from "../../lib/printers/bluetoothGattConfig.js";

const {
  chunkGattWrites,
  normalizeGattUuid,
  selectGattWriteMethod,
  sendGattChunks,
} = gattConfig;

function selectionIntent(identity) {
  const { ipcRenderer } = window.require("electron");
  ipcRenderer.send("printer-device-selection-intent", {
    deviceType: "bluetooth",
    identity,
  });
}

export async function authorizeBluetoothDevice(identity = {}) {
  if (!navigator.bluetooth) throw new Error("Web Bluetooth n'est pas disponible");
  selectionIntent(identity);
  const optionalServices = identity.serviceUuid
    ? [normalizeGattUuid(identity.serviceUuid)]
    : [];
  const options = identity.name
    ? { filters: [{ name: identity.name }], optionalServices }
    : { acceptAllDevices: true, optionalServices };
  const device = await navigator.bluetooth.requestDevice(options);
  return {
    deviceId: device.id,
    name: device.name || identity.name || null,
    ...(identity.serviceUuid ? { serviceUuid: normalizeGattUuid(identity.serviceUuid) } : {}),
    ...(identity.characteristicUuid
      ? { characteristicUuid: normalizeGattUuid(identity.characteristicUuid) }
      : {}),
  };
}

export async function findAuthorizedBluetoothDevice(identity = {}) {
  if (!navigator.bluetooth?.getDevices) return null;
  const devices = await navigator.bluetooth.getDevices();
  return (
    devices.find(
      (device) =>
        (identity.deviceId && device.id === identity.deviceId) ||
        (identity.name && device.name === identity.name),
    ) || null
  );
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

export async function sendGattEscPos(device, config, bytes) {
  if (!device) {
    const error = new Error("Peripherique Bluetooth non associe");
    error.name = "NotAllowedError";
    error.action = "authorize-bluetooth";
    throw error;
  }
  if (!config.serviceUuid || !config.characteristicUuid) {
    throw new Error("UUID du service et de la caracteristique Bluetooth requis");
  }
  let disconnected = false;
  const disconnect = async () => {
    if (disconnected) return;
    disconnected = true;
    if (device.gatt?.connected) device.gatt.disconnect();
  };
  try {
    const server = await device.gatt.connect();
    const { characteristic, method } = await inspectGattServer(server, config);
    const chunks = chunkGattWrites(bytes, Number(config.maxChunkSize) || 20);
    await sendGattChunks(
      chunks,
      (chunk) => characteristic[method](chunk),
      disconnect,
    );
    return { chunkCount: chunks.length, bytesWritten: bytes.byteLength, method };
  } catch (error) {
    await disconnect();
    throw error;
  }
}
