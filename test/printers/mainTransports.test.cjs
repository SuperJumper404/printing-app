const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const ipp = require("ipp");

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
});

test("serial passes settings and original base64", async () => {
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
});

test("network 9100 writes decoded bytes and closes the socket", async () => {
  const socket = new EventEmitter();
  let written;
  let ended = false;
  socket.setTimeout = () => {};
  socket.connect = () => queueMicrotask(() => socket.emit("connect"));
  socket.write = (buffer, callback) => { written = buffer; callback(); };
  socket.end = () => { ended = true; queueMicrotask(() => { socket.emit("finish"); socket.emit("close", false); }); };
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
  let timeoutDelay;
  socket.setTimeout = (delay) => { if (delay) timeoutDelay = delay; };
  socket.connect = () => queueMicrotask(() => socket.emit("timeout"));
  socket.destroy = () => { destroyed = true; };
  const sender = createNetworkSender({ createSocket: () => socket });

  await assert.rejects(
    sender.send({ transport: { config: { host: "host", port: 9100 } }, base64Data: "AQID" }),
    /d.lai/i,
  );
  assert.equal(destroyed, true);
  assert.equal(timeoutDelay, 15000);
});

test("network 9100 uses the configured timeout when provided", async () => {
  const socket = new EventEmitter();
  let timeoutDelay;
  socket.setTimeout = (delay) => { if (delay) timeoutDelay = delay; };
  socket.connect = () => queueMicrotask(() => socket.emit("timeout"));
  socket.destroy = () => {};
  const sender = createNetworkSender({ createSocket: () => socket });

  await assert.rejects(
    sender.send({
      transport: { config: { host: "host", port: 9100, timeoutMs: 30000 } },
      base64Data: "AQID",
    }),
    /d.lai/i,
  );
  assert.equal(timeoutDelay, 30000);
});

test("IPP sends decoded ESC/POS bytes as application/octet-stream", async (t) => {
  let message;
  let bytes;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      bytes = Buffer.concat(chunks);
      message = ipp.parse(bytes);
      response.writeHead(200, { "Content-Type": "application/ipp" });
      response.end(ipp.serialize({ version: "2.0", id: message.id, statusCode: "successful-ok" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const sender = createIppSender();
  await sender.send({
    transport: { config: { host: "127.0.0.1", port: server.address().port, path: "/ipp/print" } },
    base64Data: "AQID",
  });

  assert.equal(message.operation, "Print-Job");
  assert.equal(message["operation-attributes-tag"]["document-format"], "application/octet-stream");
  assert.deepEqual(bytes.subarray(-3), Buffer.from([1, 2, 3]));
});

test("ePOS wraps hexadecimal payload bytes in a command element", async () => {
  let request;
  const sender = createEposHttpSender({
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => '<response success="true" code="" status="2" />' };
    },
  });
  await sender.send({
    transport: { config: { host: "printer", port: 80 } },
    base64Data: "AQID",
  });

  assert.match(request.options.body, /<command>010203<\/command>/);
  assert.match(request.options.body, /<s:Envelope[\s\S]*<s:Body>[\s\S]*<epos-print/);
  assert.equal(request.options.headers["Content-Type"], "text/xml; charset=utf-8");
});

test("ePOS puts structured XML into its SOAP body", async () => {
  let request;
  const sender = createEposHttpSender({
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, text: async () => '<response success="1" code="" status="2" />' };
    },
  });
  const xmlData = "<epos-print>structured</epos-print>";

  await sender.send({
    transport: { config: { host: "printer", port: 80 } },
    xmlData,
  });

  assert.ok(request.options.body.includes(`<s:Body>${xmlData}</s:Body>`));
  assert.doesNotMatch(request.options.body, /<command>/);
  assert.equal(request.options.headers["Content-Type"], "text/xml; charset=utf-8");
});
