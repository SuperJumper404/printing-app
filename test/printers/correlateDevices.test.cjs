const test = require("node:test");
const assert = require("node:assert/strict");

const {
  correlatePrinterObservations,
} = require("../../lib/printers/correlateDevices");

function observation(id, overrides = {}) {
  return {
    id,
    observationId: id,
    name: id,
    transports: {},
    ...overrides,
  };
}

test("merges observations with the same container ID", () => {
  const devices = correlatePrinterObservations([
    observation("queue", {
      containerId: "{A-CONTAINER}",
      transports: { windowsRaw: { available: true } },
    }),
    observation("usb", {
      containerId: "{a-container}",
      transports: { usbRaw: { available: true } },
    }),
  ]);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].transports.windowsRaw.available, true);
  assert.equal(devices[0].transports.usbRaw.available, true);
});

test("merges equal serial number, VID, and PID", () => {
  const devices = correlatePrinterObservations([
    observation("pnp", { vendorId: "04b8", productId: "0e15", serialNumber: "SN42" }),
    observation("hid", { vendorId: "04B8", productId: "0E15", serialNumber: "sn42" }),
  ]);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].vendorId, "04B8");
  assert.equal(devices[0].productId, "0E15");
});

test("merges an explicit PnP parent and child relationship", () => {
  const devices = correlatePrinterObservations([
    observation("parent", { instanceIds: ["USB\\VID_1234&PID_5678\\PARENT"] }),
    observation("child", {
      instanceIds: ["USBPRINT\\THERMAL\\CHILD"],
      parentInstanceIds: ["usb\\vid_1234&pid_5678\\parent"],
    }),
  ]);

  assert.equal(devices.length, 1);
  assert.deepEqual(new Set(devices[0].instanceIds), new Set([
    "USB\\VID_1234&PID_5678\\PARENT",
    "USBPRINT\\THERMAL\\CHILD",
  ]));
});

test("merges an exact Windows queue-to-port relationship", () => {
  const devices = correlatePrinterObservations([
    observation("queue", {
      transports: {
        windowsRaw: { available: true, config: { printerName: "Receipt", portName: "COM7:" } },
      },
    }),
    observation("serial", {
      portName: "com7",
      transports: { usbSerial: { available: true, config: { portName: "COM7" } } },
    }),
  ]);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].transports.windowsRaw.available, true);
  assert.equal(devices[0].transports.usbSerial.available, true);
});

test("uses a saved association and preserves its printer ID", () => {
  const devices = correlatePrinterObservations(
    [observation("queue-a"), observation("raw-a")],
    [{ printerId: "saved-counter", observationIds: ["queue-a", "raw-a"] }],
  );

  assert.equal(devices.length, 1);
  assert.equal(devices[0].id, "saved-counter");
});

test("does not merge observations based only on an equal name", () => {
  const devices = correlatePrinterObservations([
    observation("first", { name: "Thermal Printer" }),
    observation("second", { name: "Thermal Printer" }),
  ]);

  assert.equal(devices.length, 2);
});

test("does not merge equal VID/PID devices with different serial numbers", () => {
  const devices = correlatePrinterObservations([
    observation("first", { vendorId: "1234", productId: "5678", serialNumber: "ONE" }),
    observation("second", { vendorId: "1234", productId: "5678", serialNumber: "TWO" }),
  ]);

  assert.equal(devices.length, 2);
});

test("merges enabled transport state without losing either route", () => {
  const devices = correlatePrinterObservations([
    observation("queue", {
      containerId: "same",
      transports: { windowsRaw: { available: true, enabled: true } },
    }),
    observation("network", {
      containerId: "same",
      transports: { network9100: { available: true, enabled: true } },
    }),
  ]);

  assert.equal(devices[0].transports.windowsRaw.enabled, true);
  assert.equal(devices[0].transports.network9100.enabled, true);
});

test("mDNS and network probes correlate by actual address and retain a stable mDNS identity after DHCP change", () => {
  const make = (ip) => correlatePrinterObservations([
    observation(`network:${ip}`, { source: "network", addresses: [ip], transports: { network9100: { available: true, config: { host: ip, port: 9100 } } } }),
    observation("mdns:Cuisine._ipp._tcp.local", { source: "mdns", networkIdentity: "Cuisine._ipp._tcp.local", addresses: [ip], transports: { ipp: { available: true, config: { host: ip, port: 631 } } } }),
  ]);
  const before = make("10.0.0.4");
  const after = make("10.0.0.8");
  assert.equal(before.length, 1);
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].transports.network9100.config.host, "10.0.0.8");
});

test("an old network address association cannot rename a different mDNS printer", () => {
  const devices = correlatePrinterObservations([
    observation("network:10.0.0.8", { source: "network", addresses: ["10.0.0.8"] }),
    observation("mdns:New._ipp._tcp.local", { source: "mdns", networkIdentity: "New._ipp._tcp.local", addresses: ["10.0.0.8"] }),
  ], [{ printerId: "old-printer", observationIds: ["network:10.0.0.8", "mdns:Old._ipp._tcp.local"] }]);
  assert.equal(devices.length, 1);
  assert.notEqual(devices[0].id, "old-printer");
});

test("a stale saved IP cannot union two printers when the old mDNS identity moved elsewhere", () => {
  const devices = correlatePrinterObservations([
    observation("mdns:old-printer", { source: "mdns", networkIdentity: "old-printer", addresses: ["10.0.0.8"],
      transports: { ipp: { available: true, config: { host: "10.0.0.8", port: 631 } } } }),
    observation("network:10.0.0.8", { source: "network", addresses: ["10.0.0.8"],
      transports: { network9100: { available: true, config: { host: "10.0.0.8", port: 9100 } } } }),
    observation("mdns:new-printer", { source: "mdns", networkIdentity: "new-printer", addresses: ["10.0.0.7"],
      transports: { ipp: { available: true, config: { host: "10.0.0.7", port: 631 } } } }),
    observation("network:10.0.0.7", { source: "network", addresses: ["10.0.0.7"],
      transports: { network9100: { available: true, config: { host: "10.0.0.7", port: 9100 } } } }),
  ], [{ printerId: "favorite-old", observationIds: ["network:10.0.0.7", "mdns:old-printer"] }]);
  assert.equal(devices.length, 2);
  const favorite = devices.find((printer) => printer.id === "favorite-old");
  assert.equal(favorite.networkIdentity, "old-printer");
  assert.deepEqual(favorite.addresses, ["10.0.0.8"]);
  assert.equal(favorite.transports.network9100.config.host, "10.0.0.8");
  const other = devices.find((printer) => printer.networkIdentity === "new-printer");
  assert.notEqual(other.id, "favorite-old");
  assert.equal(other.transports.network9100.config.host, "10.0.0.7");
});

test("a shared mDNS service preserves the saved printer when its previous primary service disappears", () => {
  const [printer] = correlatePrinterObservations([
    observation("mdns:Caisse._pdl-datastream._tcp.local", {
      source: "mdns", networkIdentity: "Caisse._pdl-datastream._tcp.local", addresses: ["10.0.0.8"],
    }),
    observation("network:10.0.0.8", { source: "network", addresses: ["10.0.0.8"] }),
  ], [{ printerId: "favorite-old", observationIds: [
    "mdns:Caisse._ipp._tcp.local", "mdns:Caisse._pdl-datastream._tcp.local", "network:10.0.0.7",
  ] }]);
  assert.equal(printer.id, "favorite-old");
  assert.deepEqual(printer.addresses, ["10.0.0.8"]);
});
