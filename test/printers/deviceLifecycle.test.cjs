const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Browser modules are evaluated unchanged, with only relative import locations resolved.
function browserModule(relative) {
  const filename = path.resolve(__dirname, "../..", relative);
  const source = fs.readFileSync(filename, "utf8").replace(
    /(from\s+["'])(\.[^"']+)(["'])/g,
    (_, start, target, end) => start + pathToFileURL(path.resolve(path.dirname(filename), target)).href + end,
  );
  return import(`data:text/javascript;base64,${Buffer.from(source + `\n//# sourceURL=${pathToFileURL(filename).href}`).toString("base64")}`);
}

function navigatorWith(value) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value });
}

function usbDevice(overrides = {}) {
  const events = [];
  const device = {
    vendorId: 0x04b8, productId: 0x0e28, serialNumber: "ABC", productName: "Printer", opened: false,
    configurations: [{ configurationValue: 1, interfaces: [{ interfaceNumber: 0, alternates: [{
      alternateSetting: 0, interfaceClass: 7,
      endpoints: [{ endpointNumber: 1, direction: "out", type: "bulk", packetSize: 64 }],
    }] }] }],
    async open() { events.push("open"); this.opened = true; },
    async selectConfiguration() { events.push("select"); },
    async claimInterface() { events.push("claim"); },
    async transferOut(_, bytes) { events.push("write"); return { status: "ok", bytesWritten: bytes.byteLength }; },
    async releaseInterface() { events.push("release"); },
    async close() { events.push("close"); this.opened = false; },
    ...overrides,
  };
  return { device, events };
}

test("USB matching refuses two identical authorized models instead of selecting the first", async () => {
  const usb = await browserModule("src/printers/webUsbTransport.js");
  navigatorWith({ usb: { getDevices: async () => [usbDevice().device, usbDevice().device] } });
  await assert.rejects(usb.findAuthorizedUsbDevice({ vendorId: "04B8", productId: "0E28" }), (error) =>
    error.code === "AMBIGUOUS_DEVICE" && error.retryable === false && error.deliveryState === "not-sent");
});

test("HID matching refuses an ambiguous model and product name", async () => {
  const hid = await browserModule("src/printers/webHidTransport.js");
  const device = { vendorId: 1, productId: 2, productName: "Receipt" };
  navigatorWith({ hid: { getDevices: async () => [device, { ...device }] } });
  await assert.rejects(hid.findAuthorizedHidDevice({ vendorId: "0001", productName: "Receipt" }), { code: "AMBIGUOUS_DEVICE" });
});

test("Bluetooth device ID takes precedence over an earlier device with the same name", async () => {
  const bt = await browserModule("src/printers/webBluetoothTransport.js");
  const devices = [{ id: "wrong", name: "Receipt" }, { id: "correct", name: "Receipt" }];
  navigatorWith({ bluetooth: { getDevices: async () => devices } });
  assert.equal(await bt.findAuthorizedBluetoothDevice({ deviceId: "correct", name: "Receipt" }), devices[1]);
  assert.equal(await bt.findAuthorizedBluetoothDevice({ deviceId: "absent", name: "Receipt" }), null);
  await assert.rejects(bt.findAuthorizedBluetoothDevice({ name: "Receipt" }), { code: "AMBIGUOUS_DEVICE" });
});

test("partial USB transfers fail as uncertain delivery and release their interface", async () => {
  const usb = await browserModule("src/printers/webUsbTransport.js");
  const { device, events } = usbDevice({ async transferOut() { return { status: "ok", bytesWritten: 1 }; } });
  await assert.rejects(usb.sendUsbEscPos(device, {}, Uint8Array.from([1, 2, 3])), (error) =>
    error.code === "PARTIAL_WRITE" && error.deliveryState === "unknown" && error.retryable === false);
  assert.deepEqual(events, ["open", "select", "claim", "release", "close"]);
});

test("USB abort during a write cleans up immediately and cannot acknowledge before the write ends", async () => {
  const usb = await browserModule("src/printers/webUsbTransport.js");
  let finishWrite;
  let entered;
  const writing = new Promise((resolve) => { entered = resolve; });
  const { device, events } = usbDevice({ transferOut() { entered(); return new Promise((resolve) => { finishWrite = resolve; }); } });
  const controller = new AbortController();
  let settled = false;
  const sending = usb.sendUsbEscPos(device, {}, new Uint8Array([1]), { signal: controller.signal });
  const result = sending.then(() => { settled = true; }, (error) => { settled = true; return error; });
  await writing;
  controller.abort();
  await new Promise(setImmediate);
  assert.equal(device.opened, false);
  assert.equal(settled, false);
  finishWrite({ status: "ok", bytesWritten: 1 });
  const error = await result;
  assert.equal(error?.code, "ABORTED");
  assert.equal(error.deliveryState, "unknown");
  assert.equal(events.filter((item) => item === "close").length, 1);
});

test("an HID abort after the first report sends no further report and closes the device", async () => {
  const hid = await browserModule("src/printers/webHidTransport.js");
  const controller = new AbortController();
  let writes = 0;
  let closed = false;
  const device = {
    vendorId: 1, productId: 2, opened: false,
    async open() { this.opened = true; },
    async sendReport() { writes++; controller.abort(); },
    async close() { this.opened = false; closed = true; },
  };
  await assert.rejects(hid.sendHidEscPos(device, { reportId: 0, packetSize: 1 }, new Uint8Array([1, 2]), { signal: controller.signal }),
    (error) => error.code === "ABORTED" && error.deliveryState === "unknown" && !error.retryable);
  assert.equal(writes, 1);
  assert.equal(closed, true);
});

test("GATT service permission errors request authorization for the configured service", async () => {
  const bt = await browserModule("src/printers/webBluetoothTransport.js");
  let disconnected = false;
  const device = { gatt: {
    connected: false,
    async connect() { this.connected = true; return { async getPrimaryService() { throw Object.assign(new Error("Access denied"), { name: "SecurityError" }); } }; },
    disconnect() { disconnected = true; this.connected = false; },
  } };
  await assert.rejects(bt.sendGattEscPos(device, { serviceUuid: "ffe0", characteristicUuid: "ffe1" }, new Uint8Array([1])),
    (error) => error.code === "PERMISSION_DENIED" && error.action === "authorize-bluetooth-service" && error.deliveryState === "not-sent" && !error.retryable);
  assert.equal(disconnected, true);
});

test("GATT authorization requires a service and passes vendor UUIDs as optional services", async () => {
  const bt = await browserModule("src/printers/webBluetoothTransport.js");
  const requests = [];
  navigatorWith({ bluetooth: { async requestDevice(options) { requests.push(options); return { id: "paired", name: "Printer" }; } } });
  globalThis.window = { require: () => ({ ipcRenderer: { send() {} } }) };
  await assert.rejects(bt.authorizeBluetoothDevice({}), { code: "CONFIGURATION", action: "configure-bluetooth-gatt" });
  const result = await bt.authorizeBluetoothDevice({ serviceUuid: "0000FFE0-0000-0000-0000-000000000001" });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].optionalServices, ["0000ffe0-0000-0000-0000-000000000001"]);
  assert.equal(result.deviceId, "paired");
});

test("GATT abort after a chunk prevents the next chunk and disconnects", async () => {
  const bt = await browserModule("src/printers/webBluetoothTransport.js");
  const controller = new AbortController();
  let writes = 0;
  let disconnects = 0;
  const characteristic = { properties: { write: true }, async writeValueWithResponse() { writes++; controller.abort(); } };
  const device = { gatt: {
    connected: false,
    async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }; },
    disconnect() { this.connected = false; disconnects++; },
  } };
  await assert.rejects(bt.sendGattEscPos(device, { serviceUuid: "ffe0", characteristicUuid: "ffe1", maxChunkSize: 1 }, new Uint8Array([1, 2]), { signal: controller.signal }), { code: "ABORTED", deliveryState: "unknown" });
  assert.equal(writes, 1);
  assert.equal(disconnects, 1);
});

test("browser DOMExceptions with numeric codes are classified as safe pre-send failures", async () => {
  const usb = await browserModule("src/printers/webUsbTransport.js");
  const hid = await browserModule("src/printers/webHidTransport.js");
  const bt = await browserModule("src/printers/webBluetoothTransport.js");
  const denied = new DOMException("Access denied", "SecurityError");
  const usbDenied = usbDevice({ async open() { throw denied; } }).device;
  await assert.rejects(usb.sendUsbEscPos(usbDenied, {}, new Uint8Array([1])), { code: "PERMISSION_DENIED", retryable: false, deliveryState: "not-sent" });
  const hidDenied = { vendorId: 1, productId: 2, opened: false, async open() { throw denied; } };
  await assert.rejects(hid.sendHidEscPos(hidDenied, { reportId: 0, packetSize: 1 }, new Uint8Array([1])), { code: "PERMISSION_DENIED", retryable: false, deliveryState: "not-sent" });
  const btDenied = { gatt: { connected: false, async connect() { throw denied; } } };
  await assert.rejects(bt.sendGattEscPos(btDenied, { serviceUuid: "ffe0", characteristicUuid: "ffe1" }, new Uint8Array([1])), { code: "PERMISSION_DENIED", retryable: false, deliveryState: "not-sent" });
});

test("USB cleanup finishes releasing the interface before normal close", async () => {
  const usb = await browserModule("src/printers/webUsbTransport.js");
  let released = false;
  const { device } = usbDevice({
    async releaseInterface() { await new Promise(setImmediate); released = true; },
    async close() { assert.equal(released, true); },
  });
  await usb.sendUsbEscPos(device, {}, new Uint8Array([1]));
});
