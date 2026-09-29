function buildUsbPrintersFromDevices(devices = []) {
  const printers = new Map();

  for (const device of devices) {
    if (device.source === "serial" && device.portName) {
      const id = `usb-serial-${device.portName}`;
      printers.set(id, {
        id,
        name: device.name || `USB ${device.portName}`,
        type: "usb",
        connectionType: "usb",
        portName: device.portName,
        protocol: "serial",
        description: device.description || null,
        pnpDeviceId: device.pnpDeviceId || null,
        availableProtocols: {
          usbSerial: true,
          usbWindowsSpooler: false,
        },
      });
    }

    if (device.source === "spooler" && device.printerName) {
      const id = `usb-spooler-${device.printerName}`;
      printers.set(id, {
        id,
        name: device.name || device.printerName,
        type: "usb",
        connectionType: "usb",
        printerName: device.printerName,
        portName: device.portName || null,
        protocol: "windows-spooler",
        driverName: device.driverName || null,
        status: device.status || null,
        availableProtocols: {
          usbSerial: false,
          usbWindowsSpooler: true,
        },
      });
    }

    if (device.source === "pnp-usbprint" && device.name) {
      const id = `usb-pnp-${device.pnpDeviceId || device.name}`;
      if (!printers.has(id)) {
        printers.set(id, {
          id,
          name: `${device.name} (driver non installe)`,
          type: "usb",
          connectionType: "usb",
          printerName: null,
          portName: device.portName || null,
          protocol: "usb-detected",
          driverName: device.driverName || null,
          status: device.status || null,
          pnpDeviceId: device.pnpDeviceId || null,
          availableProtocols: {
            usbSerial: false,
            usbWindowsSpooler: false,
          },
        });
      }
    }
  }

  return [...printers.values()];
}

module.exports = {
  buildUsbPrintersFromDevices,
};
