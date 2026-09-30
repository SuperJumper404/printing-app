const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { registerTerminalRoutes } = require("../../lib/terminals/http");

async function withServer(service, run, token = "session-token") {
  const app = express();
  app.use(express.json());
  registerTerminalRoutes({ app, service, getSessionToken: () => token });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(base, path, options = {}) {
  const headers = { authorization: "Bearer session-token", ...options.headers };
  return fetch(`${base}${path}`, { ...options, headers });
}

function serviceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function fakeService(overrides = {}) {
  return {
    listTerminals: () => [{ id: "q25" }],
    testConnection: async (id) => ({ success: true, id }),
    startPayment: async (body) => ({ ...body, state: "queued" }),
    getPayment: () => null,
    cancelPayment: async (id) => ({ transactionId: id, state: "cancelled" }),
    ...overrides,
  };
}

test("all terminal HTTP routes require the saved bearer token", async () => {
  await withServer(fakeService(), async (base) => {
    for (const authorization of [undefined, "Bearer wrong-token"]) {
      const headers = authorization ? { authorization } : {};
      const response = await fetch(`${base}/terminals`, { headers });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: { code: "authentication_required", message: "Authentification requise" },
      });
    }
  });
});

test("lists terminals and runs a protocol-level connection test", async () => {
  const calls = [];
  await withServer(fakeService({
    testConnection: async (id) => {
      calls.push(id);
      return { success: true, protocol: "nepting" };
    },
  }), async (base) => {
    const listResponse = await request(base, "/terminals");
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), [{ id: "q25" }]);

    const testResponse = await request(base, "/terminals/q25/test", { method: "POST" });
    assert.equal(testResponse.status, 200);
    assert.deepEqual(await testResponse.json(), { success: true, protocol: "nepting" });
    assert.deepEqual(calls, ["q25"]);
  });
});

test("lists only non-sensitive terminal metadata over HTTP", async () => {
  await withServer(fakeService({
    listTerminals: () => [{
      id: "q25",
      name: "TPE comptoir",
      manufacturer: "PAX",
      model: "Q25",
      enabled: true,
      protocol: "nepting",
      transport: "tcp",
      cashRegisterId: "000000000001",
      tcp: { host: "192.168.1.40", port: 8888 },
      nepting: { merchantId: "72503369065980" },
    }],
  }), async (base) => {
    const response = await request(base, "/terminals");
    assert.deepEqual(await response.json(), [{
      id: "q25",
      name: "TPE comptoir",
      manufacturer: "PAX",
      model: "Q25",
      enabled: true,
      protocol: "nepting",
      transport: "tcp",
    }]);
  });
});

test("maps missing terminals and malformed payments to 404 and 400", async () => {
  await withServer(fakeService({
    testConnection: async () => { throw serviceError("terminal_not_found"); },
    startPayment: async () => { throw serviceError("invalid_payment_request"); },
  }), async (base) => {
    assert.equal((await request(base, "/terminals/missing/test", { method: "POST" })).status, 404);
    assert.equal((await request(base, "/terminal-payments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 0 }),
    })).status, 400);
  });
});

test("does not expose unknown adapter error codes", async () => {
  await withServer(fakeService({
    testConnection: async () => {
      throw serviceError("merchant_secret_72503369065980");
    },
  }), async (base) => {
    const response = await request(base, "/terminals/q25/test", { method: "POST" });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { code: "internal_error", message: "Erreur interne du module TPE" },
    });
  });
});

test("accepts new payments, polls status, and handles idempotent replay", async () => {
  const transaction = {
    transactionId: "tx-1",
    terminalId: "q25",
    amount: 100,
    currency: "EUR",
    state: "queued",
  };
  let existing = null;
  await withServer(fakeService({
    getPayment: (id) => id === "tx-1" ? existing : null,
    startPayment: async () => {
      existing = transaction;
      return transaction;
    },
  }), async (base) => {
    const options = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionId: "tx-1", terminalId: "q25", amount: 100, currency: "EUR" }),
    };
    const accepted = await request(base, "/terminal-payments", options);
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), transaction);

    const replay = await request(base, "/terminal-payments", options);
    assert.equal(replay.status, 200);

    const poll = await request(base, "/terminal-payments/tx-1");
    assert.equal(poll.status, 200);
    assert.deepEqual(await poll.json(), transaction);
  });
});

test("maps transaction conflicts and busy terminals to 409", async () => {
  for (const code of ["transaction_conflict", "terminal_busy"]) {
    await withServer(fakeService({
      startPayment: async () => { throw serviceError(code); },
    }), async (base) => {
      const response = await request(base, "/terminal-payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId: "tx-1" }),
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, code);
    });
  }
});

test("cancels a payment and maps a missing transaction to 404", async () => {
  await withServer(fakeService({
    getPayment: (id) => id === "missing" ? null : ({ transactionId: id, state: "queued" }),
  }), async (base) => {
    const cancelled = await request(base, "/terminal-payments/tx-1/cancel", { method: "POST" });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).state, "cancelled");

    const missing = await request(base, "/terminal-payments/missing");
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "transaction_not_found");
  });
});

test("rejects transport overrides supplied by an HTTP caller", async () => {
  let calls = 0;
  await withServer(fakeService({ startPayment: async () => { calls += 1; } }), async (base) => {
    for (const field of [{ host: "10.0.0.2" }, { port: 1234 }, { serial: { path: "COM9" } }]) {
      const response = await request(base, "/terminal-payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId: "tx-1", terminalId: "q25", amount: 100, ...field }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "invalid_payment_request");
    }
    assert.equal(calls, 0);
  });
});
