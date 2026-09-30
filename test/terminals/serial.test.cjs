const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createSerialTransport } = require("../../lib/terminals/transports/serial");

function createFakeSerialPort(openError = null) {
  const instances = [];
  class FakeSerialPort extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.isOpen = false;
      this.writes = [];
      this.closeCount = 0;
      this.destroyCount = 0;
      instances.push(this);
    }

    open(callback) {
      if (openError) return queueMicrotask(() => callback(openError));
      this.isOpen = true;
      queueMicrotask(() => callback(null));
    }

    write(buffer, callback) {
      this.writes.push(Buffer.from(buffer));
      callback?.(null);
      return true;
    }

    close(callback) {
      this.closeCount += 1;
      this.isOpen = false;
      callback?.(null);
    }

    destroy() {
      this.destroyCount += 1;
    }
  }
  return { FakeSerialPort, instances };
}

function config() {
  return {
    path: "COM8:",
    baudRate: 115200,
    dataBits: 8,
    parity: "none",
    stopBits: 1,
    flowControl: "none",
  };
}

function exchange(overrides = {}) {
  return {
    request: Buffer.from("request"),
    isStructurallyValid: (buffer) => buffer.toString() === "response",
    connectTimeoutMs: 25,
    responseTimeoutMs: 40,
    responseIdleMs: 5,
    ...overrides,
  };
}

test("lists normalized non-sensitive COM metadata", async () => {
  const { FakeSerialPort } = createFakeSerialPort();
  const transport = createSerialTransport({
    SerialPortClass: FakeSerialPort,
    listPorts: async () => [{
      path: "com8:",
      manufacturer: "PAX",
      serialNumber: "Q25-123",
      vendorId: "1234",
      productId: "5678",
      pnpId: "must-not-leak",
    }],
  });

  assert.deepEqual(await transport.list(), [{
    path: "COM8",
    manufacturer: "PAX",
    serialNumber: "Q25-123",
    vendorId: "1234",
    productId: "5678",
  }]);
});

test("opens 115200 8N1, buffers split reads, writes once, and disposes", async () => {
  const { FakeSerialPort, instances } = createFakeSerialPort();
  const transport = createSerialTransport({
    SerialPortClass: FakeSerialPort,
    listPorts: async () => [{ path: "COM8" }],
  });
  const promise = transport.exchange(config(), exchange());
  await new Promise((resolve) => setImmediate(resolve));
  const port = instances[0];
  port.emit("data", Buffer.from("res"));
  port.emit("data", Buffer.from("ponse"));

  const result = await promise;

  assert.deepEqual(port.options, {
    path: "COM8",
    baudRate: 115200,
    dataBits: 8,
    parity: "none",
    stopBits: 1,
    rtscts: false,
    xon: false,
    xoff: false,
    autoOpen: false,
  });
  assert.equal(result.response.toString(), "response");
  assert.equal(result.requestWritten, true);
  assert.equal(port.writes.length, 1);
  assert.equal(port.closeCount, 1);
  assert.equal(port.destroyCount, 1);
});

test("reports an open failure before writing", async () => {
  const { FakeSerialPort, instances } = createFakeSerialPort(new Error("access denied"));
  const transport = createSerialTransport({
    SerialPortClass: FakeSerialPort,
    listPorts: async () => [{ path: "COM8" }],
  });

  await assert.rejects(
    transport.exchange(config(), exchange()),
    (error) => error.code === "serial_open_failed" && error.requestWritten === false,
  );
  assert.equal(instances[0].writes.length, 0);
  assert.equal(instances[0].destroyCount, 1);
});

test("reports a missing port before constructing it", async () => {
  const { FakeSerialPort, instances } = createFakeSerialPort();
  const transport = createSerialTransport({
    SerialPortClass: FakeSerialPort,
    listPorts: async () => [{ path: "COM9" }],
  });

  await assert.rejects(
    transport.exchange(config(), exchange()),
    (error) => error.code === "serial_port_not_found" && error.requestWritten === false,
  );
  assert.equal(instances.length, 0);
});

test("reports response timeout after exactly one serial write", async () => {
  const { FakeSerialPort, instances } = createFakeSerialPort();
  const transport = createSerialTransport({
    SerialPortClass: FakeSerialPort,
    listPorts: async () => [{ path: "COM8" }],
  });

  await assert.rejects(
    transport.exchange(config(), exchange({ responseTimeoutMs: 5 })),
    (error) => error.code === "response_timeout" && error.requestWritten === true,
  );
  assert.equal(instances[0].writes.length, 1);
  assert.equal(instances[0].closeCount, 1);
  assert.equal(instances[0].destroyCount, 1);
});
