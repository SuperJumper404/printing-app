function assertTag(tag) {
  if (!/^[A-Z]{2}$/.test(tag)) {
    throw new Error(`Tag TLV invalide: ${tag}`);
  }
}

function assertAscii(value) {
  if (!/^[\x20-\x7e]+$/.test(value)) {
    throw new Error("Valeur TLV non ASCII");
  }
}

function encodeTlv(entries) {
  const seen = new Set();
  const parts = [];

  for (const [tag, rawValue] of entries || []) {
    assertTag(tag);
    if (seen.has(tag)) throw new Error(`Tag TLV duplique: ${tag}`);
    seen.add(tag);

    const value = String(rawValue ?? "");
    if (!value.length || value.length > 999) {
      throw new Error(`Longueur TLV invalide pour ${tag}`);
    }
    assertAscii(value);
    parts.push(`${tag}${String(value.length).padStart(3, "0")}${value}`);
  }

  return Buffer.from(parts.join(""), "ascii");
}

function createTlvDecoder() {
  let pending = "";
  const entries = [];
  const seen = new Set();

  function push(chunk) {
    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || "");
    for (const byte of input) {
      if (byte < 0x20 || byte > 0x7e) throw new Error("Trame TLV non ASCII");
    }
    pending += input.toString("ascii");
    const parsed = [];

    while (pending.length >= 5) {
      const tag = pending.slice(0, 2);
      const lengthText = pending.slice(2, 5);
      assertTag(tag);
      if (!/^\d{3}$/.test(lengthText)) {
        throw new Error(`Longueur TLV non numerique pour ${tag}`);
      }
      const length = Number(lengthText);
      if (length < 1) throw new Error(`Longueur TLV invalide pour ${tag}`);
      if (pending.length < 5 + length) break;
      if (seen.has(tag)) throw new Error(`Tag TLV duplique: ${tag}`);

      const value = pending.slice(5, 5 + length);
      seen.add(tag);
      const entry = { tag, value };
      entries.push(entry);
      parsed.push(entry);
      pending = pending.slice(5 + length);
    }

    return parsed;
  }

  function finish() {
    if (pending.length) throw new Error("Trame TLV incomplete");
    return entries.slice();
  }

  return { push, finish };
}

module.exports = { encodeTlv, createTlvDecoder };
