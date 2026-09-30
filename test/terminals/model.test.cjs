const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROTOCOL_IDS,
  TRANSPORT_IDS,
  normalizeTerminalConfig,
  validateTerminalConfig,
  validatePaymentRequest,
  redactTerminalValue,
} = require("../../lib/terminals/model");

function terminal(protocol, transport) {
  return {
    id: `counter-${protocol}-${transport}`,
    name: "TPE comptoir",
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
      path: "COM8:",
      baudRate: 115200,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flowControl: "none",
    },
    nepting: {
      merchantId: "72503369065980",
    },
  };
}

test("accepts every supported protocol and transport combination", () => {
  assert.deepEqual(PROTOCOL_IDS, ["caisse-ap", "nepting"]);
  assert.deepEqual(TRANSPORT_IDS, ["tcp", "serial"]);

  for (const protocol of PROTOCOL_IDS) {
    for (const transport of TRANSPORT_IDS) {
      const result = validateTerminalConfig(terminal(protocol, transport));
      assert.equal(result.ok, true, `${protocol}/${transport}`);
      assert.equal(result.value.protocol, protocol);
      assert.equal(result.value.transport, transport);
      assert.equal(result.value.cashRegisterId, "012345678901");
      assert.equal(result.value.cashRegisterNumber, "01");
    }
  }
});

test("normalizes COM paths and removes unknown configuration fields", () => {
  const input = terminal("nepting", "serial");
  input.adminPassword = "must-not-survive";
  input.serial.driverSecret = "must-not-survive";
  input.tcp.extra = "must-not-survive";

  const normalized = normalizeTerminalConfig(input);

  assert.equal(normalized.serial.path, "COM8");
  assert.equal(Object.hasOwn(normalized, "adminPassword"), false);
  assert.equal(Object.hasOwn(normalized.serial, "driverSecret"), false);
  assert.equal(Object.hasOwn(normalized.tcp, "extra"), false);
});

test("rejects invalid TCP and serial configuration", () => {
  const badTcp = terminal("caisse-ap", "tcp");
  badTcp.tcp = { host: "", port: 70000 };
  const tcpResult = validateTerminalConfig(badTcp);
  assert.equal(tcpResult.ok, false);
  assert.equal(tcpResult.code, "invalid_configuration");
  assert.match(tcpResult.errors.join(" "), /adresse TCP/i);
  assert.match(tcpResult.errors.join(" "), /port TCP/i);

  const badSerial = terminal("nepting", "serial");
  badSerial.serial.path = "USB0";
  badSerial.serial.baudRate = 0;
  const serialResult = validateTerminalConfig(badSerial);
  assert.equal(serialResult.ok, false);
  assert.match(serialResult.errors.join(" "), /port COM/i);
  assert.match(serialResult.errors.join(" "), /vitesse/i);
});

test("accepts a minimal EUR payment expressed in integer cents", () => {
  const result = validatePaymentRequest({
    transactionId: "order-123-payment-1",
    terminalId: "counter-1",
    amount: 1590,
    currency: "EUR",
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      transactionId: "order-123-payment-1",
      terminalId: "counter-1",
      amount: 1590,
      currency: "EUR",
    },
  });
});

test("rejects non-EUR, non-integer, non-positive, and mutation payment fields", () => {
  for (const request of [
    { transactionId: "tx-1", terminalId: "t-1", amount: 1590, currency: "USD" },
    { transactionId: "tx-1", terminalId: "t-1", amount: 15.9, currency: "EUR" },
    { transactionId: "tx-1", terminalId: "t-1", amount: 0, currency: "EUR" },
    { transactionId: "tx-1", terminalId: "t-1", amount: 1590, currency: "EUR", host: "10.0.0.1" },
  ]) {
    const result = validatePaymentRequest(request);
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_payment_request");
  }
});

test("redacts secrets recursively without changing safe terminal fields", () => {
  const redacted = redactTerminalValue({
    terminalId: "counter-1",
    merchantId: "72503369065980",
    token: "secret-token",
    authorizationReference: "184117",
    nested: { rawFrame: "CZ0040320", receipt: "card receipt" },
  });

  assert.equal(redacted.terminalId, "counter-1");
  assert.equal(redacted.merchantId, "**********5980");
  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.authorizationReference, "[REDACTED]");
  assert.equal(redacted.nested.rawFrame, "[REDACTED]");
  assert.equal(redacted.nested.receipt, "[REDACTED]");
});
