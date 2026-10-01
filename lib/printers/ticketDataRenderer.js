const LEGAL_REPLACEMENTS = [
  ["phone", "Telephone non renseigne"],
  ["address", "Adresse non renseignee"],
  ["siret", "SIRET non renseigne"],
  ["naf", "NAF non renseigne"],
  ["vatNumber", "TVA intracom non renseignee"],
];

function validateTicketData(ticketData) {
  if (!ticketData || typeof ticketData !== "object") {
    return { valid: false, error: "ticketData manquant" };
  }
  if (ticketData.schemaVersion !== 1) {
    return { valid: false, error: "schemaVersion ticketData invalide" };
  }
  if (!["cashier_receipt", "order_ticket"].includes(ticketData.kind)) {
    return { valid: false, error: "kind ticketData invalide" };
  }
  const sections = ticketData.render?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return { valid: false, error: "sections de rendu manquantes" };
  }
  const hasPrintableLine = sections.some((section) =>
    (section.lines || []).some((line) =>
      ["text", "columns", "separator", "qr", "feed", "cut"].includes(line?.type),
    ),
  );
  if (!hasPrintableLine) {
    return { valid: false, error: "lignes de rendu manquantes" };
  }
  return { valid: true };
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cashierLegalLines(ticketData) {
  if (ticketData?.kind !== "cashier_receipt") return [];
  const shop = ticketData.business?.shop || {};
  return LEGAL_REPLACEMENTS
    .filter(([key]) => !String(shop[key] || "").trim())
    .map(([, text]) => ({ type: "text", text, align: "center" }));
}

function allRenderLines(ticketData) {
  const sections = ticketData.render?.sections || [];
  const lines = sections.flatMap((section, index) => {
    const sectionLines = Array.isArray(section.lines) ? section.lines : [];
    if (index === 0) return [...sectionLines, ...cashierLegalLines(ticketData)];
    return sectionLines;
  });
  return lines;
}

function clampWidth(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function renderWidth(ticketData, options = {}) {
  const paperWidth = clampWidth(ticketData?.render?.paperWidth, 32);
  const charsPerLine = clampWidth(options.charsPerLine, paperWidth);
  return Math.min(paperWidth, charsPerLine);
}

function fitCell(value, width, align = "left") {
  const text = String(value ?? "");
  const clipped = text.length > width ? text.slice(0, width) : text;
  return align === "right" ? clipped.padStart(width) : clipped.padEnd(width);
}

function columnsText(line, width = 32) {
  const columns = Array.isArray(line.columns) ? line.columns : [];
  const visibleColumns = columns
    .filter((column) => Number(column.width) > 0)
    .map((column) => ({
      ...column,
      effectiveWidth: Math.max(
        clampWidth(column.width, 0),
        column.key === "name" ? 0 : String(column.text ?? "").length,
      ),
    }));
  if (!visibleColumns.length) return String(line.fallbackText || "");

  const fixedWidth = visibleColumns
    .filter((column) => column.key !== "name")
    .reduce((sum, column) => sum + column.effectiveWidth, 0);
  const preferredNameWidth = visibleColumns
    .filter((column) => column.key === "name")
    .reduce((sum, column) => sum + column.effectiveWidth, 0);
  const overflow = Math.max(0, fixedWidth + preferredNameWidth - width);
  let remainingOverflow = overflow;

  return visibleColumns
    .map((column) => {
      const preferred = column.effectiveWidth;
      const shrinkable = column.key === "name"
        ? Math.min(remainingOverflow, Math.max(0, preferred - 1))
        : 0;
      remainingOverflow -= shrinkable;
      return fitCell(column.text, preferred - shrinkable, column.align);
    })
    .join("")
    .slice(0, width);
}

function lineToText(line, width = 32) {
  if (!line || typeof line !== "object") return [];
  if (line.type === "text") return [String(line.text ?? "")];
  if (line.type === "columns") return [columnsText(line, width)];
  if (line.type === "separator") return ["-".repeat(width)];
  if (line.type === "qr") {
    return [line.label, line.value ? `[QR] ${line.value}` : ""].filter(Boolean);
  }
  if (line.type === "feed") return Array(Math.max(0, Number(line.lines) || 0)).fill("");
  return [];
}

function ensureValid(ticketData) {
  const result = validateTicketData(ticketData);
  if (!result.valid) throw new Error(result.error);
}

function renderTicketDataText(ticketData, options = {}) {
  ensureValid(ticketData);
  const width = renderWidth(ticketData, options);
  return allRenderLines(ticketData)
    .flatMap((line) => lineToText(line, width))
    .join("\n")
    .replace(/\n{5,}$/g, "\n\n\n\n");
}

function escPosAlign(align) {
  if (align === "center") return Buffer.from([0x1b, 0x61, 1]);
  if (align === "right") return Buffer.from([0x1b, 0x61, 2]);
  return Buffer.from([0x1b, 0x61, 0]);
}

function escPosSize(size) {
  if (size === "triple") return Buffer.from([0x1d, 0x21, 0x22]);
  if (size === "double") return Buffer.from([0x1d, 0x21, 0x11]);
  if (size === "double-height") return Buffer.from([0x1d, 0x21, 0x01]);
  return Buffer.from([0x1d, 0x21, 0x00]);
}

function lineEscPosSize(line) {
  if (line?.type === "columns" && line.size === "double") return "double-height";
  return line?.size;
}

function escPosLine(line, width = 32) {
  if (!line || typeof line !== "object") return [];
  if (line.type === "cut") return [Buffer.from([0x1d, 0x56, 0x00])];
  if (line.type === "feed") {
    return [Buffer.from("\n".repeat(Math.max(0, Number(line.lines) || 0)), "utf8")];
  }
  const text = lineToText(line, width).join("\n");
  if (!text && line.type !== "separator") return [];
  return [
    escPosAlign(line.align),
    Buffer.from([0x1b, 0x45, line.bold ? 1 : 0]),
    escPosSize(lineEscPosSize(line)),
    Buffer.from(`${text}\n`, "utf8"),
    escPosSize("normal"),
    Buffer.from([0x1b, 0x45, 0]),
  ];
}

function renderTicketDataEscPos(ticketData, options = {}) {
  ensureValid(ticketData);
  const width = renderWidth(ticketData, options);
  const buffers = [
    Buffer.from([0x1b, 0x40]),
    ...allRenderLines(ticketData).flatMap((line) => escPosLine(line, width)),
  ];
  return Buffer.concat(buffers).toString("base64");
}

function eposLine(line, width = 32) {
  if (!line || typeof line !== "object") return "";
  if (line.type === "cut") return "<cut/>";
  if (line.type === "feed") {
    return `<feed line="${Math.max(0, Number(line.lines) || 0)}"/>`;
  }
  if (line.type === "qr") {
    return [
      line.label
        ? `<text align="center">${escapeXml(line.label)}</text><feed line="1"/>`
        : "",
      line.value
        ? `<symbol type="qrcode" level="h" width="6" height="6">${escapeXml(line.value)}</symbol><feed line="1"/>`
        : "",
    ].join("");
  }
  const attrs = [
    `align="${line.align || "left"}"`,
    line.bold ? 'em="true"' : "",
    lineEscPosSize(line) === "double" ? 'width="2" height="2"' : "",
    lineEscPosSize(line) === "double-height" ? 'height="2"' : "",
    line.size === "triple" ? 'width="3" height="3"' : "",
  ].filter(Boolean).join(" ");
  return `<text ${attrs}>${escapeXml(lineToText(line, width).join("\n"))}</text><feed line="1"/>`;
}

function renderTicketDataEposXml(ticketData, options = {}) {
  ensureValid(ticketData);
  const width = renderWidth(ticketData, options);
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${allRenderLines(ticketData).map((line) => eposLine(line, width)).join("")}</epos-print>`;
}

module.exports = {
  renderTicketDataEposXml,
  renderTicketDataEscPos,
  renderTicketDataText,
  validateTicketData,
};
