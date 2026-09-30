const test = require("node:test");
const assert = require("node:assert/strict");

const { createTransactionRegistry } = require("../../lib/terminals/transactions");

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

function record(id, state = "queued", updatedAt = NOW) {
  return {
    transactionId: id,
    terminalId: "counter-1",
    amount: 1590,
    currency: "EUR",
    state,
    createdAt: new Date(updatedAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

test("permits defined progress transitions and persists newest first", () => {
  const snapshots = [];
  const registry = createTransactionRegistry({
    now: () => NOW,
    onChange: (items) => snapshots.push(items),
  });
  registry.create(record("tx-1"));
  registry.update("tx-1", "connecting");
  registry.update("tx-1", "waiting_for_terminal");
  registry.update("tx-1", "authorizing");
  registry.update("tx-1", "approved", { authorizationReference: "184117" });
  registry.create(record("tx-2"));

  assert.deepEqual(registry.list().map((item) => item.transactionId), ["tx-2", "tx-1"]);
  assert.equal(registry.get("tx-1").state, "approved");
  assert.equal(registry.get("tx-1").authorizationReference, "184117");
  assert.deepEqual(snapshots.at(-1).map((item) => item.transactionId), ["tx-2", "tx-1"]);
});

test("keeps terminal states immutable", () => {
  const registry = createTransactionRegistry({ now: () => NOW });
  registry.create(record("tx-1"));
  registry.update("tx-1", "connecting");
  registry.update("tx-1", "waiting_for_terminal");
  registry.update("tx-1", "authorizing");
  registry.update("tx-1", "declined");

  assert.throws(
    () => registry.update("tx-1", "approved"),
    (error) => error.code === "invalid_transition",
  );
  assert.equal(registry.get("tx-1").state, "declined");
});

test("rejects transitions that skip the payment lifecycle", () => {
  const registry = createTransactionRegistry({ now: () => NOW });
  registry.create(record("tx-1"));

  assert.throws(
    () => registry.update("tx-1", "approved"),
    (error) => error.code === "invalid_transition",
  );
});

test("evicts expired and excess restored transactions", () => {
  const day = 24 * 60 * 60 * 1000;
  const initial = [
    record("expired", "approved", NOW - 31 * day),
    record("kept-1", "approved", NOW - 2 * day),
    record("kept-2", "declined", NOW - day),
    record("kept-3", "cancelled", NOW),
  ];
  const registry = createTransactionRegistry({
    initial,
    now: () => NOW,
    maxEntries: 2,
    maxAgeMs: 30 * day,
  });

  assert.deepEqual(registry.list().map((item) => item.transactionId), ["kept-3", "kept-2"]);
});

test("sanitizes restored and patched transaction fields", () => {
  const unsafe = {
    ...record("tx-1", "approved"),
    rawFrame: "CZ0040320",
    token: "secret",
    receipt: "card receipt",
    arbitrary: "value",
    message: "Paiement accepte",
    merchantReference: "order-123",
  };
  const registry = createTransactionRegistry({ initial: [unsafe], now: () => NOW });

  assert.deepEqual(registry.get("tx-1"), {
    ...record("tx-1", "approved"),
    message: "Paiement accepte",
    merchantReference: "order-123",
  });
});

test("reports whether a terminal owns an active transaction", () => {
  const registry = createTransactionRegistry({ now: () => NOW });
  registry.create(record("tx-1"));
  assert.equal(registry.hasActiveForTerminal("counter-1"), true);
  registry.update("tx-1", "failed");
  assert.equal(registry.hasActiveForTerminal("counter-1"), false);
});

test("reconciles restored in-flight transactions as unknown after restart", () => {
  const persisted = [];
  const registry = createTransactionRegistry({
    initial: [record("tx-1", "authorizing")],
    now: () => NOW,
    onChange: (records) => persisted.push(records),
  });

  assert.deepEqual(registry.get("tx-1"), {
    ...record("tx-1", "unknown"),
    updatedAt: new Date(NOW).toISOString(),
    message: "Session interrompue, consultez le journal du TPE",
    rawCode: "restart_recovery",
    canCancel: false,
  });
  assert.equal(registry.hasActiveForTerminal("counter-1"), false);
  assert.deepEqual(persisted, [registry.list()]);
});
