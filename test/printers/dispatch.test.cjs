const test = require("node:test");
const assert = require("node:assert/strict");

const {
  dispatchEscPosJob,
  testPrinterTransports,
} = require("../../lib/printers/dispatch");

function printer(id, enabledTransports, ticketTypes = { caisse: true }, encoding = "raw") {
  return {
    id,
    encoding,
    escPosCodePage: encoding === "windows-1252" ? 16 : null,
    ticketTypes,
    transports: Object.fromEntries(
      enabledTransports.map((transportId) => [
        transportId,
        { available: true, enabled: true, config: {} },
      ]),
    ),
  };
}

test("returns a clear failure when no transport is enabled", async () => {
  const result = await dispatchEscPosJob(
    { ticketType: "caisse", dataFormatESCPOS: "YWJj" },
    [printer("one", [])],
    {},
  );

  assert.equal(result.success, false);
  assert.equal(result.transportCount, 0);
  assert.match(result.error, /aucun transport actif/i);
});

test("sends identical base64 to two enabled transports", async () => {
  const calls = [];
  const senders = {
    windowsRaw: { send: async (input) => calls.push(input) },
    usbSerial: { send: async (input) => calls.push(input) },
  };
  const result = await dispatchEscPosJob(
    { ticketType: "caisse", dataFormatESCPOS: "AQID" },
    [printer("one", ["windowsRaw", "usbSerial"])],
    senders,
  );

  assert.equal(result.success, true);
  assert.equal(result.transportCount, 2);
  assert.deepEqual(calls.map((call) => call.base64Data), ["AQID", "AQID"]);
});

test("prepares the same ticket with each printer encoding", async () => {
  const calls = [];
  const senders = {
    windowsRaw: { send: async (input) => calls.push(input) },
  };
  const ticket = Buffer.from("3,00 \u20ac", "utf8").toString("base64");

  await dispatchEscPosJob(
    { ticketType: "caisse", dataFormatESCPOS: ticket },
    [
      printer("windows", ["windowsRaw"], { caisse: true }, "windows-1252"),
      printer("raw", ["windowsRaw"], { caisse: true }, "raw"),
    ],
    senders,
  );

  assert.deepEqual(
    Buffer.from(calls[0].base64Data, "base64"),
    Buffer.from([0x1b, 0x74, 0x10, 0x33, 0x2c, 0x30, 0x30, 0x20, 0x80]),
  );
  assert.equal(calls[1].base64Data, ticket);
});

test("a rejected sender does not prevent another selected sender", async () => {
  let successfulSenderRan = false;
  const result = await dispatchEscPosJob(
    { ticketType: "caisse", dataFormatESCPOS: "AQID" },
    [printer("one", ["windowsRaw", "network9100"])],
    {
      windowsRaw: { send: async () => { throw new Error("spooler down"); } },
      network9100: { send: async () => { successfulSenderRan = true; } },
    },
  );

  assert.equal(successfulSenderRan, true);
  assert.equal(result.success, true);
  assert.deepEqual(result.results.map((item) => item.success), [false, true]);
});

test("keeps deterministic printer and transport result order", async () => {
  const result = await dispatchEscPosJob(
    { ticketType: "caisse", dataFormatESCPOS: "AQID" },
    [
      printer("second", ["usbSerial", "windowsRaw"]),
      printer("first", ["network9100"]),
    ],
    {
      windowsRaw: { send: async () => {} },
      network9100: { send: async () => {} },
      usbSerial: { send: async () => {} },
    },
  );

  assert.deepEqual(
    result.results.map((item) => `${item.printerId}:${item.transportId}`),
    ["second:windowsRaw", "second:usbSerial", "first:network9100"],
  );
});

test("reports aggregate failure when every selected transport fails", async () => {
  const result = await dispatchEscPosJob(
    { ticketType: "caisse", dataFormatESCPOS: "AQID" },
    [printer("one", ["windowsRaw"])],
    { windowsRaw: { send: async () => { throw new Error("offline"); } } },
  );

  assert.equal(result.success, false);
  assert.match(result.error, /offline/);
});

test("tests every enabled transport without requiring a ticket type", async () => {
  const result = await testPrinterTransports(
    printer("one", ["usbRaw", "usbHid"], {}),
    "VEVTVA==",
    {
      usbRaw: { send: async () => {} },
      usbHid: { send: async () => {} },
    },
  );

  assert.equal(result.transportCount, 2);
  assert.equal(result.success, true);
});
