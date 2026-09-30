const STATES = Object.freeze([
  "queued",
  "connecting",
  "waiting_for_terminal",
  "waiting_for_card",
  "authorizing",
  "cancellation_requested",
  "approved",
  "declined",
  "cancelled",
  "failed",
  "unknown",
]);
const TERMINAL_STATES = new Set([
  "approved",
  "declined",
  "cancelled",
  "failed",
  "unknown",
]);
const ALLOWED_TRANSITIONS = Object.freeze({
  queued: new Set(["connecting", "failed"]),
  connecting: new Set(["waiting_for_terminal", "failed", "unknown"]),
  waiting_for_terminal: new Set([
    "waiting_for_card",
    "authorizing",
    "cancellation_requested",
    "failed",
    "unknown",
  ]),
  waiting_for_card: new Set([
    "authorizing",
    "cancellation_requested",
    "cancelled",
    "failed",
    "unknown",
  ]),
  authorizing: new Set([
    "cancellation_requested",
    "approved",
    "declined",
    "cancelled",
    "failed",
    "unknown",
  ]),
  cancellation_requested: new Set([
    "approved",
    "declined",
    "cancelled",
    "failed",
    "unknown",
  ]),
});

const PERSISTED_FIELDS = [
  "transactionId",
  "terminalId",
  "amount",
  "currency",
  "state",
  "createdAt",
  "updatedAt",
  "message",
  "authorizationReference",
  "merchantReference",
  "rawCode",
  "canCancel",
];

function registryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitize(record) {
  if (!record || typeof record !== "object") return null;
  const output = {};
  for (const field of PERSISTED_FIELDS) {
    if (record[field] !== undefined) output[field] = record[field];
  }
  if (
    !output.transactionId ||
    !output.terminalId ||
    !Number.isSafeInteger(output.amount) ||
    output.amount <= 0 ||
    output.currency !== "EUR" ||
    !STATES.includes(output.state) ||
    !Number.isFinite(Date.parse(output.createdAt)) ||
    !Number.isFinite(Date.parse(output.updatedAt))
  ) {
    return null;
  }
  return output;
}

function createTransactionRegistry({
  initial = [],
  now = Date.now,
  maxEntries = 100,
  maxAgeMs = 30 * 24 * 60 * 60 * 1000,
  onChange = () => {},
} = {}) {
  const cutoff = now() - maxAgeMs;
  let records = initial
    .map(sanitize)
    .filter((record) => record && Date.parse(record.updatedAt) >= cutoff)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, maxEntries);
  let recoveredAfterRestart = false;
  const restartTimestamp = new Date(now()).toISOString();
  records = records.map((record) => {
    if (TERMINAL_STATES.has(record.state)) return record;
    recoveredAfterRestart = true;
    return sanitize({
      ...record,
      state: "unknown",
      updatedAt: restartTimestamp,
      message: "Session interrompue, consultez le journal du TPE",
      rawCode: "restart_recovery",
      canCancel: false,
    });
  });

  function snapshot() {
    return records.map((record) => ({ ...record }));
  }

  function persist() {
    records = records.slice(0, maxEntries);
    onChange(snapshot());
  }

  function get(transactionId) {
    const record = records.find((item) => item.transactionId === transactionId);
    return record ? { ...record } : null;
  }

  function create(input) {
    if (get(input.transactionId)) {
      throw registryError("transaction_exists", "Transaction deja existante");
    }
    const timestamp = new Date(now()).toISOString();
    const record = sanitize({
      ...input,
      state: input.state || "queued",
      createdAt: input.createdAt || timestamp,
      updatedAt: input.updatedAt || timestamp,
    });
    if (!record) throw registryError("invalid_transaction", "Transaction invalide");
    records.unshift(record);
    persist();
    return { ...record };
  }

  function update(transactionId, state, patch = {}) {
    const index = records.findIndex((item) => item.transactionId === transactionId);
    if (index < 0) throw registryError("transaction_not_found", "Transaction inconnue");
    const current = records[index];
    if (TERMINAL_STATES.has(current.state) || !ALLOWED_TRANSITIONS[current.state]?.has(state)) {
      throw registryError(
        "invalid_transition",
        `Transition interdite: ${current.state} -> ${state}`,
      );
    }
    const updated = sanitize({
      ...current,
      ...patch,
      transactionId: current.transactionId,
      terminalId: current.terminalId,
      amount: current.amount,
      currency: current.currency,
      createdAt: current.createdAt,
      state,
      updatedAt: new Date(now()).toISOString(),
    });
    records.splice(index, 1);
    records.unshift(updated);
    persist();
    return { ...updated };
  }

  function list() {
    return snapshot();
  }

  function hasActiveForTerminal(terminalId) {
    return records.some(
      (record) => record.terminalId === terminalId && !TERMINAL_STATES.has(record.state),
    );
  }

  if (recoveredAfterRestart) onChange(snapshot());

  return { create, get, update, list, hasActiveForTerminal };
}

module.exports = {
  STATES,
  TERMINAL_STATES,
  createTransactionRegistry,
};
