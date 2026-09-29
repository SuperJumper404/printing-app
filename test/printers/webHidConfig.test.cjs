const test = require("node:test");
const assert = require("node:assert/strict");

const {
  chunkHidReports,
  describeHidAvailability,
} = require("../../lib/printers/webHidConfig");

test("chunks HID reports exactly and preserves the report ID", () => {
  const reports = chunkHidReports(Uint8Array.from([1, 2, 3, 4, 5]), 2, 7);
  assert.deepEqual(
    reports.map((report) => ({ reportId: report.reportId, data: [...report.data] })),
    [
      { reportId: 7, data: [1, 2] },
      { reportId: 7, data: [3, 4] },
      { reportId: 7, data: [5] },
    ],
  );
});

test("pads only the final report and only when configured", () => {
  const unpadded = chunkHidReports(Uint8Array.from([1, 2, 3]), 4, 0);
  const padded = chunkHidReports(Uint8Array.from([1, 2, 3]), 4, 0, { pad: true });
  assert.deepEqual([...unpadded[0].data], [1, 2, 3]);
  assert.deepEqual([...padded[0].data], [1, 2, 3, 0]);
});

test("rejects zero and negative HID report sizes", () => {
  assert.throws(() => chunkHidReports(Uint8Array.from([1]), 0, 0), /taille/i);
  assert.throws(() => chunkHidReports(Uint8Array.from([1]), -8, 0), /taille/i);
});

test("keeps detected but unauthorized HID devices visible", () => {
  assert.deepEqual(describeHidAvailability({ detected: true, authorized: false }), {
    available: true,
    authorized: false,
    reason: "Autorisation HID requise",
  });
  assert.match(describeHidAvailability({ detected: false }).reason, /non detecte/i);
});
