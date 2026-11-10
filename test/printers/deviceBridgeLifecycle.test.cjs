const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { EventEmitter } = require("node:events");

function moduleUrl(filename) {
  let source = fs.readFileSync(filename, "utf8");
  source = source.replace(/(from\s+["'])(\.[^"']+)(["'])/g, (_, start, target, end) => {
    let imported = path.resolve(path.dirname(filename), target);
    if (!path.extname(imported)) imported += ".js";
    return start + (imported.includes(`${path.sep}src${path.sep}`) ? moduleUrl(imported) : pathToFileURL(imported).href) + end;
  });
  return `data:text/javascript;base64,${Buffer.from(source + `\n//# sourceURL=${pathToFileURL(filename).href}`).toString("base64")}`;
}

test("renderer cancels an active operation but acknowledges only after its cleanup ends", async () => {
  const ipc = new EventEmitter();
  const sent = [];
  ipc.send = (channel, response) => sent.push({ channel, response });
  globalThis.window = { require: () => ({ ipcRenderer: ipc }) };
  const bridge = await import(moduleUrl(path.resolve(__dirname, "../../src/deviceBridge.js")));
  let finish;
  let firstSignal;
  let starts = 0;
  bridge.registerDeviceOperation("lifecycle.send", async (_, { signal } = {}) => {
    starts++;
    firstSignal ||= signal;
    if (starts === 1) await new Promise((resolve) => { finish = resolve; });
    return "sent";
  });
  bridge.startDeviceBridge();
  const payload = { config: { deviceId: "printer-A" } };
  ipc.emit("printer-device-request", {}, { requestId: "one", operation: "lifecycle.send", payload });
  await new Promise(setImmediate);
  ipc.emit("printer-device-cancel", {}, { requestId: "one" });
  ipc.emit("printer-device-request", {}, { requestId: "two", operation: "lifecycle.send", payload });
  await new Promise(setImmediate);
  assert.equal(firstSignal?.aborted, true);
  assert.equal(starts, 1);
  assert.equal(sent.length, 0);
  finish();
  await new Promise(setImmediate);
  assert.equal(starts, 2);
  assert.equal(sent[0].response.requestId, "one");
  assert.equal(sent[0].response.success, false);
  assert.equal(sent[0].response.cancelled, true);
  assert.equal(sent[0].response.cleanupComplete, true);
  assert.equal(sent[0].response.error.code, "ABORTED");
  assert.equal(sent[0].response.error.deliveryState, "unknown");
  assert.equal(sent[1].response.success, true);
});

test("USB and HID aliases cannot overlap when only one transport supplies a serial number", async () => {
  const ipc = new EventEmitter();
  ipc.send = () => {};
  globalThis.window = { require: () => ({ ipcRenderer: ipc }) };
  const bridge = await import(moduleUrl(path.resolve(__dirname, "../../src/deviceBridge.js")) + "#usb-alias");
  let finish;
  let starts = 0;
  const handler = async () => {
    starts++;
    if (starts === 1) await new Promise((resolve) => { finish = resolve; });
  };
  bridge.registerDeviceOperation("usbRaw.alias", handler);
  bridge.registerDeviceOperation("usbHid.alias", handler);
  bridge.startDeviceBridge();
  ipc.emit("printer-device-request", {}, { requestId: "raw", operation: "usbRaw.alias", payload: { config: { vendorId: "04B8", productId: "0E28", serialNumber: "ABC" } } });
  await new Promise(setImmediate);
  ipc.emit("printer-device-request", {}, { requestId: "hid", operation: "usbHid.alias", payload: { config: { vendorId: "04B8", productId: "0E28" } } });
  await new Promise(setImmediate);
  assert.equal(starts, 1);
  finish();
  await new Promise(setImmediate);
  assert.equal(starts, 2);
});
