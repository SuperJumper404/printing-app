const test = require("node:test");
const assert = require("node:assert/strict");

const {
  dispatchCashDrawerOpen,
  dispatchEscPosJob,
  testPrinterTransports,
} = require("../../lib/printers/dispatch");

function printer(
  id,
  enabledTransports,
  ticketTypes = { caisse: true },
  encoding = "raw",
  ticketSource = "received",
) {
  return {
    id,
    encoding,
    ticketSource,
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

function jobWithTicketData() {
  return {
    ticketType: "caisse",
    dataFormatESCPOS: Buffer.from("RECEIVED TICKET\n", "utf8").toString("base64"),
    ticketData: {
      schemaVersion: 1,
      kind: "cashier_receipt",
      business: {
        shop: {
          name: "Structured Shop",
          phone: "0102030405",
          address: "1 rue du Test",
          siret: "123",
          naf: "5610A",
          vatNumber: "FR00123",
        },
      },
      render: {
        paperWidth: 32,
        sections: [
          {
            id: "main",
            lines: [
              { type: "text", text: "Structured Shop", align: "center", bold: true },
              { type: "separator" },
              {
                type: "columns",
                columns: [
                  { key: "qty", text: "1x", width: 4 },
                  { key: "name", text: "Burger", width: 20 },
                  { key: "total", text: "12,00 EUR", width: 8, align: "right" },
                ],
                fallbackText: "1x   Burger              12,00 EUR",
              },
              { type: "text", text: "TOTAL : 12,00 EUR", align: "right", bold: true },
              { type: "cut" },
            ],
          },
        ],
      },
    },
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

test("opens cash drawer with ESC POS pulse on caisse printers", async () => {
  const calls = [];
  const senders = {
    windowsRaw: { send: async (input) => calls.push(input) },
  };
  const result = await dispatchCashDrawerOpen(
    [
      printer("counter", ["windowsRaw"], { caisse: true }, "raw", "ticketData"),
      printer("kitchen", ["windowsRaw"], { cuisine: true }, "raw", "received"),
    ],
    senders,
  );

  assert.equal(result.success, true);
  assert.equal(result.transportCount, 1);
  assert.equal(calls[0].base64Data, "G3AAGfo=");
  assert.equal(Buffer.from(calls[0].base64Data, "base64").toString("hex"), "1b700019fa");
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

test("tests transports with received payload even when printer source is ticketData", async () => {
  const calls = [];
  const result = await testPrinterTransports(
    printer("structured", ["windowsRaw"], {}, "raw", "ticketData"),
    "VEVTVA==",
    { windowsRaw: { send: async (input) => calls.push(input) } },
  );

  assert.equal(result.success, true);
  assert.equal(calls[0].base64Data, "VEVTVA==");
});

test("received source keeps using provided ESC POS", async () => {
  const calls = [];
  const job = jobWithTicketData();

  await dispatchEscPosJob(
    job,
    [printer("received", ["windowsRaw"], { caisse: true }, "raw", "received")],
    { windowsRaw: { send: async (input) => calls.push(input) } },
  );

  assert.equal(calls[0].base64Data, job.dataFormatESCPOS);
});

test("ticketData source reconstructs payload per printer", async () => {
  const calls = [];
  const job = jobWithTicketData();

  await dispatchEscPosJob(
    job,
    [printer("structured", ["windowsRaw"], { caisse: true }, "raw", "ticketData")],
    { windowsRaw: { send: async (input) => calls.push(input) } },
  );

  assert.notEqual(calls[0].base64Data, job.dataFormatESCPOS);
  assert.ok(calls[0].base64Data);
});

test("ticketData ePOS sends xmlData", async () => {
  const calls = [];

  await dispatchEscPosJob(
    jobWithTicketData(),
    [printer("epos", ["eposHttp"], { caisse: true }, "raw", "ticketData")],
    { eposHttp: { send: async (input) => calls.push(input) } },
  );

  assert.match(calls[0].xmlData, /<epos-print/);
});

test("ticketData source rejects missing structured data", async () => {
  const result = await dispatchEscPosJob(
    { ticketType: "caisse", dataFormatESCPOS: "AQID" },
    [printer("bad", ["windowsRaw"], { caisse: true }, "raw", "ticketData")],
    { windowsRaw: { send: async () => { throw new Error("must not print"); } } },
  );

  assert.equal(result.success, false);
  assert.match(result.error, /ticketData/i);
});
