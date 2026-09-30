const test = require("node:test");
const assert = require("node:assert/strict");

const { createCaisseApProtocol } = require("../../lib/terminals/protocols/caisseAp");
const { createNeptingProtocol } = require("../../lib/terminals/protocols/nepting");

const config = {
  protocolVersion: "",
  cashRegisterId: "012345678901",
  cashRegisterNumber: "01",
  nepting: { merchantId: "72503369065980" },
};
const payment = {
  transactionId: "order-123-payment-1",
  terminalId: "counter-1",
  amount: 1590,
  currency: "EUR",
};

test("builds a Caisse-AP V3 EUR debit with required identifiers", () => {
  const exchange = createCaisseApProtocol().createPayment(payment, config);

  assert.equal(
    exchange.request.toString("ascii"),
    "CZ0040300CJ012012345678901CA00201CB0041590CD0010CE003978BA0010",
  );
  assert.equal(exchange.connectTimeoutMs, 5000);
  assert.equal(exchange.responseTimeoutMs, 180000);
  assert.equal(exchange.responseIdleMs, 250);
  assert.equal(exchange.isFinancial, true);
});

test("builds a distinct Nepting request carrying the merchant transaction ID", () => {
  const exchange = createNeptingProtocol().createPayment(payment, config);

  assert.equal(
    exchange.request.toString("ascii"),
    "CZ0040320CJ012012345678901CA00201CB0041590CD0010CE003978CF019order-123-payment-1",
  );
});

test("creates a non-financial protocol identification probe", () => {
  for (const protocol of [createCaisseApProtocol(), createNeptingProtocol()]) {
    const exchange = protocol.createProbe(config);
    assert.equal(exchange.isFinancial, false);
    assert.match(exchange.request.toString("ascii"), /CD001I/);
    assert.equal(exchange.request.toString("ascii").includes("CB"), false);
  }
});

test("maps success and strips raw receipt data", () => {
  const protocol = createNeptingProtocol();
  const frame = Buffer.from(
    "CZ0040320CJ012012345678901CA00201CB0041590CD0010CE003978ZZ003newAC006184117AE00210CF019order-123-payment-1AK008receipt!",
    "ascii",
  );

  const result = protocol.parseResponse(frame, { kind: "payment" });

  assert.deepEqual(result, {
    state: "approved",
    message: "Paiement accepte",
    authorizationReference: "184117",
    merchantReference: "order-123-payment-1",
    rawCode: "10",
  });
  assert.equal(JSON.stringify(result).includes("receipt"), false);
});

test("maps refusal and customer abandonment to stable states", () => {
  const protocol = createCaisseApProtocol();
  const declined = protocol.parseResponse(
    Buffer.from("CZ0040300AE00201AF00204", "ascii"),
    { kind: "payment" },
  );
  const cancelled = protocol.parseResponse(
    Buffer.from("CZ0040300AE00201AF00206", "ascii"),
    { kind: "payment" },
  );

  assert.deepEqual(declined, {
    state: "declined",
    message: "Paiement refuse",
    rawCode: "04",
  });
  assert.deepEqual(cancelled, {
    state: "cancelled",
    message: "Paiement annule sur le terminal",
    rawCode: "06",
  });
});

test("reports malformed responses as a protocol mismatch", () => {
  const protocol = createCaisseApProtocol();
  assert.throws(
    () => protocol.parseResponse(Buffer.from("CZ0040300AE00X10", "ascii"), {}),
    (error) => error.code === "protocol_mismatch",
  );
});

test("does not invent a cancellation command for an undocumented variant", () => {
  for (const protocol of [createCaisseApProtocol(), createNeptingProtocol()]) {
    assert.equal(protocol.capabilities(config).canCancel, false);
    assert.throws(
      () => protocol.createCancellation({ transactionId: "tx-1" }, config),
      (error) => error.code === "cancellation_not_supported",
    );
  }
});
