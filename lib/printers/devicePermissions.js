function normalizeDeviceHex(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = typeof value === "number" ? value.toString(16) : String(value);
  return numeric.replace(/^0x/i, "").toUpperCase().padStart(4, "0");
}

function deviceMetadata(deviceType, device) {
  return {
    deviceType,
    deviceId: device.deviceId || null,
    vendorId: normalizeDeviceHex(device.vendorId),
    productId: normalizeDeviceHex(device.productId),
    serialNumber: device.serialNumber || null,
    name: device.deviceName || device.productName || device.name || null,
  };
}

function identityMatchesDevice(identity = {}, device = {}) {
  if (identity.deviceId && device.deviceId === identity.deviceId) return true;
  const vendorMatches =
    normalizeDeviceHex(identity.vendorId) &&
    normalizeDeviceHex(identity.vendorId) === normalizeDeviceHex(device.vendorId);
  const productMatches =
    normalizeDeviceHex(identity.productId) &&
    normalizeDeviceHex(identity.productId) === normalizeDeviceHex(device.productId);
  if (vendorMatches && productMatches) {
    if (!identity.serialNumber) return true;
    return String(identity.serialNumber) === String(device.serialNumber || "");
  }
  if (identity.name) {
    return String(identity.name) === String(
      device.deviceName || device.productName || device.name || ""
    );
  }
  return false;
}

function findUniqueMatchingDevice(devices = [], identity = {}) {
  const matches = devices.filter((device) => identityMatchesDevice(identity, device));
  return matches.length === 1 ? matches[0] : null;
}

function isTrustedDeviceOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol === "file:") return true;
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
      url.port === "5173"
    );
  } catch {
    return false;
  }
}

module.exports = {
  deviceMetadata,
  findUniqueMatchingDevice,
  identityMatchesDevice,
  isTrustedDeviceOrigin,
  normalizeDeviceHex,
};
