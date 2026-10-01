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

function columnsText(line) {
  if (line.fallbackText) return String(line.fallbackText);
  return (line.columns || []).map((column) => column.text || "").join(" ").trim();
}

function lineToText(line) {
  if (!line || typeof line !== "object") return [];
  if (line.type === "text") return [String(line.text ?? "")];
  if (line.type === "columns") return [columnsText(line)];
  if (line.type === "separator") return ["--------------------------------"];
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

function renderTicketDataText(ticketData) {
  ensureValid(ticketData);
  return allRenderLines(ticketData)
    .flatMap(lineToText)
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
  return Buffer.from([0x1d, 0x21, 0x00]);
}

function escPosLine(line) {
  if (!line || typeof line !== "object") return [];
  if (line.type === "cut") return [Buffer.from([0x1d, 0x56, 0x00])];
  if (line.type === "feed") {
    return [Buffer.from("\n".repeat(Math.max(0, Number(line.lines) || 0)), "utf8")];
  }
  const text = lineToText(line).join("\n");
  if (!text && line.type !== "separator") return [];
  return [
    escPosAlign(line.align),
    Buffer.from([0x1b, 0x45, line.bold ? 1 : 0]),
    escPosSize(line.size),
    Buffer.from(`${text}\n`, "utf8"),
    escPosSize("normal"),
    Buffer.from([0x1b, 0x45, 0]),
  ];
}

function renderTicketDataEscPos(ticketData) {
  ensureValid(ticketData);
  const buffers = [
    Buffer.from([0x1b, 0x40]),
    ...allRenderLines(ticketData).flatMap(escPosLine),
  ];
  return Buffer.concat(buffers).toString("base64");
}

function eposLine(line) {
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
  const text = lineToText(line).join("\n");
  const attrs = [
    `align="${line.align || "left"}"`,
    line.bold ? 'em="true"' : "",
    line.size === "double" ? 'width="2" height="2"' : "",
    line.size === "triple" ? 'width="3" height="3"' : "",
  ].filter(Boolean).join(" ");
  return `<text ${attrs}>${escapeXml(text)}</text><feed line="1"/>`;
}

function renderTicketDataEposXml(ticketData) {
  ensureValid(ticketData);
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${allRenderLines(ticketData).map(eposLine).join("")}</epos-print>`;
}

module.exports = {
  renderTicketDataEposXml,
  renderTicketDataEscPos,
  renderTicketDataText,
  validateTicketData,
};
