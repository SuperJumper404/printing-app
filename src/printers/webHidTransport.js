import hidConfig from "../../lib/printers/webHidConfig.js";

const { chunkHidReports } = hidConfig;

function deviceError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, retryable: false, deliveryState: "not-sent", ...details });
}

function sameHidIdentity(device, identity = {}) {
  if (identity.vendorId && Number.parseInt(identity.vendorId, 16) !== device.vendorId) return false;
  if (identity.productId && Number.parseInt(identity.productId, 16) !== device.productId) return false;
  if (identity.productName && identity.productName !== device.productName) return false;
  return Boolean(identity.vendorId || identity.productId || identity.productName);
}

function selectionIntent(identity) {
  const { ipcRenderer } = window.require("electron");
  ipcRenderer.send("printer-device-selection-intent", { deviceType: "hid", identity });
}

function reportByteSize(report) {
  const bitCount = (report.items || []).reduce(
    (total, item) => total + Number(item.reportSize || 0) * Number(item.reportCount || 0),
    0,
  );
  return bitCount > 0 ? Math.ceil(bitCount / 8) : null;
}

export function inspectHidDevice(device, explicit = {}) {
  const reports = (device.collections || []).flatMap((collection) =>
    (collection.outputReports || []).map((report) => ({
      reportId: report.reportId ?? 0,
      packetSize: reportByteSize(report),
    })),
  );
  let selection = null;
  if (explicit.reportId !== undefined && explicit.packetSize) {
    selection = { reportId: Number(explicit.reportId), packetSize: Number(explicit.packetSize) };
  } else {
    const usable = reports.filter((report) => report.packetSize);
    if (usable.length === 1) selection = usable[0];
  }
  if (!selection) {
    throw new Error("Report ID et taille HID requis dans la configuration avancee");
  }
  return {
    vendorId: device.vendorId.toString(16).padStart(4, "0").toUpperCase(),
    productId: device.productId.toString(16).padStart(4, "0").toUpperCase(),
    productName: device.productName || null,
    ...selection,
  };
}

export async function authorizeHidDevice(identity = {}) {
  if (!navigator.hid) throw new Error("WebHID n'est pas disponible dans cette version");
  selectionIntent(identity);
  const filter = {};
  if (identity.vendorId) filter.vendorId = Number.parseInt(identity.vendorId, 16);
  if (identity.productId) filter.productId = Number.parseInt(identity.productId, 16);
  const devices = await navigator.hid.requestDevice({
    filters: Object.keys(filter).length ? [filter] : [],
  });
  if (devices.length !== 1) throw new Error("Selection HID annulee ou ambigue");
  const device = devices[0];
  const base = {
    vendorId: device.vendorId.toString(16).padStart(4, "0").toUpperCase(),
    productId: device.productId.toString(16).padStart(4, "0").toUpperCase(),
    productName: device.productName || null,
  };
  try {
    return { ...base, ...inspectHidDevice(device, identity) };
  } catch {
    return base;
  }
}

export async function findAuthorizedHidDevice(identity = {}) {
  if (!navigator.hid) return null;
  const devices = await navigator.hid.getDevices();
  const matches = devices.filter((device) => sameHidIdentity(device, identity));
  if (matches.length > 1) {
    throw deviceError("Plusieurs imprimantes HID correspondent. Utilisez une file Windows distincte.", "AMBIGUOUS_DEVICE", { action: "select-unique-hid" });
  }
  return matches[0] || null;
}

export async function sendHidEscPos(device, config, bytes, { signal } = {}) {
  if (!device) {
    throw deviceError("Périphérique HID non autorisé", "PERMISSION_DENIED", { name: "NotAllowedError", action: "authorize-hid" });
  }
  let ownsDevice = false;
  let writing = false;
  const checkAbort = () => {
    if (signal?.aborted) throw deviceError("Envoi HID annulé", "ABORTED", { name: "AbortError", deliveryState: writing ? "unknown" : "not-sent" });
  };
  const cleanupTasks = [];
  const cleanup = () => {
    if (!ownsDevice) return;
    ownsDevice = false;
    const task = Promise.resolve().then(() => device.close());
    task.catch(() => {});
    cleanupTasks.push(task);
  };
  let result;
  let failure;
  signal?.addEventListener("abort", cleanup, { once: true });
  try {
    checkAbort();
    let selected;
    let reports;
    try {
      selected = inspectHidDevice(device, config);
      if (!Number.isInteger(selected.reportId) || selected.reportId < 0 || selected.reportId > 255) throw new Error("Report ID HID invalide");
      reports = chunkHidReports(bytes, selected.packetSize, selected.reportId, { pad: Boolean(config.padReports) });
    } catch (error) { throw deviceError(error.message, "CONFIGURATION", { action: "configure-hid" }); }
    if (!device.opened) {
      await device.open();
    }
    ownsDevice = true;
    checkAbort();
    for (const report of reports) {
      checkAbort();
      writing = true;
      await device.sendReport(report.reportId, report.data);
      checkAbort();
    }
    result = { reportCount: reports.length, bytesWritten: bytes.byteLength };
  } catch (error) {
    if (signal?.aborted) {
      failure = deviceError("Envoi HID annulé", "ABORTED", { name: "AbortError", deliveryState: writing ? "unknown" : "not-sent" });
    } else {
      const denied = ["NotAllowedError", "SecurityError"].includes(error.name) || /access|denied|busy/i.test(error.message || "");
      failure = typeof error.code === "string" && typeof error.retryable === "boolean" ? error : deviceError(error.message, denied ? "PERMISSION_DENIED" : writing ? "WRITE_FAILED" : "CONNECTION_FAILED", {
        name: error.name, retryable: !writing && !denied && error.name === "NetworkError", deliveryState: writing ? "unknown" : "not-sent", ...(denied ? { action: "authorize-hid" } : {}),
      });
    }
  } finally {
    signal?.removeEventListener("abort", cleanup);
    cleanup();
    if ((await Promise.allSettled(cleanupTasks)).some((entry) => entry.status === "rejected")) {
      failure ||= deviceError("Impossible de libérer le périphérique HID", "CLEANUP_FAILED", { deliveryState: writing ? "unknown" : "not-sent", action: "reconnect-hid" });
      failure.cleanupComplete = false;
    }
  }
  if (failure) throw failure;
  return result;
}
