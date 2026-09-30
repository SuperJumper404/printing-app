const test = require("node:test");
const assert = require("node:assert/strict");

const { encodeTlv, createTlvDecoder } = require("../../lib/terminals/tlv");

test("encodes a two-character tag with a three-digit value length", () => {
  assert.equal(encodeTlv([["CZ", "0320"]]).toString("ascii"), "CZ0040320");
});

test("rejects duplicate tags while encoding and decoding", () => {
  assert.throws(() => encodeTlv([["CZ", "0320"], ["CZ", "0300"]]), /duplique/i);

  const decoder = createTlvDecoder();
  assert.throws(() => decoder.push(Buffer.from("CZ0040320CZ0040300", "ascii")), /duplique/i);
});

test("rejects zero, nonnumeric, and incomplete lengths", () => {
  for (const frame of ["CZ000", "CZABC0320"]) {
    const decoder = createTlvDecoder();
    assert.throws(() => decoder.push(Buffer.from(frame, "ascii")), /longueur/i);
  }

  const decoder = createTlvDecoder();
  decoder.push(Buffer.from("CZ00403", "ascii"));
  assert.throws(() => decoder.finish(), /incomplete/i);
});

test("buffers chunks split inside tags, lengths, and values", () => {
  const decoder = createTlvDecoder();
  assert.deepEqual(decoder.push(Buffer.from("C", "ascii")), []);
  assert.deepEqual(decoder.push(Buffer.from("Z00", "ascii")), []);
  assert.deepEqual(decoder.push(Buffer.from("403", "ascii")), []);
  assert.deepEqual(decoder.push(Buffer.from("20AE00210", "ascii")), [
    { tag: "CZ", value: "0320" },
    { tag: "AE", value: "10" },
  ]);
  assert.deepEqual(decoder.finish(), [
    { tag: "CZ", value: "0320" },
    { tag: "AE", value: "10" },
  ]);
});

test("accepts unknown uppercase tags and a 999-byte value", () => {
  const value = "X".repeat(999);
  const encoded = encodeTlv([["ZZ", value]]);
  const decoder = createTlvDecoder();
  decoder.push(encoded);
  assert.deepEqual(decoder.finish(), [{ tag: "ZZ", value }]);
});

test("rejects invalid tags and non-ASCII values", () => {
  assert.throws(() => encodeTlv([["A1", "value"]]), /tag/i);
  assert.throws(() => encodeTlv([["AA", "café"]]), /ASCII/i);
});
