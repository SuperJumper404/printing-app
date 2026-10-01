const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildPrinterTestPayload } = require("../../lib/printers/testTicket");

test("test ticket contains printer identity, profile, routing, and character sample", () => {
  const base64 = buildPrinterTestPayload({
    name: "Caisse principale",
    manufacturer: "Epson",
    model: "TM-T88VI",
    vendorId: "04B8",
    productId: "0E15",
    ticketTypes: { caisse: true, cuisine: false },
    transports: {
      windowsRaw: { enabled: true },
      network9100: { enabled: true },
      usbRaw: { enabled: false },
    },
  }, {
    id: "epson-tm-80mm",
    label: "Epson TM 80 mm",
    source: "known",
    encoding: "windows-1252",
    escPosCodePage: 16,
    charsPerLine: 48,
  });
  const bytes = Buffer.from(base64, "base64");
  const text = bytes.subarray(0, -3).toString("utf8");

  assert.match(text, /Nom: Caisse principale/);
  assert.match(text, /Fabricant: Epson/);
  assert.match(text, /Modele: TM-T88VI/);
  assert.match(text, /VID\/PID: 04B8 \/ 0E15/);
  assert.match(text, /Profil: Epson TM 80 mm \(connu\)/);
  assert.match(text, /Encodage: windows-1252/);
  assert.match(text, /ESC t n: 16/);
  assert.match(text, /Largeur: 48 caracteres/);
  assert.match(text, /Tickets: caisse=oui, cuisine=non/);
  assert.match(text, /File Windows RAW/);
  assert.match(text, /ESC\/POS reseau 9100/);
  assert.match(text, /é è ê à ç ù ô €/);
  assert.deepEqual(bytes.subarray(-3), Buffer.from([0x1d, 0x56, 0x00]));
});

test("printer test handler builds the diagnostic from the complete printer", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../index.js"), "utf8");

  assert.match(
    source,
    /testPrinterTransports\(\s*currentPrinter,\s*buildTestPayload\(currentPrinter\)/,
  );
});
