const crypto = require("node:crypto");

const TRANSPORT_IDS = Object.freeze([
  "windowsRaw",
  "network9100",
  "ipp",
  "lpr",
  "eposHttp",
  "usbSerial",
  "bluetoothSerial",
  "usbRaw",
  "usbHid",
  "bluetoothGatt",
]);

const PRINTER_ENCODINGS = Object.freeze([
  "windows-1252",
  "cp858",
  "utf8",
  "gb18030",
  "raw",
]);

function normalizePrinterEncoding(value) {
  return PRINTER_ENCODINGS.includes(value) ? value : "windows-1252";
}

function createTransportState(overrides = {}) {
  return {
    available: Boolean(overrides.available),
    enabled: Boolean(overrides.enabled),
    verified: Boolean(overrides.verified),
    config: { ...(overrides.config || {}) },
    reason: overrides.reason || null,
  };
}

function normalizeHardwareId(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).replace(/^0x/i, "").toUpperCase().padStart(4, "0");
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function deriveDeviceId(input) {
  const identity = [
    input.containerId,
    input.serialNumber,
    input.vendorId,
    input.productId,
    ...(input.instanceIds || []),
    input.pnpDeviceId,
    input.printerName,
    input.portName,
    input.ip,
    input.name,
  ]
    .filter(Boolean)
    .join("|");

  const digest = crypto
    .createHash("sha256")
    .update(identity || "unidentified-printer")
    .digest("hex")
    .slice(0, 16);
  return `printer-${digest}`;
}

function createPrinterDevice(input = {}) {
  const transports = {};
  for (const transportId of TRANSPORT_IDS) {
    transports[transportId] = createTransportState(input.transports?.[transportId]);
  }

  const instanceIds = uniqueStrings([
    ...(input.instanceIds || []),
    input.pnpDeviceId,
  ]);
  const addresses = uniqueStrings([
    ...(input.addresses || []),
    input.ip,
  ]);

  return {
    ...input,
    printerConfigVersion: 2,
    id: String(input.id || deriveDeviceId({ ...input, instanceIds })),
    name: input.name || input.printerName || input.portName || input.ip || "Imprimante",
    manufacturer: input.manufacturer || null,
    vendorId: normalizeHardwareId(input.vendorId),
    productId: normalizeHardwareId(input.productId),
    serialNumber: input.serialNumber ? String(input.serialNumber) : null,
    containerId: input.containerId ? String(input.containerId) : null,
    instanceIds,
    addresses,
    observations: Array.isArray(input.observations)
      ? input.observations.map((observation) => ({ ...observation }))
      : [],
    ticketTypes: {
      caisse: false,
      cuisine: false,
      ...(input.ticketTypes || {}),
    },
    encoding: normalizePrinterEncoding(input.encoding),
    escposVerifiedTransports: uniqueStrings(input.escposVerifiedTransports),
    transports,
  };
}

module.exports = {
  PRINTER_ENCODINGS,
  TRANSPORT_IDS,
  createPrinterDevice,
  createTransportState,
  normalizePrinterEncoding,
};
