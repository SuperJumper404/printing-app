const test = require("node:test");
const assert = require("node:assert/strict");

const { createTerminalService } = require("../../lib/terminals/service");
const { redactTerminalValue } = require("../../lib/terminals/model");

function createStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    get(key, fallback) {
      return data.has(key) ? data.get(key) : fallback;
    },
    set(key, value) {
      data.set(key, structuredClone(value));
    },
    value(key) {
      return data.get(key);
    },
  };
}

function terminal(id, protocol = "caisse-ap", transport = "tcp") {
  return {
    id,
    name: `TPE ${id}`,
    manufacturer: "PAX",
    model: "Q25",
    enabled: true,
    protocol,
    protocolVersion: protocol === "nepting" ? "0320" : "0300",
    transport,
    cashRegisterId: "012345678901",
    cashRegisterNumber: "01",
    tcp: { host: "192.168.1.50", port: 8888 },
    serial: {
      path: "COM8",
      baudRate: 115200,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flowControl: "none",
    },
    nepting: { merchantId: "72503369065980" },
  };
}

function payment(transactionId, terminalId = "terminal-1", amount = 1590) {
  return { transactionId, terminalId, amount, currency: "EUR" };
}

function createAdapters(overrides = {}) {
  const calls = [];
  function protocol(id) {
    return {
      id,
      capabilities: () => ({ canCancel: false }),
      createProbe: () => ({ kind: "probe" }),
      createPayment: (request) => ({ kind: "payment", request, protocolId: id }),
      createCancellation() {
        const error = new Error("unsupported");
        error.code = "cancellation_not_supported";
        throw error;
      },
      parseResponse: (_response, exchange) =>
        exchange.kind === "probe"
          ? { state: "ready", message: "TPE joignable", rawCode: "0320" }
          : { state: "approved", message: "Paiement accepte", rawCode: "10" },
    };
  }
  function transport(id) {
    return {
      list: async () => [{ path: "COM8" }],
      probe: async (config, exchange) => {
        calls.push({ operation: "probe", transportId: id, config, exchange });
        return { response: Buffer.from("probe-response"), requestWritten: true };
      },
      exchange: async (config, exchange) => {
        calls.push({ operation: "payment", transportId: id, config, exchange });
        return { response: Buffer.from("payment-response"), requestWritten: true };
      },
    };
  }
  return {
    calls,
    protocols: {
      "caisse-ap": protocol("caisse-ap"),
      nepting: protocol("nepting"),
      ...overrides.protocols,
    },
    transports: {
      tcp: transport("tcp"),
      serial: transport("serial"),
      ...overrides.transports,
    },
  };
}

async function waitForState(service, transactionId, states) {
  const expected = new Set(Array.isArray(states) ? states : [states]);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const current = service.getPayment(transactionId);
    if (expected.has(current?.state)) return current;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Transaction ${transactionId} did not reach ${[...expected].join(", ")}`);
}

test("saves, lists, and deletes normalized terminals", () => {
  const store = createStore();
  const adapters = createAdapters();
  const service = createTerminalService({ store, ...adapters });

  const saved = service.saveTerminal(terminal("terminal-1", "nepting", "serial"));
  assert.equal(saved.serial.path, "COM8");
  assert.deepEqual(service.listTerminals().map((item) => item.id), ["terminal-1"]);
  assert.deepEqual(store.value("terminals").map((item) => item.id), ["terminal-1"]);

  assert.deepEqual(service.deleteTerminal("terminal-1"), { success: true });
  assert.deepEqual(service.listTerminals(), []);
});

test("selects the configured adapter for all four combinations", async () => {
  const store = createStore();
  const adapters = createAdapters();
  const service = createTerminalService({ store, ...adapters });
  const combinations = [
    ["caisse-ap", "tcp"],
    ["caisse-ap", "serial"],
    ["nepting", "tcp"],
    ["nepting", "serial"],
  ];

  for (const [protocol, transport] of combinations) {
    const id = `${protocol}-${transport}`;
    service.saveTerminal(terminal(id, protocol, transport));
    await service.startPayment(payment(`tx-${id}`, id));
    await waitForState(service, `tx-${id}`, "approved");
  }

  assert.deepEqual(
    adapters.calls.filter((call) => call.operation === "payment").map((call) => [
      call.exchange.protocolId,
      call.transportId,
    ]),
    combinations,
  );
});

test("performs a protocol-level connection probe", async () => {
  const store = createStore({ terminals: [terminal("terminal-1", "nepting", "serial")] });
  const adapters = createAdapters();
  const service = createTerminalService({ store, ...adapters });

  const result = await service.testConnection("terminal-1");

  assert.equal(result.success, true);
  assert.equal(result.state, "ready");
  assert.equal(adapters.calls[0].operation, "probe");
  assert.equal(adapters.calls[0].transportId, "serial");
});

test("locks an active terminal and preserves identical idempotent requests", async () => {
  let resolvePayment;
  const pending = new Promise((resolve) => { resolvePayment = resolve; });
  const adapters = createAdapters({
    transports: {
      tcp: {
        probe: async () => ({ response: Buffer.from("probe"), requestWritten: true }),
        exchange: async () => pending,
      },
    },
  });
  const service = createTerminalService({
    store: createStore({ terminals: [terminal("terminal-1")] }),
    ...adapters,
  });

  const first = await service.startPayment(payment("tx-1"));
  const replay = await service.startPayment(payment("tx-1"));
  assert.equal(first.transactionId, replay.transactionId);
  await assert.rejects(
    service.startPayment(payment("tx-2")),
    (error) => error.code === "terminal_busy",
  );
  assert.throws(
    () => service.saveTerminal({ ...terminal("terminal-1"), name: "Changed" }),
    (error) => error.code === "terminal_busy",
  );
  assert.throws(
    () => service.deleteTerminal("terminal-1"),
    (error) => error.code === "terminal_busy",
  );

  resolvePayment({ response: Buffer.from("ok"), requestWritten: true });
  await waitForState(service, "tx-1", "approved");
});

test("rejects conflicting reuse of a transaction ID", async () => {
  const service = createTerminalService({
    store: createStore({ terminals: [terminal("terminal-1")] }),
    ...createAdapters(),
  });
  await service.startPayment(payment("tx-1"));

  await assert.rejects(
    service.startPayment(payment("tx-1", "terminal-1", 2590)),
    (error) => error.code === "transaction_conflict",
  );
});

test("maps pre-write failures to failed and post-write timeouts to unknown without fallback", async () => {
  const writeCounts = { tcp: 0, serial: 0 };
  const tcp = {
    probe: async () => ({ response: Buffer.from("probe"), requestWritten: false }),
    exchange: async (_config, exchange) => {
      writeCounts.tcp += 1;
      const error = new Error(exchange.request.transactionId === "tx-before" ? "refused" : "timeout");
      error.code = exchange.request.transactionId === "tx-before" ? "connection_refused" : "response_timeout";
      error.requestWritten = exchange.request.transactionId !== "tx-before";
      throw error;
    },
  };
  const serial = {
    list: async () => [],
    probe: async () => ({ response: Buffer.alloc(0), requestWritten: false }),
    exchange: async () => { writeCounts.serial += 1; },
  };
  const service = createTerminalService({
    store: createStore({ terminals: [terminal("terminal-1")] }),
    ...createAdapters({ transports: { tcp, serial } }),
  });

  await service.startPayment(payment("tx-before"));
  assert.equal((await waitForState(service, "tx-before", "failed")).state, "failed");
  await service.startPayment(payment("tx-after"));
  assert.equal((await waitForState(service, "tx-after", "unknown")).state, "unknown");
  assert.deepEqual(writeCounts, { tcp: 2, serial: 0 });
});

test("reports unsupported cancellation without changing payment state", async () => {
  let resolvePayment;
  const service = createTerminalService({
    store: createStore({ terminals: [terminal("terminal-1")] }),
    ...createAdapters({
      transports: {
        tcp: {
          probe: async () => ({ response: Buffer.from("probe"), requestWritten: true }),
          exchange: async () => new Promise((resolve) => { resolvePayment = resolve; }),
        },
      },
    }),
  });
  await service.startPayment(payment("tx-1"));

  await assert.rejects(
    service.cancelPayment("tx-1"),
    (error) => error.code === "cancellation_not_supported",
  );
  assert.notEqual(service.getPayment("tx-1").state, "cancelled");
  resolvePayment({ response: Buffer.from("ok"), requestWritten: true });
  await waitForState(service, "tx-1", "approved");
});

test("does not expose or persist sensitive adapter data", async () => {
  const secrets = {
    pan: "4111111111111111",
    token: "tok_secret_abcdef",
    merchantId: "72503369065980",
    rawFrame: "CZ0040320CB0041590",
    receipt: "CARD RECEIPT SECRET",
  };
  const store = createStore({ terminals: [terminal("terminal-1", "nepting")] });
  const adapters = createAdapters();
  adapters.protocols.nepting.parseResponse = () => ({
    state: "approved",
    message: Object.values(secrets).join(" "),
    authorizationReference: secrets.pan,
    merchantReference: secrets.merchantId,
    rawCode: "10",
    token: secrets.token,
    rawFrame: secrets.rawFrame,
    receipt: secrets.receipt,
  });
  const service = createTerminalService({ store, ...adapters });

  await service.startPayment(payment("tx-sensitive"));
  const result = await waitForState(service, "tx-sensitive", "approved");
  const serialized = JSON.stringify({
    persisted: store.value("terminalTransactions"),
    result,
    logs: redactTerminalValue(secrets),
  });

  for (const secret of Object.values(secrets)) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});
