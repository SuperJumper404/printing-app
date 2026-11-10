const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  createDeviceBridgeClient,
} = require("../../lib/printers/deviceBridgeClient");

function setup(options = {}) {
  const ipc = new EventEmitter();
  const webContents = new EventEmitter();
  webContents.sent = [];
  webContents.isDestroyed = () => false;
  webContents.send = (channel, message) => webContents.sent.push({ channel, message });
  const client = createDeviceBridgeClient(webContents, { ipc, ...options });
  return { client, ipc, webContents };
}

test("sends unique request IDs and resolves only matching responses", async () => {
  const { client, ipc, webContents } = setup();
  const first = client.request("usbRaw.send", { value: 1 });
  const second = client.request("usbRaw.send", { value: 2 });
  const [firstMessage, secondMessage] = webContents.sent.map((item) => item.message);

  assert.notEqual(firstMessage.requestId, secondMessage.requestId);
  assert.equal(firstMessage.operation, "usbRaw.send");
  ipc.emit("printer-device-response", { sender: webContents }, {
    requestId: secondMessage.requestId,
    success: true,
    result: { bytesWritten: 3 },
  });
  assert.deepEqual(await second, { bytesWritten: 3 });
  ipc.emit("printer-device-response", { sender: webContents }, {
    requestId: firstMessage.requestId,
    success: true,
    result: { bytesWritten: 2 },
  });
  assert.deepEqual(await first, { bytesWritten: 2 });
  client.dispose();
});

test("rejects after the default 5000 ms timeout", async () => {
  let timeoutDelay;
  const { client } = setup({
    setTimer(callback, delay) {
      timeoutDelay = delay;
      queueMicrotask(callback);
      return 1;
    },
    clearTimer() {},
  });

  await assert.rejects(client.request("usbRaw.send", {}), { code: "TIMEOUT" });
  assert.equal(timeoutDelay, 5000);
  client.dispose();
});

test("rejects pending requests when renderer webContents is destroyed", async () => {
  const { client, webContents } = setup();
  const pending = client.request("usbHid.send", {});
  webContents.emit("destroyed");

  await assert.rejects(pending, { code: "BRIDGE_CLOSED" });
  client.dispose();
});

test("ignores duplicate and late responses", async () => {
  const { client, ipc, webContents } = setup();
  const pending = client.request("bluetoothGatt.send", {});
  const { requestId } = webContents.sent[0].message;
  const response = { requestId, success: true, result: "done" };
  ipc.emit("printer-device-response", { sender: webContents }, response);
  assert.equal(await pending, "done");

  assert.doesNotThrow(() => {
    ipc.emit("printer-device-response", { sender: webContents }, response);
    ipc.emit("printer-device-response", { sender: webContents }, {
      requestId: "unknown",
      success: true,
    });
  });
  client.dispose();
});

test("preserves unauthorized device details as an actionable error", async () => {
  const { client, ipc, webContents } = setup();
  const pending = client.request("usbRaw.send", {});
  const { requestId } = webContents.sent[0].message;
  ipc.emit("printer-device-response", { sender: webContents }, {
    requestId,
    success: false,
    error: {
      name: "NotAllowedError",
      message: "Peripherique USB non autorise",
      action: "authorize-usb",
    },
  });

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, "NotAllowedError");
    assert.equal(error.message, "Peripherique USB non autorise");
    assert.equal(error.action, "authorize-usb");
    return true;
  });
  client.dispose();
});

test("timeout cancels and quarantines the same device until renderer cleanup is acknowledged", async () => {
  let expire;
  let timerCount = 0;
  const { client, ipc, webContents } = setup({ setTimer(callback) { expire = callback; if (timerCount++ > 0) queueMicrotask(callback); return 1; }, clearTimer() {} });
  const payload = { config: { vendorId: "04B8", productId: "0E28", serialNumber: "A" } };
  const first = client.request("usbRaw.send", payload);
  let cleanup;
  let cleaned = false;
  const rejection = assert.rejects(first, (error) => {
    assert.equal(error.code, "TIMEOUT");
    assert.equal(error.retryable, false);
    assert.equal(error.deliveryState, "unknown");
    assert.ok(error.cleanup instanceof Promise);
    cleanup = error.cleanup.then(() => { cleaned = true; });
    return true;
  });
  const { requestId } = webContents.sent[0].message;
  expire();
  await rejection;
  assert.equal(webContents.sent[1].channel, "printer-device-cancel");
  assert.equal(webContents.sent[1].message.requestId, requestId);
  const hidPayload = { config: { vendorId: "04B8", productId: "0E28", productName: "Printer" } };
  await assert.rejects(client.request("usbHid.send", hidPayload), { code: "DEVICE_BUSY", deliveryState: "not-sent" });
  // A late ordinary success is not proof that cancellation cleanup completed.
  ipc.emit("printer-device-response", { sender: webContents }, { requestId, success: true });
  await new Promise(setImmediate);
  assert.equal(cleaned, false);
  await assert.rejects(client.request("usbRaw.send", payload), { code: "DEVICE_BUSY" });
  ipc.emit("printer-device-response", { sender: webContents }, { requestId, success: false, cancelled: true, cleanupComplete: true });
  await cleanup;
  assert.equal(cleaned, true);
  const next = client.request("usbRaw.send", payload);
  const nextId = webContents.sent.at(-1).message.requestId;
  ipc.emit("printer-device-response", { sender: webContents }, { requestId: nextId, success: true, result: "done" });
  assert.equal(await next, "done");
  client.dispose();
});

test("cleanup barriers survive disposal and end only when the renderer acknowledges or is destroyed", async () => {
  let expire;
  const { client, ipc, webContents } = setup({ setTimer(callback) { expire = callback; return 1; }, clearTimer() {} });
  const pending = client.request("usbRaw.send", { config: { serialNumber: "one" } });
  const result = pending.catch((error) => error);
  expire();
  const error = await result;
  assert.ok(error.cleanup instanceof Promise);
  let cleaned = false;
  error.cleanup.then(() => { cleaned = true; });
  client.dispose();
  await new Promise(setImmediate);
  assert.equal(cleaned, false);
  webContents.emit("destroyed");
  await error.cleanup;
  assert.equal(cleaned, true);
  assert.equal(ipc.listenerCount("printer-device-response"), 0);
});

test("a failed resource cleanup quarantines the device and exposes the renderer lifetime barrier", async () => {
  const { client, ipc, webContents } = setup();
  const payload = { config: { deviceId: "A" } };
  const sending = client.request("bluetoothGatt.send", payload);
  const result = sending.catch((error) => error);
  const { requestId } = webContents.sent[0].message;
  ipc.emit("printer-device-response", { sender: webContents }, { requestId, success: false, cleanupComplete: false, error: { code: "CLEANUP_FAILED", message: "Cannot disconnect", deliveryState: "unknown", retryable: false } });
  const error = await result;
  assert.ok(error.cleanup instanceof Promise);
  await assert.rejects(client.request("bluetoothGatt.send", payload), { code: "DEVICE_BUSY" });
  webContents.emit("destroyed");
  await error.cleanup;
  client.dispose();
});

test("caller abort cancels an in-flight bridge request and preserves delivery uncertainty", async () => {
  const { client, webContents } = setup();
  const controller = new AbortController();
  const pending = client.request("bluetoothGatt.send", { config: { deviceId: "ble-A" } }, 5000, { signal: controller.signal });
  const rejection = assert.rejects(pending, { code: "ABORTED", retryable: false, deliveryState: "unknown" });
  controller.abort();
  await rejection;
  assert.equal(webContents.sent.at(-1).channel, "printer-device-cancel");
  client.dispose();
});

test("already aborted requests never enter the renderer", async () => {
  const { client, webContents } = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.request("usbRaw.send", {}, 5000, { signal: controller.signal }), { code: "ABORTED", deliveryState: "not-sent" });
  assert.equal(webContents.sent.length, 0);
  client.dispose();
});
