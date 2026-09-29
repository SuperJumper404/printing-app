const { createPrinterDevice } = require("./deviceModel");

const NETWORK_TRANSPORTS = {
  9100: "network9100",
  631: "ipp",
  515: "lpr",
  80: "eposHttp",
};

const WINDOWS_RAW_KEYS = [
  "windowsSpooler",
  "usbWindowsSpooler",
  "bluetoothWindowsSpooler",
  "localWindowsSpooler",
];

function anyLegacyFlag(source, keys) {
  return keys.some((key) => Boolean(source?.[key]));
}

function serialConfig(printer) {
  return {
    portName: printer.portName || printer.realPortName || null,
    baudRate: Number(printer.baudRate) || 9600,
    dataBits: Number(printer.dataBits) || 8,
    parity: printer.parity || "None",
    stopBits: Number(printer.stopBits) || 1,
  };
}

function migrateLegacyPrinter(printer = {}) {
  const protocols = printer.protocols || {};
  const availableProtocols = printer.availableProtocols || {};
  const verified = new Set(printer.escposVerifiedTransports || []);
  const transports = {};

  const windowsEnabled = anyLegacyFlag(protocols, WINDOWS_RAW_KEYS);
  const windowsAvailable =
    anyLegacyFlag(availableProtocols, WINDOWS_RAW_KEYS) ||
    windowsEnabled ||
    Boolean(printer.printerName);
  transports.windowsRaw = {
    available: windowsAvailable,
    enabled: windowsEnabled,
    verified: verified.has("windowsRaw"),
    config: {
      printerName: printer.printerName || null,
      portName: printer.portName || null,
      driverName: printer.driverName || null,
    },
    reason: windowsAvailable ? null : "Aucune file d'impression Windows detectee",
  };

  for (const [port, transportId] of Object.entries(NETWORK_TRANSPORTS)) {
    const enabled = Boolean(protocols[port]);
    const available = Boolean(availableProtocols[port]) || enabled;
    transports[transportId] = {
      available,
      enabled,
      verified: verified.has(transportId),
      config: { host: printer.ip || null, port: Number(port) },
      reason: available ? null : `Port ${port} non detecte`,
    };
  }

  const localSerialEnabled = Boolean(protocols.localSerial);
  const localSerialAvailable = Boolean(availableProtocols.localSerial);
  const isBluetooth = printer.connectionType === "bluetooth";
  const serialTransportId = isBluetooth ? "bluetoothSerial" : "usbSerial";
  const serialLegacyKey = isBluetooth ? "bluetoothSerial" : "usbSerial";
  const serialEnabled = Boolean(protocols[serialLegacyKey]) || localSerialEnabled;
  const serialAvailable =
    Boolean(availableProtocols[serialLegacyKey]) ||
    localSerialAvailable ||
    serialEnabled ||
    Boolean(printer.portName);
  transports[serialTransportId] = {
    available: serialAvailable,
    enabled: serialEnabled,
    verified: verified.has(serialTransportId),
    config: serialConfig(printer),
    reason: serialAvailable ? null : "Aucun port COM detecte",
  };

  return createPrinterDevice({
    ...printer,
    transports,
  });
}

function migratePrinterConfigurations(printers) {
  if (!Array.isArray(printers)) return [];
  return printers.map((printer) =>
    printer?.printerConfigVersion === 2
      ? createPrinterDevice(printer)
      : migrateLegacyPrinter(printer),
  );
}

module.exports = {
  migratePrinterConfigurations,
};
