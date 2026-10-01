const {
  renderTicketDataText,
  validateTicketData,
} = require("./ticketDataRenderer");

function stripEscPosCommands(buffer) {
  const output = [];

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    const next = buffer[i + 1];

    if (byte === 0x1b) {
      if ([0x40, 0x45, 0x61, 0x74, 0x21, 0x4d, 0x33, 0x20].includes(next)) {
        i += next === 0x40 ? 1 : 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (byte === 0x1d) {
      if ([0x21, 0x56, 0x42, 0x48, 0x68, 0x77].includes(next)) {
        i += next === 0x56 ? 2 : 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (byte === 0x0a || byte === 0x0d || byte >= 0x20) {
      output.push(byte);
    }
  }

  return Buffer.from(output);
}

function normalizeTicketText(text) {
  return text
    .replace(/\x80/g, "EUR")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{4,}$/g, "\n");
}

function getTicketPrintableText(payload) {
  if (!payload) return "";

  if (payload.ticketData && validateTicketData(payload.ticketData).valid) {
    return normalizeTicketText(renderTicketDataText(payload.ticketData));
  }

  const directText =
    payload.text ||
    payload.ticketText ||
    payload.content ||
    payload.printableText ||
    payload.rawText;

  if (directText) return normalizeTicketText(String(directText));

  if (!payload.dataFormatESCPOS) return "";

  try {
    const printableBuffer = stripEscPosCommands(
      Buffer.from(payload.dataFormatESCPOS, "base64"),
    );
    return normalizeTicketText(printableBuffer.toString("latin1"));
  } catch {
    return "";
  }
}

module.exports = {
  getTicketPrintableText,
};
