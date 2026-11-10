const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWindowsDiscoveryScript,
  normalizeWindowsDiscoveryRows,
  discoverWindowsPrinterObservations,
} = require("../../lib/printers/discovery/windows");
const {
  correlatePrinterObservations,
} = require("../../lib/printers/correlateDevices");

const rows = [
  {
    source: "printerPort",
    name: "USB008",
    description: "Local Port",
  },
  {
    source: "printerQueue",
    name: "Counter receipt",
    printerName: "Counter receipt",
    portName: "USB008",
    driverName: "Generic / Text Only",
    status: 3,
  },
  {
    source: "pnp",
    name: "USB Printing Support",
    className: "USB",
    instanceId: "USB\\VID_04B8&PID_0E15\\SN-USB-1",
    parentInstanceId: "USB\\ROOT_HUB30\\1",
    containerId: "{USB-CONTAINER}",
    locationInfo: "Port_#0006.Hub_#0004",
    status: "OK",
  },
  {
    source: "serial",
    name: "USB Serial Device (COM4)",
    deviceId: "COM4",
    pnpDeviceId: "USB\\VID_1234&PID_5678\\SERIAL-USB",
    description: "USB Serial Device",
  },
  {
    source: "serial",
    name: "Standard Serial over Bluetooth link (COM9)",
    deviceId: "COM9",
    pnpDeviceId: "BTHENUM\\DEV_AABBCCDDEEFF\\7&1",
    description: "Bluetooth Serial Port",
  },
  {
    source: "printerPort",
    name: "WSD-1234",
    description: "WSD Port",
    printerHostAddress: "192.168.1.80",
  },
  {
    source: "printerQueue",
    name: "Kitchen WSD",
    printerName: "Kitchen WSD",
    portName: "WSD-1234",
    driverName: "Microsoft IPP Class Driver",
  },
  {
    source: "pnp",
    name: "POS HID interface",
    className: "HIDClass",
    instanceId: "HID\\VID_1111&PID_2222\\HID-SERIAL",
    containerId: "{HID-CONTAINER}",
    status: "OK",
  },
  {
    source: "pnp",
    name: "Same thermal name",
    className: "Printer",
    instanceId: "USBPRINT\\FIRST\\ONE",
    containerId: "{FIRST}",
  },
  {
    source: "pnp",
    name: "Same thermal name",
    className: "Printer",
    instanceId: "USBPRINT\\SECOND\\TWO",
    containerId: "{SECOND}",
  },
];

test("builds a read-only Windows snapshot covering every discovery source", () => {
  const script = buildWindowsDiscoveryScript();

  assert.match(script, /Get-Printer\b/);
  assert.match(script, /Get-PrinterPort\b/);
  assert.match(script, /Get-PnpDevice\s+-PresentOnly/);
  assert.match(script, /Get-PnpDeviceProperty/);
  assert.match(script, /Win32_PnPEntity/);
  assert.match(script, /Win32_SerialPort/);
  assert.doesNotMatch(script, /epson\|star\|zebra/i);
});

test("normalizes queue, USB, COM, Bluetooth, WSD, and HID observations", () => {
  const observations = normalizeWindowsDiscoveryRows(rows);

  const usbQueue = observations.find((item) => item.observationId === "queue:Counter receipt");
  assert.equal(usbQueue.transports.windowsRaw.available, true);
  assert.equal(usbQueue.transports.windowsRaw.config.portName, "USB008");

  const usbRaw = observations.find((item) => item.transports.usbRaw?.candidate);
  assert.equal(usbRaw.vendorId, "04B8");
  assert.equal(usbRaw.productId, "0E15");
  assert.equal(usbRaw.serialNumber, "SN-USB-1");
  assert.deepEqual(usbRaw.location, { portNumber: 6, hubNumber: 4 });
  assert.match(usbRaw.transports.usbRaw.reason, /autorisation/i);
  assert.equal(usbRaw.transports.usbRaw.available, false);

  const usbSerial = observations.find((item) => item.transports.usbSerial?.available);
  assert.equal(usbSerial.transports.usbSerial.config.portName, "COM4");

  const bluetoothSerial = observations.find(
    (item) => item.transports.bluetoothSerial?.available,
  );
  assert.equal(bluetoothSerial.transports.bluetoothSerial.config.portName, "COM9");

  const wsdQueue = observations.find((item) => item.observationId === "queue:Kitchen WSD");
  assert.equal(wsdQueue.transports.windowsRaw.available, true);
  assert.equal(wsdQueue.addresses[0], "192.168.1.80");

  const hid = observations.find((item) => item.transports.usbHid?.candidate);
  assert.equal(hid.vendorId, "1111");
  assert.equal(hid.productId, "2222");
  assert.match(hid.transports.usbHid.reason, /autorisation/i);
});

test("ordinary Bluetooth, keyboard and USB devices are not usable printer transports", () => {
  const observations = normalizeWindowsDiscoveryRows([
    { source: "pnp", instanceId: "BTHENUM\\DEV_AA\\1", className: "Bluetooth", name: "POS Bluetooth printer" },
    { source: "pnp", instanceId: "HID\\VID_1111&PID_2222\\KEY", className: "HIDClass", name: "Keyboard" },
    { source: "pnp", instanceId: "USB\\VID_3333&PID_4444\\HUB", className: "USB", name: "USB Hub" },
    { source: "serial", deviceId: "USB001", name: "Bad serial queue" },
  ]);
  assert.equal(observations.some((item) => item.transports.bluetoothGatt), false);
  assert.equal(observations.some((item) => Object.values(item.transports).some((transport) => transport.available)), false);
  assert.equal(observations.some((item) => item.transports.usbHid), false);
  assert.equal(observations.some((item) => item.transports.usbSerial), false);
});

test("BLE printer candidates require explicit write service configuration", () => {
  const [observation] = normalizeWindowsDiscoveryRows([{
    source: "pnp", instanceId: "BTHLEDEVICE\\DEV_AA\\1", className: "Bluetooth", name: "Receipt printer BLE",
  }]);
  assert.equal(observation.transports.bluetoothGatt.available, false);
  assert.equal(observation.transports.bluetoothGatt.candidate, true);
  assert.equal(observation.transports.bluetoothGatt.config.authorized, false);
  assert.match(observation.transports.bluetoothGatt.reason, /service/i);
});

test("does not correlate unrelated same-name Windows devices", () => {
  const observations = normalizeWindowsDiscoveryRows(rows);
  const sameName = observations.filter((item) => item.name === "Same thermal name");
  assert.equal(correlatePrinterObservations(sameName).length, 2);
});

test("runs the generated snapshot and returns normalized observations", async () => {
  let receivedScript = "";
  const observations = await discoverWindowsPrinterObservations(async (script) => {
    receivedScript = script;
    return rows;
  });

  assert.match(receivedScript, /ConvertTo-Json/);
  assert.ok(observations.length >= 8);
});
