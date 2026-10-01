const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createWindowsRawSender } = require("../../lib/printers/transports/windowsRaw");
const { createSerialSender } = require("../../lib/printers/transports/serial");
const { createNetworkSender } = require("../../lib/printers/transports/network");
const { createIppSender } = require("../../lib/printers/transports/ipp");
const { createEposHttpSender } = require("../../lib/printers/transports/eposHttp");

test("Windows RAW passes the prepared payload through PowerShell", async () => {
  let invocation;
  const sender = createWindowsRawSender({
    runPowerShell: async (script, env) => { invocation = { script, env }; },
  });
  const base64Data = Buffer.from("3,00 \u20ac\n", "utf8").toString("base64");
  await sender.send({
    transport: { config: { printerName: "Receipt Queue" } },
    base64Data,
  });

  assert.equal(invocation.env.SMARTEAT_PRINT_BASE64, base64Data);
  assert.equal(invocation.env.SMARTEAT_PRINTER_NAME, "Receipt Queue");
  assert.match(invocation.script, /WritePrinter/);
});

test("serial passes settings and original base64 and always disposes the port", async () => {
  let invocation;
  const sender = createSerialSender({
    runPowerShell: async (script, env) => { invocation = { script, env }; },
  });
  await sender.send({
    transport: {
      config: { portName: "COM4:", baudRate: 19200, dataBits: 7, parity: "Even", stopBits: 2 },
    },
    base64Data: "BAUG",
  });

  assert.equal(invocation.env.SMARTEAT_PRINT_BASE64, "BAUG");
  assert.equal(invocation.env.SMARTEAT_COM_PORT, "COM4");
  assert.equal(invocation.env.SMARTEAT_BAUD_RATE, "19200");
  assert.match(invocation.script, /finally[\s\S]*Dispose/);
  assert.match(invocation.script, /WriteTimeout = 5000/);
});

test("network 9100 writes decoded bytes and closes the socket", async () => {
  const socket = new EventEmitter();
  let written;
  let ended = false;
  socket.setTimeout = () => {};
  socket.connect = () => queueMicrotask(() => socket.emit("connect"));
  socket.write = (buffer, callback) => { written = buffer; callback(); };
  socket.end = () => { ended = true; };
  socket.destroy = () => {};
  const sender = createNetworkSender({ createSocket: () => socket });

  await sender.send({
    transport: { config: { host: "192.168.1.2", port: 9100 } },
    base64Data: "AQID",
  });

  assert.deepEqual(written, Buffer.from([1, 2, 3]));
  assert.equal(ended, true);
});

test("network timeout rejects and destroys the socket", async () => {
  const socket = new EventEmitter();
  let destroyed = false;
  socket.setTimeout = () => {};
  socket.connect = () => queueMicrotask(() => socket.emit("timeout"));
  socket.destroy = () => { destroyed = true; };
  const sender = createNetworkSender({ createSocket: () => socket });

  await assert.rejects(
    sender.send({ transport: { config: { host: "host", port: 9100 } }, base64Data: "AQID" }),
    /delai/i,
  );
  assert.equal(destroyed, true);
});

test("IPP sends decoded ESC/POS bytes as application/octet-stream", async () => {
  let message;
  const sender = createIppSender({
    createPrinter: () => ({
      execute(operation, input, callback) {
        message = { operation, input };
        callback(null, { statusCode: "successful-ok" });
      },
    }),
  });
  await sender.send({
    transport: { config: { host: "printer", port: 631, path: "/ipp/print" } },
    base64Data: "AQID",
  });

  assert.equal(message.operation, "Print-Job");
  assert.equal(message.input["operation-attributes-tag"]["document-format"], "application/octet-stream");
  assert.deepEqual(message.input.data, Buffer.from([1, 2, 3]));
});

test("ePOS wraps hexadecimal payload bytes in a command element", async () => {
  let request;
  const sender = createEposHttpSender({
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  await sender.send({
    transport: { config: { host: "printer", port: 80 } },
    base64Data: "AQID",
  });

  assert.match(request.options.body, /<command>010203<\/command>/);
  assert.equal(request.options.headers["Content-Type"], "text/xml");
});

test("ePOS sends structured XML body directly", async () => {
  let request;
  const sender = createEposHttpSender({
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  const xmlData = "<epos-print>structured</epos-print>";

  await sender.send({
    transport: { config: { host: "printer", port: 80 } },
    xmlData,
  });

  assert.equal(request.options.body, xmlData);
  assert.doesNotMatch(request.options.body, /<command>/);
  assert.equal(request.options.headers["Content-Type"], "text/xml");
});
