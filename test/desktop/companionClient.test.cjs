const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createCompanionClient } = require("../../lib/desktop/companionClient");
const { createCompanionBroker } = require("../../lib/agent/companionBroker");

function setup(brokerOptions = {}) {
  const broker = createCompanionBroker({ isProcessAlive: () => true, getProcessIdentity: (pid) => `test-birth-${pid}`, ...brokerOptions });
  let currentBroker = broker;
  const ipc = new EventEmitter();
  const webContents = new EventEmitter();
  const sent = [];
  const timers = [];
  const calls = [];
  let destroyed = false;
  let disconnected = false;
  webContents.isDestroyed = () => destroyed;
  webContents.send = (channel, message) => sent.push({ channel, message });
  const serviceClient = { secret: "never-render-this-secret", async request(action, payload) {
    calls.push({ action, payload });
    if (disconnected) throw Object.assign(new Error("Connection lost"), { code: "ECONNREFUSED" });
    return currentBroker.control(action, payload);
  } };
  const client = createCompanionClient({ serviceClient, ipcMain: ipc, webContents, instanceId: "desktop-A", processId: 100,
    setTimer(callback) { timers.push(callback); return callback; }, clearTimer(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
  });
  return { broker, client, ipc, webContents, sent, timers, calls,
    disconnect(value) { disconnected = value; },
    useBroker(value) { currentBroker = value; },
    destroy() { destroyed = true; webContents.emit("destroyed"); },
    async tick() { const callback = timers.shift(); assert.ok(callback, "client has a scheduled reconnect/heartbeat"); await callback(); },
  };
}

test("main-only polling forwards existing renderer channels and accepts only its renderer response", async () => {
  const state = setup();
  await state.client.start();
  const result = state.broker.request("usbRaw.send", { config: { serialNumber: "A" }, base64Data: "AQI=" });
  await state.tick();
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].channel, "printer-device-request");
  assert.equal(JSON.stringify(state.sent).includes("never-render-this-secret"), false);
  const { requestId } = state.sent[0].message;
  let completed = false;
  result.then(() => { completed = true; });
  state.ipc.emit("printer-device-response", { sender: {} }, { requestId, success: true, result: "wrong" });
  await new Promise(setImmediate);
  assert.equal(completed, false);
  state.ipc.emit("printer-device-response", { sender: state.webContents }, { requestId, success: true, result: { bytesWritten: 2 } });
  await state.tick();
  assert.deepEqual(await result, { bytesWritten: 2 });
  await state.client.stop();
  state.broker.stop();
});

test("reconnect retries responses and does not forward an unacknowledged request twice", async () => {
  const state = setup();
  await state.client.start();
  const result = state.broker.request("usbRaw.send", { config: { serialNumber: "A" } });
  await state.tick();
  const { requestId } = state.sent[0].message;
  state.disconnect(true);
  state.ipc.emit("printer-device-response", { sender: state.webContents }, { requestId, success: true, result: "printed" });
  await state.tick();
  assert.equal(state.sent.length, 1);
  state.disconnect(false);
  await state.tick();
  assert.equal(await result, "printed");
  assert.equal(state.sent.filter((entry) => entry.channel === "printer-device-request").length, 1);
  await state.client.stop();
  state.broker.stop();
});

test("caller abort reaches the renderer and the broker cleanup barrier waits for renderer acknowledgement", async () => {
  const state = setup();
  await state.client.start();
  const controller = new AbortController();
  const result = state.broker.request("usbRaw.send", { config: { serialNumber: "A" } }, 5000, { signal: controller.signal }).catch((error) => error);
  await state.tick();
  const { requestId } = state.sent[0].message;
  controller.abort();
  const error = await result;
  let cleaned = false;
  error.cleanup.then(() => { cleaned = true; });
  await state.tick();
  assert.equal(state.sent.at(-1).channel, "printer-device-cancel");
  assert.equal(cleaned, false);
  state.ipc.emit("printer-device-response", { sender: state.webContents }, { requestId, success: false, cancelled: true, cleanupComplete: true });
  await state.tick();
  await error.cleanup;
  assert.equal(cleaned, true);
  await state.client.stop();
  state.broker.stop();
});

test("stop reports transport disconnect without claiming that a live renderer ended", async () => {
  const state = setup();
  await state.client.start();
  await state.client.stop();
  const disconnect = state.calls.findLast((entry) => entry.action === "companion:disconnect");
  assert.equal(disconnect.payload.ended, false);
  state.destroy();
  await new Promise(setImmediate);
  const ended = state.calls.findLast((entry) => entry.action === "companion:disconnect");
  assert.equal(ended.payload.ended, true);
  state.broker.stop();
});

test("renderer termination is retried after a loopback outage without reopening printing", async () => {
  const state = setup();
  await state.client.start();
  const controller = new AbortController();
  const result = state.broker.request("usbRaw.send", { config: { serialNumber: "A" } }, 5000, { signal: controller.signal }).catch((error) => error);
  await state.tick();
  controller.abort();
  const error = await result;
  state.disconnect(true);
  state.destroy();
  await new Promise(setImmediate);
  state.disconnect(false);
  await state.tick();
  await error.cleanup;
  assert.equal(state.broker.status().instanceId, null);
  assert.equal(state.sent.filter((entry) => entry.channel === "printer-device-request").length, 1);
  state.broker.stop();
});

test("a surviving desktop cancels recovered writes after service restart without replaying the request", async () => {
  const values = new Map();
  const stateStore = { get(key, fallback) { return values.has(key) ? structuredClone(values.get(key)) : fallback; }, set(key, value) { values.set(key, structuredClone(value)); } };
  const state = setup({ stateStore });
  await state.client.start();
  const original = state.broker.request("usbRaw.send", { printerId: "A", config: { serialNumber: "A" }, base64Data: "AQI=" }).catch((error) => error);
  await state.tick();
  const requestId = state.sent[0].message.requestId;
  state.broker.stop();
  await original;
  const restarted = createCompanionBroker({ stateStore, isProcessAlive: () => true, getProcessIdentity: (pid) => `test-birth-${pid}` });
  const cleanup = restarted.recoveryCleanup();
  assert.ok(cleanup instanceof Promise);
  state.useBroker(restarted);
  await state.tick();
  assert.equal(state.sent.at(-1).channel, "printer-device-cancel");
  assert.equal(state.sent.filter((entry) => entry.channel === "printer-device-request").length, 1);
  const reconnect = state.calls.filter((entry) => entry.action === "companion:poll").at(-1);
  assert.equal(reconnect.payload.activeRequests[0].payload.printerId, "A");
  assert.equal(JSON.stringify(reconnect.payload).includes("AQI="), false);
  state.ipc.emit("printer-device-response", { sender: state.webContents }, { requestId, success: false, cancelled: true, cleanupComplete: true });
  await state.tick();
  await cleanup;
  assert.equal(restarted.recoveryCleanup(), null);
  await state.client.stop();
  restarted.stop();
});
