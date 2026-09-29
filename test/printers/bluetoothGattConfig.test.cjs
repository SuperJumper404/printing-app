const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chunkGattWrites,
  normalizeGattUuid,
  describeGattAvailability,
  selectGattWriteMethod,
  sendGattChunks,
} = require("../../lib/printers/bluetoothGattConfig");

test("chunks GATT writes to the configured maximum size", () => {
  assert.deepEqual(
    chunkGattWrites(Uint8Array.from([1, 2, 3, 4, 5]), 2).map((chunk) => [...chunk]),
    [[1, 2], [3, 4], [5]],
  );
  assert.throws(() => chunkGattWrites(Uint8Array.from([1]), 0), /taille/i);
});

test("normalizes valid Bluetooth UUIDs and rejects invalid values", () => {
  assert.equal(normalizeGattUuid("FFE0"), "0000ffe0-0000-1000-8000-00805f9b34fb");
  assert.equal(
    normalizeGattUuid("12345678-1234-5678-9abc-def012345678"),
    "12345678-1234-5678-9abc-def012345678",
  );
  assert.throws(() => normalizeGattUuid("not-a-uuid"), /UUID/i);
});

test("keeps detected but unpaired Bluetooth devices visible", () => {
  assert.deepEqual(describeGattAvailability({ detected: true, paired: false }), {
    available: true,
    paired: false,
    reason: "Association Bluetooth requise",
  });
});

test("prefers writes without response and rejects non-writable characteristics", () => {
  assert.equal(
    selectGattWriteMethod({ properties: { writeWithoutResponse: true, write: true } }),
    "writeValueWithoutResponse",
  );
  assert.equal(
    selectGattWriteMethod({ properties: { writeWithoutResponse: false, write: true } }),
    "writeValueWithResponse",
  );
  assert.throws(() => selectGattWriteMethod({ properties: {} }), /ecriture/i);
});

test("writes chunks in order and disconnects once", async () => {
  const writes = [];
  let disconnectCount = 0;
  await sendGattChunks(
    [Uint8Array.from([1]), Uint8Array.from([2])],
    async (chunk) => writes.push([...chunk]),
    () => { disconnectCount += 1; },
  );
  assert.deepEqual(writes, [[1], [2]]);
  assert.equal(disconnectCount, 1);
});

test("does not retry a failed chunk and still disconnects", async () => {
  let attempts = 0;
  let disconnected = false;
  await assert.rejects(
    sendGattChunks(
      [Uint8Array.from([1]), Uint8Array.from([2]), Uint8Array.from([3])],
      async () => {
        attempts += 1;
        if (attempts === 2) throw new Error("link lost");
      },
      () => { disconnected = true; },
    ),
    /link lost/,
  );
  assert.equal(attempts, 2);
  assert.equal(disconnected, true);
});
