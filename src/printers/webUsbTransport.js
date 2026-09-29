import usbConfig from "../../lib/printers/webUsbConfig.js";

const { selectUsbBulkOutEndpoint } = usbConfig;

function sameUsbIdentity(device, identity = {}) {
  if (identity.vendorId && Number.parseInt(identity.vendorId, 16) !== device.vendorId) return false;
  if (identity.productId && Number.parseInt(identity.productId, 16) !== device.productId) return false;
  if (identity.serialNumber && identity.serialNumber !== device.serialNumber) return false;
  return Boolean(identity.vendorId || identity.productId || identity.serialNumber);
}

function selectionIntent(identity) {
  const { ipcRenderer } = window.require("electron");
  ipcRenderer.send("printer-device-selection-intent", {
    deviceType: "usb",
    identity,
  });
}

export function inspectUsbDevice(device, explicit = {}) {
  const configurations = device.configurations || [];
  for (const configuration of configurations) {
    const endpoint = selectUsbBulkOutEndpoint(configuration.interfaces, explicit);
    if (endpoint) {
      return {
        vendorId: device.vendorId.toString(16).padStart(4, "0").toUpperCase(),
        productId: device.productId.toString(16).padStart(4, "0").toUpperCase(),
        serialNumber: device.serialNumber || null,
        productName: device.productName || null,
        configurationValue: configuration.configurationValue,
        ...endpoint,
      };
    }
  }
  throw new Error("Aucun endpoint USB bulk OUT disponible");
}

export async function authorizeUsbDevice(identity = {}) {
  if (!navigator.usb) throw new Error("WebUSB n'est pas disponible dans cette version");
  selectionIntent(identity);
  const filter = {};
  if (identity.vendorId) filter.vendorId = Number.parseInt(identity.vendorId, 16);
  if (identity.productId) filter.productId = Number.parseInt(identity.productId, 16);
  const device = await navigator.usb.requestDevice({
    filters: Object.keys(filter).length ? [filter] : [],
  });
  return inspectUsbDevice(device, identity);
}

export async function findAuthorizedUsbDevice(identity = {}) {
  if (!navigator.usb) return null;
  const devices = await navigator.usb.getDevices();
  return devices.find((device) => sameUsbIdentity(device, identity)) || null;
}

export async function sendUsbEscPos(device, config, bytes) {
  if (!device) {
    const error = new Error("Peripherique USB non autorise");
    error.name = "NotAllowedError";
    error.action = "authorize-usb";
    throw error;
  }
  let openedHere = false;
  let claimed = false;
  const endpoint = inspectUsbDevice(device, config);
  try {
    if (!device.opened) {
      await device.open();
      openedHere = true;
    }
    if (!device.configuration || device.configuration.configurationValue !== endpoint.configurationValue) {
      await device.selectConfiguration(endpoint.configurationValue);
    }
    await device.claimInterface(endpoint.interfaceNumber);
    claimed = true;
    if (endpoint.alternateSetting) {
      await device.selectAlternateInterface(endpoint.interfaceNumber, endpoint.alternateSetting);
    }
    const result = await device.transferOut(endpoint.endpointNumber, bytes);
    if (result.status !== "ok") throw new Error(`Ecriture USB refusee: ${result.status}`);
    return { bytesWritten: result.bytesWritten ?? bytes.byteLength, config: endpoint };
  } catch (error) {
    if (!error.action && /claim|access|denied|busy/i.test(error.message || "")) {
      error.action = "release-windows-interface";
    }
    throw error;
  } finally {
    if (claimed) {
      try { await device.releaseInterface(endpoint.interfaceNumber); } catch {}
    }
    if (openedHere) {
      try { await device.close(); } catch {}
    }
  }
}
