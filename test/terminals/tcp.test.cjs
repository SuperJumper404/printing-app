const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createTcpTransport } = require("../../lib/terminals/transports/tcp");

function fakeSocket(connectBehavior = (socket) => socket.emit("connect")) {
  const socket = new EventEmitter();
  socket.writes = [];
  socket.destroyedByTransport = false;
  socket.connect = (port, host) => {
    socket.connection = { port, host };
    queueMicrotask(() => connectBehavior(socket));
  };
  socket.write = (buffer, callback) => {
    socket.writes.push(Buffer.from(buffer));
    callback?.();
    return true;
  };
  socket.destroy = () => {
    socket.destroyedByTransport = true;
  };
  return socket;
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

test("reports connection refusal before any payment bytes are written", async () => {
  const socket = fakeSocket((value) => value.emit("error", new Error("ECONNREFUSED")));
  const transport = createTcpTransport({ createSocket: () => socket });

  await assert.rejects(
    transport.exchange({ host: "192.168.1.50", port: 8888 }, exchange()),
    (error) => error.code === "connection_refused" && error.requestWritten === false,
  );
  assert.equal(socket.writes.length, 0);
  assert.equal(socket.destroyedByTransport, true);
});

test("buffers split responses and resolves after the valid-frame idle window", async () => {
  const socket = fakeSocket();
  const transport = createTcpTransport({ createSocket: () => socket });
  const resultPromise = transport.exchange(
    { host: "192.168.1.50", port: 8888 },
    exchange(),
  );
  socket.on("connect", () => {
    socket.emit("data", Buffer.from("res"));
    setTimeout(() => socket.emit("data", Buffer.from("ponse")), 1);
  });

  const result = await resultPromise;

  assert.equal(result.response.toString(), "response");
  assert.equal(result.requestWritten, true);
  assert.equal(socket.writes.length, 1);
  assert.equal(socket.destroyedByTransport, true);
});

test("reports a connect timeout before write and destroys the socket", async () => {
  const socket = fakeSocket(() => {});
  const transport = createTcpTransport({ createSocket: () => socket });

  await assert.rejects(
    transport.exchange(
      { host: "192.168.1.50", port: 8888 },
      exchange({ connectTimeoutMs: 5 }),
    ),
    (error) => error.code === "connection_timeout" && error.requestWritten === false,
  );
  assert.equal(socket.destroyedByTransport, true);
});

test("reports a response timeout after exactly one write", async () => {
  const socket = fakeSocket();
  const transport = createTcpTransport({ createSocket: () => socket });

  await assert.rejects(
    transport.exchange(
      { host: "192.168.1.50", port: 8888 },
      exchange({ responseTimeoutMs: 5 }),
    ),
    (error) => error.code === "response_timeout" && error.requestWritten === true,
  );
  assert.equal(socket.writes.length, 1);
  assert.equal(socket.destroyedByTransport, true);
});

test("probe uses the same safe exchange lifecycle", async () => {
  const socket = fakeSocket();
  const transport = createTcpTransport({ createSocket: () => socket });
  const promise = transport.probe(
    { host: "terminal.local", port: 8888 },
    exchange({ isStructurallyValid: () => true }),
  );
  socket.on("connect", () => socket.emit("data", Buffer.from("ready")));

  const result = await promise;

  assert.equal(result.response.toString(), "ready");
  assert.deepEqual(socket.connection, { host: "terminal.local", port: 8888 });
  assert.equal(socket.writes.length, 1);
});
