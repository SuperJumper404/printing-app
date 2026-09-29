const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deviceMetadata,
  findUniqueMatchingDevice,
  identityMatchesDevice,
  isTrustedDeviceOrigin,
} = require("../../lib/printers/devicePermissions");

test("trusts only the packaged app and the configured local Vite origin", () => {
  assert.equal(isTrustedDeviceOrigin("file:///C:/app/frontend/dist/index.html"), true);
  assert.equal(isTrustedDeviceOrigin("http://localhost:5173/printers"), true);
  assert.equal(isTrustedDeviceOrigin("http://127.0.0.1:5173"), true);
  assert.equal(isTrustedDeviceOrigin("http://localhost:5174"), false);
  assert.equal(isTrustedDeviceOrigin("https://localhost:5173"), false);
  assert.equal(isTrustedDeviceOrigin("https://example.com"), false);
  assert.equal(isTrustedDeviceOrigin("not-a-url"), false);
});

test("matches hardware by device ID or VID/PID and serial number", () => {
  const device = {
    deviceId: "usb-42",
    vendorId: 0x04b8,
    productId: 0x0e28,
    serialNumber: "ABC",
    productName: "Receipt Printer",
  };

  assert.equal(identityMatchesDevice({ deviceId: "usb-42" }, device), true);
  assert.equal(
    identityMatchesDevice(
      { vendorId: "04B8", productId: "0e28", serialNumber: "ABC" },
      device
    ),
    true
  );
  assert.equal(
    identityMatchesDevice(
      { vendorId: "04B8", productId: "0e28", serialNumber: "OTHER" },
      device
    ),
    false
  );
});

test("selects only an unambiguous matching device", () => {
  const devices = [
    { deviceId: "one", deviceName: "Printer" },
    { deviceId: "two", deviceName: "Printer" },
  ];

  assert.equal(findUniqueMatchingDevice(devices, { deviceId: "two" }), devices[1]);
  assert.equal(findUniqueMatchingDevice(devices, { name: "Printer" }), null);
  assert.equal(findUniqueMatchingDevice(devices, { name: "Missing" }), null);
});

test("stores normalized metadata without undefined browser fields", () => {
  assert.deepEqual(
    deviceMetadata("usb", {
      deviceId: "usb-42",
      vendorId: 1208,
      productId: 3624,
      serialNumber: "ABC",
      productName: "Receipt Printer",
    }),
    {
      deviceType: "usb",
      deviceId: "usb-42",
      vendorId: "04B8",
      productId: "0E28",
      serialNumber: "ABC",
      name: "Receipt Printer",
    }
  );
});
