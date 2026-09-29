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
