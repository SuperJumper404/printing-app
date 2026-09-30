const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyUsbCodePage,
} = require("../../lib/printers/escposCompatibility");

test("selects Windows-1252 after an ESC/POS initialize command", () => {
  const payload = Buffer.from([0x1b, 0x40, 0x41, 0x80, 0x0a]).toString("base64");

  const result = Buffer.from(applyUsbCodePage(payload), "base64");

  assert.deepEqual(
    result,
    Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x10, 0x41, 0x80, 0x0a]),
  );
});

test("selects Windows-1252 before a payload without initialization", () => {
  const payload = Buffer.from([0x41, 0x80, 0x0a]).toString("base64");

  const result = Buffer.from(applyUsbCodePage(payload), "base64");

  assert.deepEqual(result, Buffer.from([0x1b, 0x74, 0x10, 0x41, 0x80, 0x0a]));
});

test("allows an explicit ESC/POS code-page number", () => {
  const payload = Buffer.from("A", "ascii").toString("base64");

  const result = Buffer.from(applyUsbCodePage(payload, 19), "base64");

  assert.deepEqual(result, Buffer.from([0x1b, 0x74, 0x13, 0x41]));
});
