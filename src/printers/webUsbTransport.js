import usbConfig from "../../lib/printers/webUsbConfig.js";

const { selectUsbBulkOutEndpoint } = usbConfig;

function deviceError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, retryable: false, deliveryState: "not-sent", ...details });
}

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
  const matches = devices.filter((device) => sameUsbIdentity(device, identity));
  if (matches.length > 1) {
    throw deviceError("Plusieurs imprimantes USB correspondent. Choisissez un numéro de série ou une file Windows distincte.", "AMBIGUOUS_DEVICE", { action: "select-unique-usb" });
  }
  return matches[0] || null;
}

export async function sendUsbEscPos(device, config, bytes, { signal } = {}) {
  if (!device) {
    throw deviceError("Périphérique USB non autorisé", "PERMISSION_DENIED", { name: "NotAllowedError", action: "authorize-usb" });
  }
  let ownsDevice = false;
  let claimed = false;
  let writing = false;
  let endpoint;
  const checkAbort = () => {
    if (signal?.aborted) throw deviceError("Envoi USB annulé", "ABORTED", { name: "AbortError", deliveryState: writing ? "unknown" : "not-sent" });
  };
  const cleanupTasks = [];
  const trackCleanup = (task) => {
    cleanupTasks.push(task);
    // Cancellation can begin cleanup while the native write is still pending.
    task.catch(() => {});
    return task;
  };
  const cleanup = () => {
    let releasing;
    if (claimed) {
      claimed = false;
      releasing = trackCleanup(Promise.resolve().then(() => device.releaseInterface(endpoint.interfaceNumber)));
    }
    if (ownsDevice) {
      ownsDevice = false;
      // Close also interrupts a pending transfer. Acknowledgement still waits for that transfer.
      const beforeClose = signal?.aborted ? Promise.resolve() : Promise.resolve(releasing).catch(() => {});
      trackCleanup(beforeClose.then(() => device.close()));
    }
  };
  let failure;
  let result;
  signal?.addEventListener("abort", cleanup, { once: true });
  try {
    checkAbort();
    try { endpoint = inspectUsbDevice(device, config); }
    catch (error) { throw deviceError(error.message, "CONFIGURATION", { action: "configure-usb" }); }
    if (!device.opened) {
      await device.open();
    }
    ownsDevice = true;
    checkAbort();
    if (!device.configuration || device.configuration.configurationValue !== endpoint.configurationValue) {
      await device.selectConfiguration(endpoint.configurationValue);
      checkAbort();
    }
    await device.claimInterface(endpoint.interfaceNumber);
    claimed = true;
    checkAbort();
    if (endpoint.alternateSetting) {
      await device.selectAlternateInterface(endpoint.interfaceNumber, endpoint.alternateSetting);
      checkAbort();
    }
    writing = true;
    const transfer = await device.transferOut(endpoint.endpointNumber, bytes);
    checkAbort();
    if (transfer.status !== "ok") throw deviceError(`Écriture USB refusée : ${transfer.status}`, "WRITE_FAILED", { deliveryState: "unknown" });
    if (transfer.bytesWritten !== bytes.byteLength) {
      throw deviceError("Écriture USB incomplète. Vérifiez le ticket avant de réessayer.", "PARTIAL_WRITE", { deliveryState: "unknown", bytesWritten: transfer.bytesWritten ?? null });
    }
    result = { bytesWritten: transfer.bytesWritten, config: endpoint };
  } catch (error) {
    if (signal?.aborted) {
      failure = deviceError("Envoi USB annulé", "ABORTED", { name: "AbortError", deliveryState: writing ? "unknown" : "not-sent" });
    } else {
      const denied = /claim|access|denied|busy/i.test(error.message || "") || ["SecurityError", "NotAllowedError"].includes(error.name);
      failure = typeof error.code === "string" && typeof error.retryable === "boolean" ? error : deviceError(error.message, denied ? "PERMISSION_DENIED" : writing ? "WRITE_FAILED" : "CONNECTION_FAILED", {
        name: error.name, retryable: !writing && !denied && ["NetworkError", "NotFoundError"].includes(error.name), deliveryState: writing ? "unknown" : "not-sent",
      });
    }
    if (!failure.action && failure.code === "PERMISSION_DENIED") {
      failure.action = "release-windows-interface";
    }
  } finally {
    signal?.removeEventListener("abort", cleanup);
    cleanup();
    const cleanupResults = await Promise.allSettled(cleanupTasks);
    if (cleanupResults.some((entry) => entry.status === "rejected")) {
      failure ||= deviceError("Impossible de libérer le périphérique USB", "CLEANUP_FAILED", { deliveryState: writing ? "unknown" : "not-sent", action: "reconnect-usb" });
      failure.cleanupComplete = false;
    }
  }
  if (failure) throw failure;
  return result;
}
