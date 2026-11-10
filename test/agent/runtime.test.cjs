const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JsonFileStore } = require("../../lib/agent/store");
let createAgentRuntime;
try { ({ createAgentRuntime } = require("../../lib/agent/runtime")); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }

async function setup(t, overrides = {}) {
  assert.equal(typeof createAgentRuntime, "function");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smarteat-runtime-test-"));
  const store = new JsonFileStore({ dataDir });
  for (const [key, value] of Object.entries(overrides.initialData || {})) store.set(key, value);
  const runtime = createAgentRuntime({ store, dataDir, version: "test-version", controlToken: "synthetic-control-token", publicPort: 0, controlPort: 0, allowInsecureControlForTests: true,
    publicHost: "127.0.0.1", discoverPrinters: async () => [], discoveryIntervalMs: 0, pollIntervalMs: 60000, ...overrides });
  t.after(async () => { await runtime.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { runtime, store, dataDir };
}
async function controlHttp(runtime, action, payload, headers = {}) {
  return fetch(`http://127.0.0.1:${runtime.status().controlPort}/control`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-control-token", ...headers }, body: JSON.stringify({ action, payload }) });
}
const printer = { printerConfigVersion: 2, id: "test", name: "Synthetic", ticketTypes: { caisse: true },
  transports: { network9100: { enabled: true, available: true, config: { host: "synthetic-host", port: 9100 } } } };

test("printer presentation persists after reload and hiding never disables an enabled print route", async (t) => {
  let sent = 0;
  const { runtime, store, dataDir } = await setup(t, { senders: { network9100: { send: async () => { sent += 1; } } } });
  await runtime.control("save-printer-config", [printer]);
  const [defaults] = await runtime.control("get-saved-printers");
  assert.equal(defaults.hidden, false);
  assert.equal(defaults.collapsed, true);
  await runtime.control("save-printer-config", [{ ...printer, hidden: true, collapsed: false }]);
  const reloaded = new JsonFileStore({ dataDir });
  assert.equal(reloaded.get("printers")[0].hidden, true);
  assert.equal(reloaded.get("printers")[0].collapsed, false);
  await runtime.start();
  const result = await runtime.control("print-job", { ticketType: "caisse", dataFormatESCPOS: "QQ==" });
  assert.equal(result.success, true);
  assert.equal(sent, 1);
  await runtime.control("save-printer-config", [{ ...printer, hidden: false, collapsed: true }]);
  assert.equal(store.get("printers")[0].transports.network9100.enabled, true);
  assert.equal(store.get("printers")[0].hidden, false);
});

test("service control rejects missing secrets and browser origins while public ping remains available", async (t) => {
  const { runtime } = await setup(t);
  await runtime.start();
  const denied = await controlHttp(runtime, "get-user-session", null, { Authorization: "" });
  assert.equal(denied.status, 401);
  const crossOrigin = await controlHttp(runtime, "get-service-status", null, { Origin: "http://example.test" });
  assert.equal(crossOrigin.status, 403);
  const allowed = await controlHttp(runtime, "get-app-version");
  assert.deepEqual(await allowed.json(), { ok: true, value: "test-version" });
  const publicPing = await fetch(`http://127.0.0.1:${runtime.status().publicPort}/test`);
  assert.equal((await publicPing.json()).status, "ok");
  const leaked = JSON.stringify(await runtime.control("get-service-status"));
  assert.equal(leaked.includes("synthetic-control-token"), false);
});

test("public printing uses persisted jobs, all enabled transports, history and terminal authentication", async (t) => {
  let seen;
  let testStore;
  const { runtime, store } = await setup(t, { senders: { network9100: { send: async (input) => {
    seen = input;
    assert.equal(testStore.get("durableJobs")[0].state, "sending");
  } } } });
  testStore = store;
  await runtime.control("save-printer-config", [printer]);
  await runtime.start();
  const response = await fetch(`http://127.0.0.1:${runtime.status().publicPort}/print`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketType: "caisse", dataFormatESCPOS: "QQ==" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(seen.printer.id, "test");
  assert.equal((await runtime.control("get-print-history")).length, 1);
  const terminals = await fetch(`http://127.0.0.1:${runtime.status().publicPort}/terminals`);
  assert.equal(terminals.status, 401);
});

test("persisted polling starts without UI and null startup configuration cannot erase its endpoint", async (t) => {
  let calls = 0;
  const { runtime, store } = await setup(t, { fetchJobs: async () => { calls += 1; return []; } });
  store.set("pollingEndpoint", "http://example.test/jobs");
  store.set("userSession", { shopid: "synthetic-shop", token: "synthetic-session-token" });
  await runtime.control("configure-print-polling", { endpoint: null });
  assert.equal(store.get("pollingEndpoint"), "http://example.test/jobs");
  await runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls >= 1);
});

test("terminal IPC actions keep their previous response envelope", async (t) => {
  const { runtime } = await setup(t);
  assert.deepEqual(await runtime.control("terminals:list"), { ok: true, value: [] });
});

test("an interrupted durable ticket appears once as unknown in visible history without sending", async (t) => {
  let sent = 0;
  const { runtime } = await setup(t, { initialData: { durableJobs: [{ id: "interrupted-ticket", state: "sending", payload: { rawText: "synthetic interrupted ticket" } }] },
    senders: { network9100: { send: async () => { sent += 1; } } } });
  await runtime.start();
  const history = await runtime.control("get-print-history");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "unknown");
  assert.equal(history[0].durableJobId, "interrupted-ticket");
  await runtime.start();
  assert.equal((await runtime.control("get-print-history")).length, 1);
  assert.equal(sent, 0);
});

test("HTTP control preserves safe broker recovery codes and sanitizes arbitrary error messages", async (t) => {
  let code = "BROKER_RESTARTED";
  const { runtime } = await setup(t, { bridge: { status: () => ({ online: true }), control: async () => {
    throw Object.assign(new Error("sensitive arbitrary detail synthetic-private-token"), { code });
  } } });
  await runtime.start();
  const restarted = await controlHttp(runtime, "companion:respond", { brokerId: "old" });
  assert.equal(restarted.status, 400);
  const restartedBody = await restarted.json();
  assert.equal(restartedBody.error.code, "BROKER_RESTARTED");
  assert.equal(JSON.stringify(restartedBody).includes("synthetic-private-token"), false);
  code = "COMPANION_OWNER_MISMATCH";
  const owner = await controlHttp(runtime, "companion:poll", {});
  assert.equal((await owner.json()).error.code, "COMPANION_OWNER_MISMATCH");
  code = "ARBITRARY_INTERNAL_ERROR";
  const unknown = await controlHttp(runtime, "companion:respond", {});
  const unknownBody = await unknown.json();
  assert.equal(unknownBody.error.code, "CONTROL_FAILED");
  assert.equal(JSON.stringify(unknownBody).includes("synthetic-private-token"), false);
});

test("logged-in companion recovery resumes only the failed unsent destination and updates one history entry", async (t) => {
  let online = false;
  let networkSends = 0;
  let directSends = 0;
  const bridge = { status: () => ({ online }), control: async () => { online = true; return {}; } };
  const { runtime, store } = await setup(t, { bridge, senders: {
    network9100: { send: async () => { networkSends += 1; } },
    usbRaw: { send: async () => {
      directSends += 1;
      if (!online) throw Object.assign(new Error("Companion offline"), { code: "COMPANION_OFFLINE", retryable: true, deliveryState: "not-sent" });
    } },
  } });
  await runtime.control("save-printer-config", [{ ...printer, transports: { ...printer.transports, usbRaw: { enabled: true, available: true, config: { vendorId: "1234", productId: "5678", serialNumber: "synthetic" } } } }]);
  await runtime.start();
  const first = await runtime.control("print-job", { ticketType: "caisse", dataFormatESCPOS: "QQ==" });
  assert.equal(first.pending, true);
  assert.equal(store.get("durableJobs")[0].state, "waiting");
  await runtime.control("companion:poll", {});
  const deadline = Date.now() + 1500;
  while (store.get("durableJobs")[0].state !== "completed" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(store.get("durableJobs")[0].state, "completed");
  assert.equal(networkSends, 1);
  assert.equal(directSends, 4);
  const history = await runtime.control("get-print-history");
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "success");
  assert.equal(history[0].pending, false);
});

test("all direct transport adapters forward through the companion bridge without native printing", async (t) => {
  const requests = [];
  const bridge = { status: () => ({ online: true }), request: async (operation, payload, _timeoutMs, options) => {
    requests.push({ operation, payload });
    assert.equal(options.signal instanceof AbortSignal, true);
  } };
  const { runtime } = await setup(t, { bridge });
  await runtime.control("save-printer-config", [{ ...printer, transports: Object.fromEntries(["usbRaw", "usbHid", "bluetoothGatt"].map((id) => [id, { enabled: true, available: true, config: { deviceId: "synthetic" } }])) }]);
  await runtime.start();
  const result = await runtime.control("print-job", { ticketType: "caisse", dataFormatESCPOS: "QQ==" });
  assert.equal(result.success, true);
  assert.deepEqual(requests.map((request) => request.operation), ["usbRaw.send", "usbHid.send", "bluetoothGatt.send"]);
  assert.equal(requests[0].payload.printerId, "test");
});

test("recovered old companion writes quarantine native sends until cleanup is proven", async (t) => {
  let release;
  let cleanup = new Promise((resolve) => { release = resolve; });
  let sent = 0;
  const bridge = { setOnRecovery: () => {}, recoveryCleanup: () => cleanup, status: () => ({ online: false }) };
  const { runtime } = await setup(t, { bridge, senders: { network9100: { send: async () => { sent += 1; } } } });
  await runtime.control("save-printer-config", [printer]); await runtime.start();
  const blocked = await runtime.control("print-job", { ticketType: "caisse", dataFormatESCPOS: "QQ==" });
  assert.equal(blocked.success, false);
  assert.equal(sent, 0);
  release(); cleanup = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await runtime.control("print-job", { ticketType: "caisse", dataFormatESCPOS: "QQ==" })).success, true);
  assert.equal(sent, 1);
});

for (const identity of ["printerId", "hardware"]) test(`known recovered printer ${identity} does not quarantine an unrelated network printer`, async (t) => {
  let release;
  let recovery = new Promise((resolve) => { release = resolve; });
  const bridge = {
    setOnRecovery(handler) { handler({ operation: "usbRaw.send", cleanup: recovery,
      payload: identity === "printerId" ? { printerId: "printer-A", config: {} }
        : { config: { vendorId: "1234", productId: "5678", serialNumber: "serial-A" } },
    }); },
    recoveryCleanup: () => recovery, status: () => ({ online: false }),
  };
  const sent = [];
  const { runtime } = await setup(t, { bridge, senders: { network9100: { send: async ({ printer }) => { sent.push(printer.id); } } } });
  await runtime.control("save-printer-config", [
    { ...printer, id: "printer-A", vendorId: "1234", productId: "5678", serialNumber: "serial-A", ticketTypes: { caisse: true },
      transports: { network9100: { enabled: true, available: true, config: { host: "synthetic-A", port: 9100 } } } },
    { ...printer, id: "printer-B", ticketTypes: { cuisine: true },
      transports: { network9100: { enabled: true, available: true, config: { host: "synthetic-B", port: 9100 } } } },
  ]);
  await runtime.start();
  assert.equal((await runtime.control("print-job", { ticketType: "cuisine", dataFormatESCPOS: "QQ==" })).success, true);
  assert.deepEqual(sent, ["printer-B"]);
  assert.equal((await runtime.control("print-job", { ticketType: "caisse", dataFormatESCPOS: "QQ==" })).success, false);
  assert.deepEqual(sent, ["printer-B"]);
  release(); recovery = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await runtime.control("print-job", { ticketType: "caisse", dataFormatESCPOS: "QQ==" })).success, true);
  assert.deepEqual(sent, ["printer-B", "printer-A"]);
});
