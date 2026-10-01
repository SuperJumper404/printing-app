const KNOWN_PRINTER_PROFILES = Object.freeze([
  {
    id: "epson-tm-80mm",
    label: "Epson TM 80 mm",
    protocol: "escpos",
    encoding: "windows-1252",
    escPosCodePage: 16,
    charsPerLine: 48,
    matches(printer) {
      const identity = printerIdentityText(printer);
      return /epson/i.test(identity) && /\btm[-\s]/i.test(identity);
    },
  },
]);

function printerIdentityText(printer = {}) {
  const transportNames = Object.values(printer.transports || {})
    .flatMap((transport) => [
      transport?.config?.productName,
      transport?.config?.model,
      transport?.config?.driverName,
    ]);
  return [
    printer.manufacturer,
    printer.model,
    printer.productName,
    printer.name,
    ...transportNames,
  ].filter(Boolean).join(" ");
}

function normalizeEscPosCodePage(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255
    ? numeric
    : null;
}

function normalizeCharsPerLine(value, fallback = 48) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 24 && numeric <= 96
    ? numeric
    : fallback;
}

function resolvePrinterProfile(printer = {}) {
  if (printer.encoding && printer.encoding !== "auto") {
    const supportsCodePage = ["cp858", "cp850", "windows-1252"].includes(
      printer.encoding,
    );
    return {
      id: "manual",
      label: "Reglage manuel",
      source: "manual",
      protocol: "escpos",
      encoding: printer.encoding,
      escPosCodePage: supportsCodePage
        ? normalizeEscPosCodePage(printer.escPosCodePage)
        : null,
      charsPerLine: normalizeCharsPerLine(printer.charsPerLine),
    };
  }

  const known = KNOWN_PRINTER_PROFILES.find((profile) => profile.matches(printer));
  if (known) {
    return {
      id: known.id,
      label: known.label,
      source: "known",
      protocol: known.protocol,
      encoding: known.encoding,
      escPosCodePage: known.escPosCodePage,
      charsPerLine: normalizeCharsPerLine(printer.charsPerLine, known.charsPerLine),
    };
  }

  return {
    id: "generic-safe",
    label: "Generique securise",
    source: "fallback",
    protocol: "escpos",
    encoding: "windows-1252",
    escPosCodePage: null,
    charsPerLine: normalizeCharsPerLine(printer.charsPerLine),
  };
}

module.exports = {
  KNOWN_PRINTER_PROFILES,
  normalizeCharsPerLine,
  normalizeEscPosCodePage,
  resolvePrinterProfile,
};
