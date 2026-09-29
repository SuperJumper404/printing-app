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

  assert.deepEqual(printers, [
    {
      id: "usb-pnp-USB\\VID_4B43&PID_3538\\123456",
      name: "Prise en charge d'impression USB (driver non installe)",
      type: "usb",
      connectionType: "usb",
      printerName: null,
      portName: "USB001",
      protocol: "usb-detected",
      driverName: null,
      status: "OK",
      pnpDeviceId: "USB\\VID_4B43&PID_3538\\123456",
      availableProtocols: {
        usbSerial: false,
        usbWindowsSpooler: false,
      },
    },
  ]);
});
