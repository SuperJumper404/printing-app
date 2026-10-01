const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePrinterProfile,
} = require("../../lib/printers/printerProfiles");

test("automatic fallback never sends an unverified ESC/POS code-page number", () => {
  const profile = resolvePrinterProfile({
    name: "Thermal Printer",
    manufacturer: "Generic",
    encoding: "auto",
  });

  assert.deepEqual(profile, {
    id: "generic-safe",
    label: "Generique securise",
    source: "fallback",
    protocol: "escpos",
    encoding: "windows-1252",
    escPosCodePage: null,
    charsPerLine: 48,
  });
});

test("automatic Epson TM profile uses the Epson documented code-page table", () => {
  const profile = resolvePrinterProfile({
    name: "EPSON TM-T88VI Receipt",
    manufacturer: "Seiko Epson Corp.",
    encoding: "auto",
  });

  assert.equal(profile.id, "epson-tm-80mm");
  assert.equal(profile.source, "known");
  assert.equal(profile.encoding, "windows-1252");
  assert.equal(profile.escPosCodePage, 16);
  assert.equal(profile.charsPerLine, 48);
});

test("manual profile keeps the configured encoding, code page, and width", () => {
  const profile = resolvePrinterProfile({
    encoding: "cp850",
    escPosCodePage: 2,
    charsPerLine: 42,
  });

  assert.equal(profile.id, "manual");
  assert.equal(profile.source, "manual");
  assert.equal(profile.encoding, "cp850");
  assert.equal(profile.escPosCodePage, 2);
  assert.equal(profile.charsPerLine, 42);
});

test("raw and multibyte modes ignore an incompatible ESC t number", () => {
  for (const encoding of ["raw", "utf8", "gb18030"]) {
    const profile = resolvePrinterProfile({ encoding, escPosCodePage: 16 });
    assert.equal(profile.escPosCodePage, null, encoding);
  }
});
