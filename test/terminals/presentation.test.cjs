const test = require("node:test");
const assert = require("node:assert/strict");

const {
  newTerminalDraft,
  visibleTerminalFields,
  terminalStatusPresentation,
} = require("../../src/terminals/presentation.mjs");

test("creates a PAX Q25 draft with practical local defaults", () => {
  assert.deepEqual(newTerminalDraft(), {
    id: "",
    name: "PAX Q25",
    manufacturer: "PAX",
    model: "Q25",
    enabled: true,
    protocol: "nepting",
    protocolVersion: "0320",
    transport: "tcp",
    cashRegisterId: "000000000001",
    cashRegisterNumber: "01",
    tcp: { host: "", port: 8888 },
    serial: {
      path: "",
      baudRate: 115200,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flowControl: "none",
    },
    nepting: { merchantId: "" },
  });
});

test("shows exactly one transport group and Nepting fields only for Nepting", () => {
  assert.deepEqual(
    visibleTerminalFields({ transport: "tcp", protocol: "nepting" }),
    { transport: "tcp", showTcp: true, showSerial: false, showNepting: true },
  );
  assert.deepEqual(
    visibleTerminalFields({ transport: "serial", protocol: "caisse-ap" }),
    { transport: "serial", showTcp: false, showSerial: true, showNepting: false },
  );
});

test("provides French presentation for every normalized payment state", () => {
  const states = [
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
  ];

  for (const state of states) {
    const presentation = terminalStatusPresentation(state);
    assert.equal(typeof presentation.label, "string");
    assert.ok(presentation.label.length > 0, state);
    assert.match(presentation.tone, /^(neutral|progress|success|danger|warning)$/);
  }
});

test("does not present an open but unverified port as a success", () => {
  assert.deepEqual(terminalStatusPresentation("connected"), {
    label: "Connexion non verifiee",
    tone: "neutral",
    terminal: false,
  });
});
