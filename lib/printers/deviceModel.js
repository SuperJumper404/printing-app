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
  "auto",
  "cp858",
  "cp850",
  "windows-1252",
  "utf8",
  "gb18030",
  "raw",
]);

function normalizePrinterEncoding(value) {
  return PRINTER_ENCODINGS.includes(value) ? value : "auto";
}

function normalizeEscPosCodePage(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255
    ? numeric
    : null;
}

function normalizeCharsPerLine(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 24 && numeric <= 96 ? numeric : 48;
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
  const productName = Object.values(transports)
    .map((transport) => transport.config?.productName || transport.config?.model)
    .find(Boolean);

  return {
    ...input,
    printerConfigVersion: 2,
    id: String(input.id || deriveDeviceId({ ...input, instanceIds })),
    name: input.name || input.printerName || input.portName || input.ip || "Imprimante",
    manufacturer: input.manufacturer || null,
    model: input.model || input.productName || productName || null,
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
    escPosCodePage: normalizeEscPosCodePage(input.escPosCodePage),
    charsPerLine: normalizeCharsPerLine(input.charsPerLine),
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
