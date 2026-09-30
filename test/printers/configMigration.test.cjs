const test = require("node:test");
const assert = require("node:assert/strict");

const {
  migratePrinterConfigurations,
} = require("../../lib/printers/configMigration");
const {
  TRANSPORT_IDS,
  createPrinterDevice,
} = require("../../lib/printers/deviceModel");

test("migrates a USB Windows spooler and keeps hardware identity", () => {
  const [printer] = migratePrinterConfigurations([
    {
      id: "usb-spooler-Ticket",
      name: "Ticket",
      connectionType: "usb",
      printerName: "Ticket Queue",
      portName: "USB008",
      driverName: "Thermal Driver",
      vendorId: "04B8",
      productId: "0E15",
      serialNumber: "ABC123",
      pnpDeviceId: "USBPRINT\\EPSON\\ABC123",
      protocols: { usbWindowsSpooler: true },
      availableProtocols: { usbWindowsSpooler: true },
      ticketTypes: { caisse: true, cuisine: false },
    },
  ]);

  assert.equal(printer.printerConfigVersion, 2);
  assert.equal(printer.transports.windowsRaw.available, true);
  assert.equal(printer.transports.windowsRaw.enabled, true);
  assert.deepEqual(printer.transports.windowsRaw.config, {
    printerName: "Ticket Queue",
    portName: "USB008",
    driverName: "Thermal Driver",
  });
  assert.equal(printer.vendorId, "04B8");
  assert.equal(printer.productId, "0E15");
  assert.equal(printer.serialNumber, "ABC123");
  assert.deepEqual(printer.instanceIds, ["USBPRINT\\EPSON\\ABC123"]);
  assert.deepEqual(printer.ticketTypes, { caisse: true, cuisine: false });
  assert.equal(printer.encoding, "windows-1252");
});

test("migrates USB and Bluetooth serial routes with serial settings", () => {
  const migrated = migratePrinterConfigurations([
    {
      id: "usb-com",
      connectionType: "usb",
      portName: "COM4",
      baudRate: 19200,
      protocols: { usbSerial: true },
      availableProtocols: { usbSerial: true },
    },
    {
      id: "bt-com",
      connectionType: "bluetooth",
      portName: "COM9",
      protocols: { bluetoothSerial: true },
      availableProtocols: { bluetoothSerial: true },
    },
  ]);

  assert.equal(migrated[0].transports.usbSerial.enabled, true);
  assert.equal(migrated[0].transports.usbSerial.config.portName, "COM4");
  assert.equal(migrated[0].transports.usbSerial.config.baudRate, 19200);
  assert.equal(migrated[1].transports.bluetoothSerial.enabled, true);
  assert.equal(migrated[1].transports.bluetoothSerial.config.portName, "COM9");
  assert.equal(migrated[1].transports.bluetoothSerial.config.baudRate, 9600);
});

test("maps all legacy network protocol keys", () => {
  const [printer] = migratePrinterConfigurations([
    {
      id: "network-kitchen",
      ip: "192.168.1.45",
      protocols: { 9100: true, 631: false, 515: true, 80: false },
      availableProtocols: { 9100: true, 631: true, 515: true, 80: true },
    },
  ]);

  assert.deepEqual(
    {
      network9100: printer.transports.network9100.enabled,
      ipp: printer.transports.ipp.enabled,
      lpr: printer.transports.lpr.enabled,
      eposHttp: printer.transports.eposHttp.enabled,
    },
    { network9100: true, ipp: false, lpr: true, eposHttp: false },
  );
  assert.equal(printer.transports.network9100.config.host, "192.168.1.45");
  assert.equal(printer.transports.network9100.config.port, 9100);
  assert.equal(printer.transports.ipp.config.port, 631);
  assert.equal(printer.transports.lpr.config.port, 515);
  assert.equal(printer.transports.eposHttp.config.port, 80);
});

test("preserves two simultaneously enabled legacy routes", () => {
  const [printer] = migratePrinterConfigurations([
    {
      id: "dual-route",
      connectionType: "usb",
      printerName: "Receipt",
      portName: "COM6",
      protocols: { usbSerial: true, usbWindowsSpooler: true },
      availableProtocols: { usbSerial: true, usbWindowsSpooler: true },
    },
  ]);

  assert.equal(printer.transports.usbSerial.enabled, true);
  assert.equal(printer.transports.windowsRaw.enabled, true);
});

test("creates all disabled transports when legacy protocols are missing", () => {
  const [printer] = migratePrinterConfigurations([{ id: "unknown", name: "Unknown" }]);

  assert.deepEqual(Object.keys(printer.transports), TRANSPORT_IDS);
  for (const transport of Object.values(printer.transports)) {
    assert.equal(transport.enabled, false);
  }
});

test("migration is idempotent for a versioned normalized record", () => {
  const normalized = createPrinterDevice({
    id: "already-v2",
    name: "Counter",
    transports: {
      usbRaw: {
        available: true,
        enabled: true,
        verified: true,
        config: { vendorId: "1234", productId: "5678", endpointNumber: 1 },
        reason: null,
      },
    },
  });

  assert.deepEqual(migratePrinterConfigurations([normalized]), [normalized]);
});

test("preserves a supported per-printer encoding and normalizes unknown values", () => {
  const [gb18030, fallback] = migratePrinterConfigurations([
    createPrinterDevice({ id: "chinese", encoding: "gb18030" }),
    { printerConfigVersion: 2, id: "fallback", encoding: "unknown" },
  ]);

  assert.equal(gb18030.encoding, "gb18030");
  assert.equal(fallback.encoding, "windows-1252");
});
