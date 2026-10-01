const TRANSPORT_LABELS = Object.freeze({
  windowsRaw: "File Windows RAW",
  network9100: "ESC/POS reseau 9100",
  ipp: "IPP",
  lpr: "LPR",
  eposHttp: "Epson ePOS HTTP",
  usbSerial: "USB COM",
  bluetoothSerial: "Bluetooth COM",
  usbRaw: "USB direct",
  usbHid: "USB HID",
  bluetoothGatt: "Bluetooth GATT",
});

function printerModel(printer = {}) {
  return printer.model || printer.productName || Object.values(printer.transports || {})
    .map((transport) => transport?.config?.productName || transport?.config?.model)
    .find(Boolean) || "-";
}

function wrapLine(line, width) {
  const output = [];
  let remaining = String(line);
  while (remaining.length > width) {
    let split = remaining.lastIndexOf(" ", width);
    if (split < Math.floor(width / 2)) split = width;
    output.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  output.push(remaining);
  return output;
}

function buildPrinterTestPayload(printer, profile) {
  const width = profile.charsPerLine;
  const activeTransports = Object.entries(printer.transports || {})
    .filter(([, transport]) => transport?.enabled)
    .map(([transportId]) => TRANSPORT_LABELS[transportId] || transportId);
  const profileSource = {
    known: "connu",
    manual: "manuel",
    fallback: "repli securise",
  }[profile.source] || profile.source;
  const lines = [
    "TEST IMPRIMANTE SMARTEAT",
    "=".repeat(Math.min(width, 48)),
    `Nom: ${printer.name || "-"}`,
    `Fabricant: ${printer.manufacturer || "-"}`,
    `Modele: ${printerModel(printer)}`,
    `VID/PID: ${printer.vendorId || "----"} / ${printer.productId || "----"}`,
    `Profil: ${profile.label} (${profileSource})`,
    `Encodage: ${profile.encoding}`,
    `ESC t n: ${profile.escPosCodePage ?? "non envoye"}`,
    `Largeur: ${width} caracteres`,
    `Tickets: caisse=${printer.ticketTypes?.caisse ? "oui" : "non"}, cuisine=${printer.ticketTypes?.cuisine ? "oui" : "non"}`,
    "Modes actifs:",
    ...(activeTransports.length ? activeTransports.map((label) => `- ${label}`) : ["- aucun"]),
    "-".repeat(Math.min(width, 48)),
    "Test caracteres:",
    "é è ê à ç ù ô €",
    "",
    "",
  ].flatMap((line) => wrapLine(line, width));

  const initialize = Buffer.from([0x1b, 0x40]);
  const text = Buffer.from(lines.join("\n"), "utf8");
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  return Buffer.concat([initialize, text, cut]).toString("base64");
}

module.exports = {
  TRANSPORT_LABELS,
  buildPrinterTestPayload,
};
