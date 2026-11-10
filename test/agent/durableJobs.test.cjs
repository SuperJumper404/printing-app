const test = require("node:test");
const assert = require("node:assert/strict");
let createDurableJobs;
try { ({ createDurableJobs } = require("../../lib/agent/durableJobs")); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
function memoryStore(initial = {}) {
  const data = structuredClone(initial);
  return { get: (key, fallback) => structuredClone(data[key] ?? fallback), set: (key, value) => { data[key] = structuredClone(value); } };
}

test("jobs persist before sending and duplicate upstream IDs share the existing result", async () => {
  assert.equal(typeof createDurableJobs, "function");
  const store = memoryStore();
  let sends = 0;
  const jobs = createDurableJobs({ store, execute: async () => {
    sends += 1;
    assert.equal(store.get("durableJobs")[0].state, "sending");
    return { success: true, status: "success" };
  } });
  await jobs.start();
  const first = await jobs.submit({ base64Data: "QQ==" }, { dedupeKey: "poll:shop:1" });
  const duplicate = await jobs.submit({ base64Data: "QQ==" }, { dedupeKey: "poll:shop:1" });
  assert.equal(sends, 1);
  assert.equal(first.durableJobId, duplicate.durableJobId);
  assert.equal(jobs.list()[0].state, "completed");
  await jobs.stop();
});

test("restart marks interrupted sends unknown and resumes only never-started queued work", async () => {
  assert.equal(typeof createDurableJobs, "function");
  const store = memoryStore({ durableJobs: [
    { id: "interrupted", state: "sending", payload: { label: "uncertain" } },
    { id: "pending", state: "queued", payload: { label: "safe" } },
  ] });
  const sent = [];
  const jobs = createDurableJobs({ store, execute: async (payload) => { sent.push(payload.label); return { success: true }; } });
  await jobs.start();
  assert.deepEqual(sent, ["safe"]);
  assert.equal(jobs.list().find((job) => job.id === "interrupted").state, "unknown");
  await jobs.stop();
});

test("uncertain results are retained and never automatically retried", async () => {
  assert.equal(typeof createDurableJobs, "function");
  const store = memoryStore();
  let calls = 0;
  const jobs = createDurableJobs({ store, execute: async () => { calls += 1; return { success: false, status: "unknown", results: [{ deliveryState: "unknown" }] }; } });
  await jobs.start();
  await jobs.submit({ base64Data: "QQ==" });
  await jobs.retryPending();
  assert.equal(calls, 1);
  assert.equal(jobs.list()[0].state, "unknown");
  await jobs.stop();
});

test("known unsent transient destinations wait and resume without replaying successful protocols", async () => {
  assert.equal(typeof createDurableJobs, "function");
  const store = memoryStore();
  const selected = [];
  let time = 1000;
  let calls = 0;
  const jobs = createDurableJobs({ store, now: () => time, retryIntervalMs: 100,
    execute: async (_payload, options) => {
      selected.push(options.retryTargets);
      calls += 1;
      return calls === 1 ? { success: true, status: "partial", results: [
        { printerId: "p", transportId: "network9100", success: true, deliveryState: "submitted" },
        { printerId: "p", transportId: "usbRaw", success: false, deliveryState: "not-sent", retryable: true, code: "COMPANION_OFFLINE" },
        { printerId: "p", transportId: "ipp", success: false, deliveryState: "unknown", retryable: false },
      ] } : { success: true, results: [{ printerId: "p", transportId: "usbRaw", success: true, deliveryState: "submitted" }] };
    },
  });
  await jobs.start();
  await jobs.submit({ base64Data: "QQ==" });
  assert.equal(jobs.list()[0].state, "waiting");
  await jobs.retryPending();
  assert.equal(calls, 1);
  time = 1100;
  await jobs.retryPending();
  assert.equal(calls, 2);
  assert.deepEqual(selected[1], [{ printerId: "p", transportId: "usbRaw" }]);
  const record = jobs.list()[0];
  assert.equal(record.state, "unknown");
  assert.equal(record.result.results.filter((result) => result.success).length, 2);
  await jobs.retryPending();
  assert.equal(calls, 2);
  await jobs.stop();
});

test("waiting jobs expire after their safe retry window and remain visible", async () => {
  assert.equal(typeof createDurableJobs, "function");
  let time = 100;
  let calls = 0;
  const jobs = createDurableJobs({ store: memoryStore(), now: () => time, retryIntervalMs: 10, maxRetryAgeMs: 50,
    execute: async () => { calls += 1; return { success: false, results: [{ printerId: "p", transportId: "usbRaw", success: false, retryable: true, deliveryState: "not-sent" }] }; },
  });
  await jobs.start(); await jobs.submit({});
  assert.equal(jobs.list()[0].state, "waiting");
  time = 151;
  await jobs.retryPending();
  assert.equal(calls, 1);
  assert.equal(jobs.list()[0].state, "failed");
  await jobs.stop();
});

test("an unexpected error during a resumed destination becomes uncertain and cannot be replayed", async () => {
  let time = 100;
  let calls = 0;
  const jobs = createDurableJobs({ store: memoryStore(), now: () => time, retryIntervalMs: 10,
    execute: async () => {
      calls += 1;
      if (calls > 1) throw new Error("Unexpected adapter failure");
      return { success: false, results: [{ printerId: "p", transportId: "usbRaw", success: false, retryable: true, deliveryState: "not-sent" }] };
    },
  });
  await jobs.start(); await jobs.submit({}); time = 110;
  await jobs.retryPending();
  assert.equal(jobs.list()[0].state, "unknown");
  time = 200;
  await jobs.retryPending(); assert.equal(calls, 2);
  await jobs.stop();
});

test("temporarily removed destinations do not erase already successful protocol results", async () => {
  let time = 0;
  let calls = 0;
  const jobs = createDurableJobs({ store: memoryStore(), now: () => time, retryIntervalMs: 10,
    execute: async () => ++calls === 1 ? { success: true, results: [
      { printerId: "p", transportId: "network9100", success: true, deliveryState: "submitted" },
      { printerId: "p", transportId: "usbRaw", success: false, deliveryState: "not-sent", retryable: true },
    ] } : { success: false, status: "error", results: [], error: "Aucun transport actif" },
  });
  await jobs.start(); await jobs.submit({}); time = 10;
  await jobs.retryPending();
  assert.equal(jobs.list()[0].result.success, true);
  assert.equal(jobs.list()[0].result.status, "partial");
  assert.equal(jobs.list()[0].state, "waiting");
  await jobs.stop();
});

test("completed journal retention is bounded while uncertain, pending and failed destinations remain", async () => {
  const store = memoryStore({ durableJobs: [
    ...[1, 2, 3].map((id) => ({ id: `done-${id}`, state: "completed", finishedAt: id, payload: { privateTicket: id }, result: { success: true } })),
    { id: "queued", state: "queued", payload: {} },
    { id: "waiting", state: "waiting", createdAt: Date.now(), nextAttemptAt: Date.now() + 60000, payload: {}, result: { results: [] } },
    { id: "unknown", state: "unknown", payload: {} },
    { id: "failed", state: "failed", payload: {} },
    { id: "partial", state: "completed", payload: {}, result: { success: true, results: [{ success: true }, { success: false }] } },
  ] });
  const jobs = createDurableJobs({ store, maxCompletedEntries: 2, execute: async () => ({ success: true }) });
  assert.deepEqual(jobs.list().filter((record) => record.id.startsWith("done-")).map((record) => record.id), ["done-2", "done-3"]);
  for (const id of ["queued", "waiting", "unknown", "failed", "partial"]) assert.ok(jobs.list().some((record) => record.id === id));
  await jobs.stop();
});

test("interrupted sends publish recovered unknown history exactly once and never replay", async () => {
  const store = memoryStore({ durableJobs: [{ id: "interrupted", state: "sending", payload: { rawText: "synthetic" } }] });
  let histories = 0;
  let executions = 0;
  const configuration = { store, execute: async () => { executions += 1; return { success: true }; },
    onResult: async (_payload, result) => { histories += 1; assert.equal(result.durableJobId, "interrupted"); return { ...result, historyEntry: { durableJobId: result.durableJobId } }; },
  };
  const first = createDurableJobs(configuration);
  await first.start(); await first.start(); await first.stop();
  const restarted = createDurableJobs(configuration);
  await restarted.start(); await restarted.stop();
  assert.equal(histories, 1);
  assert.equal(executions, 0);
  assert.equal(restarted.list()[0].state, "unknown");
});

test("compacting completed payloads preserves deduplication across restart", async () => {
  const store = memoryStore(); let clock = 0; let executions = 0;
  const options = { store, now: () => ++clock, maxCompletedEntries: 1, execute: async () => { executions++; return { success: true, status: "success" }; } };
  const first = createDurableJobs(options); await first.start();
  const original = await first.submit({ text: "first ticket" }, { dedupeKey: "first" });
  await first.submit({ text: "second ticket" }, { dedupeKey: "second" });
  assert.equal(first.list().length, 1); await first.stop();
  const restarted = createDurableJobs(options); await restarted.start();
  const duplicate = await restarted.submit({ text: "first ticket" }, { dedupeKey: "first" });
  assert.equal(executions, 2); assert.equal(duplicate.success, true); assert.equal(duplicate.durableJobId, original.durableJobId);
  await restarted.stop();
});
