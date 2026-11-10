const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { JsonFileStore } = require("../../lib/agent/store");
const { createAgentRuntime } = require("../../lib/agent/runtime");
const { createCompanionBroker } = require("../../lib/agent/companionBroker");
const { createServiceClient } = require("../../lib/desktop/serviceClient");
const { createCompanionClient } = require("../../lib/desktop/companionClient");
const { REQUEST_CHANNEL, RESPONSE_CHANNEL, CANCEL_CHANNEL } = require("../../lib/printers/deviceBridgeClient");

test("a live companion discards an old HTTP response after service restart, clears recovery and prints a new request", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smarteat-http-restart-test-"));
  const store = new JsonFileStore({ dataDir });
  const token = "ab".repeat(32);
  const runtimes = [];
  const timers = [];
  const ipcMain = new EventEmitter();
  const webContents = new EventEmitter();
  const delivered = [];
  webContents.isDestroyed = () => false;
  webContents.send = (channel, message) => {
    delivered.push({ channel, message });
    if (channel === CANCEL_CHANNEL) ipcMain.emit(RESPONSE_CHANNEL, { sender: webContents }, {
      requestId: message.requestId, success: false, cancelled: true, cleanupComplete: true,
    });
  };
  let companion;
  t.after(async () => {
    await companion?.stop();
    for (const runtime of runtimes) await runtime.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  async function start(brokerId) {
    const bridge = createCompanionBroker({ stateStore: store, brokerId, isProcessAlive: () => true });
    const runtime = createAgentRuntime({ store, bridge, dataDir, controlToken: token, publicPort: 0, controlPort: 0, allowInsecureControlForTests: true,
      publicHost: "127.0.0.1", discoveryIntervalMs: 0, discoverPrinters: async () => [] });
    runtimes.push(runtime);
    await runtime.start();
    fs.writeFileSync(path.join(dataDir, "connection.json"), JSON.stringify({ token, controlPort: runtime.status().controlPort }));
    return { bridge, runtime };
  }
  const first = await start("first-broker");
  const serviceClient = createServiceClient({ dataDir, allowInsecureControlForTests: true });
  companion = createCompanionClient({ serviceClient, ipcMain, webContents, instanceId: "same-desktop", processId: process.pid,
    setTimer(callback) { timers.push(callback); return callback; },
    clearTimer(timer) { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
  });
  const tick = async () => { const callback = timers.shift(); assert.ok(callback); await callback(); };
  await companion.start();
  const oldRequest = first.bridge.request("usbRaw.send", { printerId: "synthetic", config: { serialNumber: "synthetic" }, base64Data: "QQ==" }).catch((error) => error);
  await tick();
  const firstDelivery = delivered.find((entry) => entry.channel === REQUEST_CHANNEL);
  assert.ok(firstDelivery);
  await first.runtime.stop();
  await oldRequest;
  const second = await start("second-broker");
  assert.equal(second.bridge.status().recoveringCount, 1);
  ipcMain.emit(RESPONSE_CHANNEL, { sender: webContents }, { requestId: firstDelivery.message.requestId, success: true, cleanupComplete: true });
  await tick();
  assert.equal(second.bridge.status().online, true);
  assert.equal(second.bridge.status().recoveringCount, 0);
  const next = second.bridge.request("usbRaw.send", { printerId: "synthetic", config: { serialNumber: "synthetic" }, base64Data: "Qg==" });
  await tick();
  const requests = delivered.filter((entry) => entry.channel === REQUEST_CHANNEL);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[1].message.requestId, firstDelivery.message.requestId);
  ipcMain.emit(RESPONSE_CHANNEL, { sender: webContents }, { requestId: requests[1].message.requestId, success: true, cleanupComplete: true, result: { bytesWritten: 1 } });
  await tick();
  assert.deepEqual(await next, { bytesWritten: 1 });
});
