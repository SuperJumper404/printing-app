const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const ipp = require("ipp");
const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fetch = require("node-fetch");
const { createSerialSender } = require("../../lib/printers/transports/serial");
const { createWindowsRawSender } = require("../../lib/printers/transports/windowsRaw");
const { createNetworkSender } = require("../../lib/printers/transports/network");
const { createIppSender } = require("../../lib/printers/transports/ipp");
const { createEposHttpSender } = require("../../lib/printers/transports/eposHttp");
const { sendLpr } = require("../../lib/printers/transports/lpr");

const payload = "AP8bw6k=";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function socketDouble() {
  const socket = new EventEmitter();
  socket.setTimeout = () => {};
  socket.connect = () => queueMicrotask(() => socket.emit("connect"));
  socket.write = (_data, callback) => { callback?.(); return true; };
  socket.end = () => {};
  socket.destroy = () => {
    if (socket.destroyed) return;
    socket.destroyed = true;
    queueMicrotask(() => socket.emit("close", false));
  };
  return socket;
}
const classified = (code, state, retryable) => (error) => {
  assert.equal(error.code, code);
  assert.equal(error.deliveryState, state);
  assert.equal(error.retryable, retryable);
  assert.equal(typeof error.action, "string");
  return true;
};

test("serial rejects USB, WSD and network ports before starting PowerShell", async () => {
  let executions = 0;
  const sender = createSerialSender({ runPowerShell: async () => { executions++; } });
  for (const portName of ["USB001", "WSD-123", "192.168.1.2", "COM4-extra", ""]) {
    await assert.rejects(sender.send({ transport: { config: { portName } }, base64Data: payload }), classified("CONFIGURATION", "not-sent", false));
  }
  assert.equal(executions, 0);
});

test("serial normalizes COM and gives PowerShell a finite deadline and cancellation signal", async () => {
  let invocation;
  const controller = new AbortController();
  const sender = createSerialSender({ runPowerShell: async (_script, env, options) => { invocation = { env, options }; } });
  await sender.send({ transport: { config: { portName: "com19:" } }, base64Data: payload, signal: controller.signal });
  assert.equal(invocation.env.SMARTEAT_COM_PORT, "COM19");
  assert.equal(invocation.env.SMARTEAT_PRINT_BASE64, payload);
  assert.ok(invocation.options.timeoutMs > 0 && invocation.options.timeoutMs <= 30000);
  assert.equal(invocation.options.signal, controller.signal);
});

test("PowerShell failures distinguish no bytes sent from potentially transmitted bytes", async () => {
  for (const [marker, state, retryable] of [["SMARTEAT_NOT_SENT:CONNECTION_FAILED", "not-sent", true], ["SMARTEAT_UNKNOWN:WRITE_FAILED", "unknown", false]]) {
    const sender = createSerialSender({ runPowerShell: async () => { const error = new Error("Command failed: powershell.exe secret"); error.stderr = marker; throw error; } });
    await assert.rejects(sender.send({ transport: { config: { portName: "COM4" } }, base64Data: payload }), classified(marker.split(":")[1], state, retryable));
  }
});

test("RAW Windows preserves binary bytes and applies a process deadline", async () => {
  let invocation;
  const sender = createWindowsRawSender({ runPowerShell: async (_script, env, options) => { invocation = { env, options }; } });
  await sender.send({ transport: { config: { printerName: "Queue" } }, base64Data: payload });
  assert.equal(invocation.env.SMARTEAT_PRINT_BASE64, payload);
  assert.ok(invocation.options.timeoutMs > 0 && invocation.options.timeoutMs <= 30000);
});

test("invalid process timeout settings still result in a finite deadline", async () => {
  for (const factory of [createWindowsRawSender, createSerialSender]) {
    let timeoutMs;
    const sender = factory({ runPowerShell: async (_script, _env, options) => { timeoutMs = options.timeoutMs; } });
    await sender.send({ transport: { config: { printerName: "Queue", portName: "COM4", timeoutMs: "Infinity" } }, base64Data: payload });
    assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0);
  }
});

test("pre-cancelled transport operations never start a resource", async () => {
  const controller = new AbortController(); controller.abort();
  let starts = 0;
  for (const sender of [
    createNetworkSender({ createSocket: () => { starts++; return socketDouble(); } }),
    createSerialSender({ runPowerShell: async () => { starts++; } }),
    createWindowsRawSender({ runPowerShell: async () => { starts++; } }),
    createEposHttpSender({ fetch: async () => { starts++; } }),
  ]) {
    await assert.rejects(sender.send({ transport: { config: { host: "printer", portName: "COM4", printerName: "Queue" } }, base64Data: payload, signal: controller.signal }), classified("ABORTED", "not-sent", false));
  }
  assert.equal(starts, 0);
});

test("TCP waits for close after finish and rejects a later socket error without replay", async () => {
  const socket = socketDouble();
  let settled = false;
  const pending = createNetworkSender({ createSocket: () => socket }).send({ transport: { config: { host: "printer" } }, base64Data: payload });
  pending.then(() => { settled = true; }, () => { settled = true; });
  await delay(5);
  assert.equal(settled, false);
  socket.emit("finish");
  socket.emit("error", Object.assign(new Error("reset"), { code: "ECONNRESET" }));
  await assert.rejects(pending, classified("CONNECTION_FAILED", "unknown", false));
  assert.equal(socket.destroyed, true);
});

test("TCP premature close and stalled writes terminate and destroy their socket", async () => {
  const socket = socketDouble();
  socket.write = () => false;
  const pending = createNetworkSender({ createSocket: () => socket }).send({ transport: { config: { host: "printer", timeoutMs: 25 } }, base64Data: payload });
  await assert.rejects(pending, classified("TIMEOUT", "unknown", false));
  assert.equal(socket.destroyed, true);
  assert.equal(socket.listenerCount("connect"), 0);
  const early = socketDouble();
  early.connect = () => queueMicrotask(() => early.emit("close", false));
  await assert.rejects(createNetworkSender({ createSocket: () => early }).send({ transport: { config: { host: "printer" } }, base64Data: payload }), classified("CONNECTION_CLOSED", "not-sent", true));
});

test("TCP abort after writing closes socket and remains uncertain", async () => {
  const socket = socketDouble();
  const controller = new AbortController();
  const pending = createNetworkSender({ createSocket: () => socket }).send({ transport: { config: { host: "printer" } }, base64Data: payload, signal: controller.signal });
  await delay(5); controller.abort();
  await assert.rejects(pending, classified("ABORTED", "unknown", false));
  assert.equal(socket.destroyed, true);
});

test("TCP and LPR keep handling errors until a destroyed socket has actually closed", async () => {
  for (const protocol of ["tcp", "lpr"]) {
    const socket = socketDouble();
    const controller = new AbortController();
    socket.destroy = () => {
      socket.destroyed = true;
      queueMicrotask(() => { socket.emit("error", new Error("late write failure")); socket.emit("close", true); });
    };
    const pending = protocol === "tcp"
      ? createNetworkSender({ createSocket: () => socket }).send({ transport: { config: { host: "printer" } }, base64Data: payload, signal: controller.signal })
      : sendLpr({ host: "printer", base64Data: payload, signal: controller.signal }, { createSocket: () => socket });
    await delay(5); controller.abort();
    await assert.rejects(pending, classified("ABORTED", "unknown", false));
    await delay(5);
    assert.equal(socket.listenerCount("error"), 0);
  }
});

function executePowerShell(script, env, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, ...env }, windowsHide: true, timeout: timeoutMs,
  }, (error, stdout, stderr) => {
    if (error) { error.stderr = stderr; reject(error); } else resolve(stdout);
  }));
}

test("Windows RAW compiles its native signatures and rejects a nonexistent queue before transmission", { skip: process.platform !== "win32" }, async () => {
  const sender = createWindowsRawSender({ runPowerShell: executePowerShell });
  await assert.rejects(sender.send({ transport: { config: { printerName: `SmartEat-test-nonexistent-${randomUUID()}` } }, base64Data: payload }), (error) => {
    classified("CONFIGURATION", "not-sent", false)(error);
    assert.match(error.cause.stderr, /OpenPrinter/);
    assert.match(error.cause.stderr, /Win32 1801/);
    return true;
  });
});

test("serial Open failure terminates PowerShell before any write", { skip: process.platform !== "win32" }, async () => {
  const sender = createSerialSender({ runPowerShell: executePowerShell });
  await assert.rejects(sender.send({ transport: { config: { portName: "COM2147483647" } }, base64Data: payload }), (error) => {
    assert.equal(error.deliveryState, "not-sent");
    assert.match(error.cause.stderr, /SMARTEAT_NOT_SENT:/);
    return true;
  });
});

async function ippServer(t, handle) {
  const sockets = new Set();
  const server = http.createServer(handle);
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  return { config: { host: "127.0.0.1", port: server.address().port, timeoutMs: 40 } };
}

test("IPP cancels the actual HTTP request when a printer never responds", async (t) => {
  let connectionClosed;
  const closed = new Promise((resolve) => { connectionClosed = resolve; });
  const transport = await ippServer(t, (request) => { request.socket.on("close", connectionClosed); request.resume(); });
  await assert.rejects(createIppSender().send({ transport, base64Data: payload }), classified("TIMEOUT", "unknown", false));
  await Promise.race([closed, delay(300).then(() => assert.fail("IPP request was left open"))]);
});

test("IPP and ePOS cancellation terminate their actual HTTP connections", async (t) => {
  for (const sender of [createIppSender(), createEposHttpSender({ fetch })]) {
    let connected;
    const received = new Promise((resolve) => { connected = resolve; });
    let connectionClosed;
    const closed = new Promise((resolve) => { connectionClosed = resolve; });
    const transport = await ippServer(t, (request) => { request.resume(); request.socket.on("close", connectionClosed); connected(); });
    transport.config.timeoutMs = 1000;
    const controller = new AbortController();
    const pending = sender.send({ transport, base64Data: payload, signal: controller.signal });
    await received;
    controller.abort();
    await assert.rejects(pending, classified("ABORTED", "unknown", false));
    await Promise.race([closed, delay(300).then(() => assert.fail("HTTP connection was left open"))]);
  }
});

test("connection refusal is retryable before transmitting on TCP, IPP and ePOS", async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const net = require("node:net");
  for (const sender of [createNetworkSender({ createSocket: () => new net.Socket() }), createIppSender(), createEposHttpSender({ fetch })]) {
    await assert.rejects(sender.send({ transport: { config: { host: "127.0.0.1", port, timeoutMs: 1000 } }, base64Data: payload }), classified("CONNECTION_FAILED", "not-sent", true));
  }
});

test("IPP rejects malformed, truncated, error-status and mismatched request-id responses", async (t) => {
  for (const mode of ["malformed", "missing-end", "error", "mismatch"]) {
    const transport = await ippServer(t, (request, response) => {
      const chunks = []; request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const id = Buffer.concat(chunks).readUInt32BE(4);
        response.writeHead(200, { "Content-Type": "application/ipp" });
        const bytes = ipp.serialize({ version: "2.0", id: mode === "mismatch" ? id + 1 : id, statusCode: mode === "error" ? "client-error-not-possible" : "successful-ok" });
        response.end(mode === "malformed" ? Buffer.from("bad") : mode === "missing-end" ? Buffer.concat([bytes.subarray(0, 8), Buffer.from([1])]) : bytes);
      });
    });
    await assert.rejects(createIppSender().send({ transport, base64Data: payload }), classified(mode === "error" ? "PRINTER_REJECTED" : "INVALID_RESPONSE", "unknown", false));
  }
});

test("ePOS interprets printer rejection even with HTTP 200", async () => {
  const sender = createEposHttpSender({ fetch: async () => ({ ok: true, status: 200, text: async () => '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="false" code="EPTR_COVER_OPEN" status="8" /></s:Body></s:Envelope>' }) });
  await assert.rejects(sender.send({ transport: { config: { host: "printer" } }, base64Data: payload }), (error) => {
    classified("PRINTER_REJECTED", "unknown", false)(error);
    assert.equal(error.printerCode, "EPTR_COVER_OPEN");
    assert.equal(error.printerStatus, 8);
    return true;
  });
});

test("ePOS enforces deadline during the response body and aborts fetch", async () => {
  let signal;
  const sender = createEposHttpSender({ fetch: async (_url, options) => {
    signal = options.signal;
    return { ok: true, status: 200, text: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) };
  } });
  await assert.rejects(sender.send({ transport: { config: { host: "printer", timeoutMs: 25 } }, base64Data: payload }), classified("TIMEOUT", "unknown", false));
  assert.equal(signal.aborted, true);
});

test("ePOS missing response status is never treated as print success", async () => {
  const sender = createEposHttpSender({ fetch: async () => ({ ok: true, status: 200, text: async () => "<html>login</html>" }) });
  await assert.rejects(sender.send({ transport: { config: { host: "printer" } }, base64Data: payload }), classified("INVALID_RESPONSE", "unknown", false));
});

test("ePOS rejects truncated SOAP, commented results, and multiple response documents", async () => {
  for (const xml of [
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response success="true" code="" status="2" />',
    '<html><!-- <response success="true" code="" status="2" /> --></html>',
    '<response success="true" code="" status="2" /><unexpected />',
  ]) {
    const sender = createEposHttpSender({ fetch: async () => ({ ok: true, status: 200, text: async () => xml }) });
    await assert.rejects(sender.send({ transport: { config: { host: "printer" } }, base64Data: payload }), classified("INVALID_RESPONSE", "unknown", false));
  }
});

test("LPR rejects a premature peer close instead of hanging for an acknowledgement", async () => {
  const socket = socketDouble();
  socket.write = (_data, callback) => { callback(); queueMicrotask(() => socket.emit("close", false)); return true; };
  await assert.rejects(sendLpr({ host: "printer", base64Data: payload, timeoutMs: 25 }, { createSocket: () => socket }), classified("CONNECTION_CLOSED", "unknown", false));
  assert.equal(socket.destroyed, true);
});

test("LPR abort while waiting for acknowledgement cleans all resource listeners", async () => {
  const controller = new AbortController();
  const socket = socketDouble();
  const pending = sendLpr({ host: "printer", base64Data: payload, signal: controller.signal, timeoutMs: 25 }, { createSocket: () => socket });
  await delay(5); controller.abort();
  await assert.rejects(pending, classified("ABORTED", "unknown", false));
  assert.equal(socket.destroyed, true);
  assert.equal(socket.listenerCount("data"), 0);
  assert.equal(socket.listenerCount("close"), 0);
});

test("print error formatter keeps PowerShell commands and tokens out of visible messages", () => {
  const { createPrintError, formatPrintError } = require("../../lib/printers/errors");
  const raw = new Error("Command failed: powershell.exe SECRET_TOKEN=xyz");
  assert.doesNotMatch(formatPrintError(raw), /powershell|TOKEN|xyz/);
  const error = createPrintError("TIMEOUT", { deliveryState: "unknown", cause: raw });
  assert.match(formatPrintError(error), /délai/i);
  assert.equal(error.cause, raw);
  assert.equal(error.retryable, false);
});

test("device error codes produce useful French messages and action instructions", () => {
  const { createPrintError, formatPrintError } = require("../../lib/printers/errors");
  for (const [code, fragment] of [["AMBIGUOUS_DEVICE", "plusieurs"], ["PERMISSION_DENIED", "autorisation"], ["PARTIAL_WRITE", "partiel"], ["DEVICE_BUSY", "occup"], ["CLEANUP_FAILED", "libér"], ["UNSUPPORTED", "compatible"]]) {
    const error = createPrintError(code);
    assert.match(formatPrintError(error).toLowerCase(), new RegExp(fragment));
    assert.doesNotMatch(error.action, /permission|select-device|reconnect|check-connection/);
  }
});
