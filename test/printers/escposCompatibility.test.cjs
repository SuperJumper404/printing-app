const test = require("node:test");
const assert = require("node:assert/strict");

const {
  prepareEscPosPayload,
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

test("converts UTF-8 receipt text to single-byte Windows-1252", () => {
  const payload = Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from("R\u00f4ti: 3,00 \u20ac", "utf8"),
    Buffer.from([0x0a]),
  ]).toString("base64");

  const result = Buffer.from(prepareEscPosPayload(payload), "base64");

  assert.deepEqual(
    result,
    Buffer.from([
      0x1b, 0x40,
      0x1b, 0x74, 0x10,
      0x52, 0xf4, 0x74, 0x69, 0x3a, 0x20,
      0x33, 0x2c, 0x30, 0x30, 0x20, 0x80, 0x0a,
    ]),
  );
});

test("does not transcode binary raster payloads", () => {
  const payload = Buffer.from([
    0x1d, 0x76, 0x30, 0x00, 0x03, 0x00, 0x01, 0x00,
    0xe2, 0x82, 0xac,
  ]).toString("base64");

  const result = Buffer.from(prepareEscPosPayload(payload), "base64");

  assert.deepEqual(
    result,
    Buffer.from([
      0x1b, 0x74, 0x10,
      0x1d, 0x76, 0x30, 0x00, 0x03, 0x00, 0x01, 0x00,
      0xe2, 0x82, 0xac,
    ]),
  );
});

test("supports CP858, UTF-8, GB18030, and raw printer profiles", () => {
  const utf8Euro = Buffer.from("\u20ac", "utf8").toString("base64");
  const chinese = Buffer.from("\u4e2d", "utf8").toString("base64");

  assert.deepEqual(
    Buffer.from(prepareEscPosPayload(utf8Euro, "cp858"), "base64"),
    Buffer.from([0x1b, 0x74, 0x13, 0xd5]),
  );
  assert.deepEqual(
    Buffer.from(prepareEscPosPayload(utf8Euro, "utf8"), "base64"),
    Buffer.from(utf8Euro, "base64"),
  );
  assert.deepEqual(
    Buffer.from(prepareEscPosPayload(chinese, "gb18030"), "base64"),
    Buffer.from([0xd6, 0xd0]),
  );
  assert.deepEqual(
    Buffer.from(prepareEscPosPayload(utf8Euro, "raw"), "base64"),
    Buffer.from(utf8Euro, "base64"),
  );
});
