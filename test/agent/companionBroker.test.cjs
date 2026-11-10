const test = require("node:test");
const assert = require("node:assert/strict");
const { createCompanionBroker } = require("../../lib/agent/companionBroker");

function setup(options = {}) {
  let now = 0;
  const timers = [];
  const broker = createCompanionBroker({
    clock: () => now, leaseMs: 100,
    isProcessAlive: () => true,
    getProcessIdentity: (pid) => `test-birth-${pid}`,
    setTimer(callback) { timers.push(callback); return callback; },
    clearTimer() {},
    ...options,
  });
  const poll = (payload = {}) => broker.control("companion:poll", { instanceId: "owner", processId: 100, ...payload });
  return { broker, poll, timers, advance(ms) { now += ms; } };
}

test("a missing or expired companion fails before sending and leaves native transports independent", async () => {
  const { broker, poll, advance } = setup();
  await assert.rejects(broker.request("usbRaw.send", {}), { code: "COMPANION_OFFLINE", retryable: true, deliveryState: "not-sent" });
  await poll();
  assert.equal(broker.status().online, true);
  advance(101);
  assert.equal(broker.status().online, false);
  await assert.rejects(broker.request("usbRaw.send", {}), { code: "COMPANION_OFFLINE", deliveryState: "not-sent" });
  broker.stop();
});

test("poll delivery is acknowledged and only the current owner can complete a request", async () => {
  const { broker, poll } = setup();
  const connected = await poll();
  const printing = broker.request("usbRaw.send", { config: { serialNumber: "A" }, base64Data: "AQI=" });
  const first = await poll();
  assert.equal(first.commands.length, 1);
  const command = first.commands[0];
  assert.equal(command.channel, "printer-device-request");
  assert.equal(command.message.operation, "usbRaw.send");
  const repeated = await poll();
  assert.equal(repeated.commands[0].commandId, command.commandId);
  await assert.rejects(broker.control("companion:respond", { instanceId: "other", brokerId: connected.brokerId, response: { requestId: command.message.requestId, success: true } }), { code: "COMPANION_OWNER_MISMATCH" });
  await broker.control("companion:respond", { instanceId: "owner", brokerId: connected.brokerId, response: { requestId: command.message.requestId, success: true, result: { bytesWritten: 2 } } });
  assert.deepEqual(await printing, { bytesWritten: 2 });
  assert.equal((await poll({ acknowledged: [command.commandId] })).commands.length, 0);
  broker.stop();
});

test("loopback disconnect and lease expiry do not release a timed-out physical write", async () => {
  const { broker, poll, timers, advance } = setup();
  const { brokerId } = await poll();
  const printing = broker.request("usbRaw.send", { config: { serialNumber: "A" } });
  const result = printing.catch((error) => error);
  const { commands } = await poll();
  const requestId = commands[0].message.requestId;
  timers[0]();
  const error = await result;
  assert.equal(error.code, "TIMEOUT");
  assert.ok(error.cleanup instanceof Promise);
  let cleaned = false;
  error.cleanup.then(() => { cleaned = true; });
  await broker.control("companion:disconnect", { instanceId: "owner", brokerId, ended: false });
  advance(101);
  await assert.rejects(poll({ instanceId: "replacement", processId: 200 }), { code: "COMPANION_BUSY" });
  await new Promise(setImmediate);
  assert.equal(cleaned, false);
  const reconnect = await poll();
  assert.ok(reconnect.commands.some((command) => command.channel === "printer-device-cancel"));
  await broker.control("companion:respond", { instanceId: "owner", brokerId, response: { requestId, cancelled: true, cleanupComplete: true, success: false } });
  await error.cleanup;
  assert.equal(cleaned, true);
  broker.stop();
});

test("verified process death permits replacement and resolves old cleanup barriers", async () => {
  const alive = new Set([100, 200]);
  const { broker, poll, timers, advance } = setup({ isProcessAlive: (pid) => alive.has(pid) });
  await poll();
  const result = broker.request("usbRaw.send", { config: { serialNumber: "A" } }).catch((error) => error);
  timers[0]();
  const error = await result;
  advance(101);
  alive.delete(100);
  const connected = await poll({ instanceId: "replacement", processId: 200 });
  await error.cleanup;
  assert.equal(connected.commands.length, 0);
  assert.equal(broker.status().instanceId, "replacement");
  broker.stop();
});

test("service restart adopts outstanding writes as cancellation barriers without replaying ticket bytes", async () => {
  const recovered = [];
  const { broker, poll } = setup({ onRecovery: (entry) => recovered.push(entry) });
  const result = await poll({ activeRequests: [{ requestId: "old-write", brokerId: "old-service", operation: "usbRaw.send", payload: { config: { serialNumber: "A" }, printerId: "printer-A" } }] });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].payload.printerId, "printer-A");
  assert.ok(recovered[0].cleanup instanceof Promise);
  assert.deepEqual(result.commands.map((command) => command.channel), ["printer-device-cancel"]);
  const barrier = broker.recoveryCleanup();
  assert.ok(barrier instanceof Promise);
  await assert.rejects(broker.request("usbRaw.send", { config: { serialNumber: "A" } }), (error) => error.code === "DEVICE_BUSY" && error.cleanup instanceof Promise);
  await broker.control("companion:respond", { instanceId: "owner", brokerId: result.brokerId, response: { requestId: "old-write", success: false, cancelled: true, cleanupComplete: false } });
  assert.ok(broker.recoveryCleanup() instanceof Promise);
  await broker.control("companion:respond", { instanceId: "owner", brokerId: result.brokerId, response: { requestId: "old-write", success: false, cancelled: true, cleanupComplete: true } });
  await barrier;
  assert.equal(broker.recoveryCleanup(), null);
  broker.stop();
});

test("trusted renderer termination releases barriers, while another instance cannot claim termination", async () => {
  const { broker, poll, timers } = setup();
  const { brokerId } = await poll();
  const result = broker.request("usbRaw.send", {}).catch((error) => error);
  timers[0]();
  const error = await result;
  await assert.rejects(broker.control("companion:disconnect", { instanceId: "other", brokerId, ended: true }), { code: "COMPANION_OWNER_MISMATCH" });
  await broker.control("companion:disconnect", { instanceId: "owner", brokerId, ended: true });
  await error.cleanup;
  assert.equal(broker.status().online, false);
  broker.stop();
});

test("persistent in-flight metadata installs recovery barriers before the first reconnect", async () => {
  const values = new Map();
  const stateStore = { get(key, fallback) { return values.has(key) ? structuredClone(values.get(key)) : fallback; }, set(key, value) { values.set(key, structuredClone(value)); } };
  const initial = setup({ stateStore });
  await initial.poll();
  const firstResult = initial.broker.request("usbRaw.send", { printerId: "printer-A", config: { vendorId: "04B8", productId: "0E28", serialNumber: "ABC", token: "never-save-this" }, base64Data: "do-not-save-print-data" }).catch((error) => error);
  const saved = stateStore.get("companionState");
  assert.ok(saved, "broker persists owner and in-flight requests before hardware delivery");
  assert.equal(saved.requests.length, 1);
  assert.equal(saved.processId, 100);
  assert.equal(JSON.stringify(saved).includes("never-save-this"), false);
  assert.equal(JSON.stringify(saved).includes("do-not-save-print-data"), false);
  const restarted = setup({ stateStore });
  const recovered = [];
  restarted.broker.setOnRecovery((entry) => recovered.push(entry));
  assert.equal(recovered.length, 1);
  assert.equal(restarted.broker.status().online, false);
  assert.ok(restarted.broker.recoveryCleanup() instanceof Promise);
  await assert.rejects(restarted.poll({ instanceId: "other", processId: 200 }), { code: "COMPANION_BUSY" });
  const connection = await restarted.poll();
  assert.deepEqual(connection.commands.map((command) => command.channel), ["printer-device-cancel"]);
  const barrier = restarted.broker.recoveryCleanup();
  await restarted.broker.control("companion:respond", { instanceId: "owner", brokerId: connection.brokerId, response: { requestId: saved.requests[0].requestId, success: false, cancelled: true, cleanupComplete: true } });
  await barrier;
  assert.deepEqual(stateStore.get("companionState").requests, []);
  initial.broker.stop();
  await firstResult;
  restarted.broker.stop();
});

test("a write cannot enter the companion queue when its persistent metadata cannot be saved", async () => {
  let failWrites = false;
  const values = new Map();
  const stateStore = { get(key, fallback) { return values.get(key) ?? fallback; }, set(key, value) { if (failWrites) throw new Error("Disk unavailable"); values.set(key, value); } };
  const { broker, poll, timers } = setup({ stateStore });
  await poll();
  failWrites = true;
  const rejection = assert.rejects(broker.request("usbRaw.send", { config: { serialNumber: "A" } }), { deliveryState: "not-sent" });
  timers[0]();
  await rejection;
  assert.deepEqual((await poll()).commands, []);
  broker.stop();
});

test("verified previous process death clears persisted recovery without waiting for a desktop", () => {
  const values = new Map([["companionState", { instanceId: "dead", processId: 999, requests: [{ requestId: "old", brokerId: "old", operation: "usbRaw.send", payload: { config: { serialNumber: "A" } } }] }]]);
  const stateStore = { get(key, fallback) { return values.has(key) ? values.get(key) : fallback; }, set(key, value) { values.set(key, value); } };
  const { broker } = setup({ stateStore, isProcessAlive: () => false });
  assert.equal(broker.recoveryCleanup(), null);
  assert.equal(stateStore.get("companionState"), null);
  broker.stop();
});

test("trusted renderer termination after service restart can release its restored owner without a live renderer poll", async () => {
  const saved = { instanceId: "owner", processId: 100, requests: [{ requestId: "old", brokerId: "old-service", operation: "usbRaw.send", payload: { config: { serialNumber: "A" } } }] };
  let state = saved;
  const { broker } = setup({ stateStore: { get() { return state; }, set(_, value) { state = value; } } });
  const cleanup = broker.recoveryCleanup();
  await broker.control("companion:disconnect", { instanceId: "owner", processId: 100, brokerId: "old-service", ended: true });
  await cleanup;
  assert.equal(state, null);
  assert.equal(broker.status().instanceId, null);
  broker.stop();
});

test("a reused persisted PID releases stale recovery and permits a new companion owner", async () => {
  let state = { instanceId: "old-owner", processId: 100, processIdentity: "birth-before-reboot", requests: [{ requestId: "old-write", brokerId: "old-service", operation: "usbRaw.send", payload: { config: { serialNumber: "A" } } }] };
  const { broker, poll } = setup({ getProcessIdentity: (pid) => `birth-after-reboot-${pid}`, stateStore: { get() { return state; }, set(_, value) { state = value; } } });
  assert.equal(broker.recoveryCleanup(), null);
  assert.equal(state, null);
  await poll({ instanceId: "new-owner", processId: 200 });
  assert.equal(broker.status().instanceId, "new-owner");
  assert.equal(state.processIdentity, "birth-after-reboot-200");
  broker.stop();
});

test("matching OS process birth preserves live recovery ownership and is persisted before delivery", async () => {
  let state;
  const stateStore = { get() { return state; }, set(_, value) { state = value; } };
  const first = setup({ stateStore });
  await first.poll();
  const original = first.broker.request("usbRaw.send", { config: { serialNumber: "A" } }).catch((error) => error);
  assert.equal(state.processIdentity, "test-birth-100");
  const restored = setup({ stateStore });
  const cleanup = restored.broker.recoveryCleanup();
  assert.ok(cleanup instanceof Promise);
  await assert.rejects(restored.poll({ instanceId: "different-owner", processId: 200 }), { code: "COMPANION_BUSY" });
  assert.equal(restored.broker.status().instanceId, "owner");
  first.broker.stop();
  await original;
  restored.broker.stop();
});

test("regular heartbeats reuse verified birth identity instead of querying the OS each poll", async () => {
  let queries = 0;
  const { broker, poll } = setup({ getProcessIdentity(pid) { queries++; return `birth-${pid}`; } });
  await poll();
  for (let count = 0; count < 5; count++) await poll();
  assert.equal(queries, 1);
  broker.stop();
});

test("Windows birth lookup is hidden, bounded and receives only a validated numeric PID", async () => {
  const invocations = [];
  let state;
  const { broker, poll } = setup({
    getProcessIdentity: undefined, platform: "win32",
    execFileSync(file, args, options) { invocations.push({ file, args, options }); return "638980000000000000\r\n"; },
    stateStore: { get() { return state; }, set(_, value) { state = value; } },
  });
  await poll();
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].file, "powershell.exe");
  assert.equal(invocations[0].options.windowsHide, true);
  assert.ok(invocations[0].options.timeout > 0 && invocations[0].options.timeout <= 5000);
  assert.equal(invocations[0].options.env.SMARTEAT_COMPANION_PROCESS_ID, "100");
  assert.equal(state.processIdentity, "638980000000000000");
  await assert.rejects(poll({ instanceId: "other", processId: "100;Write-Output unsafe" }), { code: "CONFIGURATION" });
  assert.equal(invocations.length, 1);
  broker.stop();
});

test("an invalid or inaccessible OS birth result cannot release a restored physical write", async () => {
  const saved = { instanceId: "old-owner", processId: 100, processIdentity: "verified-old-birth", requests: [{ requestId: "old", brokerId: "old-service", operation: "usbRaw.send", payload: { config: { serialNumber: "A" } } }] };
  const { broker, poll } = setup({ getProcessIdentity: () => undefined, stateStore: { get() { return saved; }, set() {} } });
  assert.ok(broker.recoveryCleanup() instanceof Promise);
  await assert.rejects(poll({ instanceId: "new-owner", processId: 200 }), { code: "COMPANION_BUSY" });
  broker.stop();
});

test("recovered printer A defers safely while unrelated direct printer B can send", async () => {
  let state = { instanceId: "owner", processId: 100, processIdentity: "test-birth-100", requests: [{ requestId: "old-A", brokerId: "old-service", operation: "usbRaw.send", payload: { printerId: "A", config: { vendorId: "04B8", productId: "0E28", serialNumber: "A" } } }] };
  const { broker, poll } = setup({ stateStore: { get() { return state; }, set(_, value) { state = value; } } });
  const { brokerId } = await poll();
  const sendingB = broker.request("usbRaw.send", { printerId: "B", config: { vendorId: "04B8", productId: "0E28", serialNumber: "B" }, base64Data: "AQ==" }).catch((error) => error);
  const command = (await poll()).commands.find((entry) => entry.channel === "printer-device-request");
  assert.ok(command, "unrelated printer B receives its own hardware command");
  assert.equal(command.message.payload.printerId, "B");
  await broker.control("companion:respond", { instanceId: "owner", brokerId, response: { requestId: command.message.requestId, success: true, result: { bytesWritten: 1 } } });
  assert.deepEqual(await sendingB, { bytesWritten: 1 });
  await assert.rejects(broker.request("usbHid.send", { printerId: "A", config: { vendorId: "04B8", productId: "0E28" } }), (error) => error.code === "DEVICE_BUSY" && error.retryable === true && error.deliveryState === "not-sent" && error.cleanup instanceof Promise);
  assert.ok(broker.recoveryCleanup() instanceof Promise);
  broker.stop();
});

test("expired recovery rechecks OS birth with throttling even when no replacement companion polls", async () => {
  let identity = "birth-original";
  let probes = 0;
  const saved = { instanceId: "owner", processId: 100, processIdentity: identity, requests: [{ requestId: "old", brokerId: "old-service", operation: "usbRaw.send", payload: { config: { serialNumber: "A" } } }] };
  let state = saved;
  const { broker, advance } = setup({ identityCheckIntervalMs: 50, getProcessIdentity() { probes++; return identity; }, stateStore: { get() { return state; }, set(_, value) { state = value; } } });
  const barrier = broker.recoveryCleanup();
  assert.ok(barrier instanceof Promise);
  assert.equal(probes, 1);
  identity = "birth-reused-pid";
  for (let count = 0; count < 10; count++) broker.recoveryCleanup();
  assert.equal(probes, 1);
  advance(51);
  assert.equal(broker.recoveryCleanup(), null);
  await barrier;
  assert.equal(probes, 2);
  assert.equal(state, null);
  broker.stop();
});
