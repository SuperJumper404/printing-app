const test = require("node:test");
const assert = require("node:assert/strict");

const { buildUsbPrintersFromDevices } = require("../lib/printerDiscovery");

test("USB discovery includes PnP USBPRINT devices without a Windows printer queue", () => {
  const printers = buildUsbPrintersFromDevices([
    {
      source: "pnp-usbprint",
      name: "Prise en charge d'impression USB",
      portName: "USB001",
      status: "OK",
      pnpDeviceId: "USB\\VID_4B43&PID_3538\\123456",
    },
  ]);

  assert.equal(printers.length, 1);
  assert.equal(printers[0].name, "Prise en charge d'impression USB");
  assert.equal(printers[0].vendorId, "4B43");
  assert.equal(printers[0].productId, "3538");
  assert.equal(printers[0].serialNumber, "123456");
  assert.equal(printers[0].transports.usbRaw.available, true);
  assert.equal(printers[0].transports.usbRaw.enabled, false);
});
