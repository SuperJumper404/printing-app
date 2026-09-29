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

  await assert.rejects(client.request("usbRaw.send", {}), /delai/i);
  assert.equal(timeoutDelay, 5000);
  client.dispose();
});

test("rejects pending requests when renderer webContents is destroyed", async () => {
  const { client, webContents } = setup();
  const pending = client.request("usbHid.send", {});
  webContents.emit("destroyed");

  await assert.rejects(pending, /fermee/i);
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
