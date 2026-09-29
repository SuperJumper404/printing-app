import hidConfig from "../../lib/printers/webHidConfig.js";

const { chunkHidReports } = hidConfig;

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
  return devices.find((device) => sameHidIdentity(device, identity)) || null;
}

export async function sendHidEscPos(device, config, bytes) {
  if (!device) {
    const error = new Error("Peripherique HID non autorise");
    error.name = "NotAllowedError";
    error.action = "authorize-hid";
    throw error;
  }
  const selected = inspectHidDevice(device, config);
  const reports = chunkHidReports(bytes, selected.packetSize, selected.reportId, {
    pad: Boolean(config.padReports),
  });
  let openedHere = false;
  try {
    if (!device.opened) {
      await device.open();
      openedHere = true;
    }
    for (const report of reports) {
      await device.sendReport(report.reportId, report.data);
    }
    return { reportCount: reports.length, bytesWritten: bytes.byteLength };
  } finally {
    if (openedHere) {
      try { await device.close(); } catch {}
    }
  }
}
