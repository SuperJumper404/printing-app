const {
  normalizeWindowsDiscoveryRows,
} = require("./printers/discovery/windows");

function buildUsbPrintersFromDevices(devices = []) {
  const rows = devices.map((device) => {
    if (device.source === "serial") {
      return { ...device, deviceId: device.portName };
    }
    if (device.source === "spooler") {
      return { ...device, source: "printerQueue" };
    }
    if (device.source === "pnp-usbprint") {
      return {
        ...device,
        source: "pnp",
        instanceId: device.pnpDeviceId,
        className: "Printer",
      };
    }
    return device;
  });

  return normalizeWindowsDiscoveryRows(rows);
}

module.exports = {
  buildUsbPrintersFromDevices,
};
