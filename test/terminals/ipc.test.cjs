const test = require("node:test");
const assert = require("node:assert/strict");

const { registerTerminalIpc } = require("../../lib/terminals/ipc");

function createIpc() {
  const handlers = new Map();
  const removed = [];
  return {
    handlers,
    removed,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      removed.push(channel);
      handlers.delete(channel);
    },
  };
}

const cases = [
  ["terminals:list", "listTerminals", undefined],
  ["terminals:save", "saveTerminal", { id: "q25" }],
  ["terminals:delete", "deleteTerminal", "q25"],
  ["terminals:list-serial-ports", "listSerialPorts", undefined],
  ["terminals:test-connection", "testConnection", "q25"],
  ["terminal-payments:start", "startPayment", { transactionId: "tx-1" }],
  ["terminal-payments:get", "getPayment", "tx-1"],
  ["terminal-payments:cancel", "cancelPayment", "tx-1"],
];

test("registers each terminal IPC channel and delegates to its service method", async () => {
  const ipc = createIpc();
  const calls = [];
  const service = Object.fromEntries(
    cases.map(([, method]) => [method, async (...args) => {
      calls.push([method, ...args]);
      return `${method}-result`;
    }]),
  );

  registerTerminalIpc({ ipc, service });

  assert.deepEqual([...ipc.handlers.keys()], cases.map(([channel]) => channel));
  for (const [channel, method, payload] of cases) {
    calls.length = 0;
    const result = await ipc.handlers.get(channel)({ sender: "ignored" }, payload);
    assert.deepEqual(result, { ok: true, value: `${method}-result` });
    assert.deepEqual(calls, payload === undefined ? [[method]] : [[method, payload]]);
  }
});

test("returns stable serializable service errors without exposing stacks", async () => {
  const ipc = createIpc();
  const error = new Error("Configuration TPE invalide");
  error.code = "invalid_configuration";
  error.details = ["tcp.host is required"];
  error.stack = "sensitive stack";
  const service = Object.fromEntries(
    cases.map(([, method]) => [method, () => {
      if (method === "saveTerminal") throw error;
      return null;
    }]),
  );

  registerTerminalIpc({ ipc, service });
  const result = await ipc.handlers.get("terminals:save")({}, {});

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid_configuration",
      message: "Configuration TPE invalide",
      details: ["tcp.host is required"],
    },
  });
  assert.equal(JSON.stringify(result).includes("stack"), false);
});

test("dispose removes every registered handler", () => {
  const ipc = createIpc();
  const service = Object.fromEntries(cases.map(([, method]) => [method, () => null]));
  const dispose = registerTerminalIpc({ ipc, service });

  dispose();

  assert.deepEqual(ipc.removed, cases.map(([channel]) => channel));
  assert.equal(ipc.handlers.size, 0);
});
