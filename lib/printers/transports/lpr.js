const net = require("node:net");
const os = require("node:os");
const { createPrintError, wrapTransportError } = require("../errors");

function safeToken(value, fallback) {
  const token = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, "-");
  return token || fallback;
}

async function sendLpr(options, dependencies = {}) {
  if (options.signal?.aborted) throw createPrintError("ABORTED");
  if (!options.host) throw createPrintError("CONFIGURATION");
  const port = Number(options.port) || 515;
  const queue = safeToken(options.queue || options.queueName, "lp");
  const configuredTimeout = Number(options.timeoutMs ?? options.timeout);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 5000;
  const hostname = safeToken(dependencies.hostname || os.hostname(), "smarteat");
  const socket = (dependencies.createSocket || (() => new net.Socket()))();
  const data = Buffer.from(options.base64Data || "", "base64");
  const dataName = `dfA001${hostname}`;
  const controlName = `cfA001${hostname}`;
  const control = Buffer.from(`H${hostname}\nPSmartEat\nJSmartEat Ticket\nU${dataName}\nl${dataName}\n`, "ascii");
  const queued = [];
  let writing = false;
  let terminalError;
  let connectWaiter;
  let ackWaiter;
  let writeWaiter;
  let closed = false;
  let destroyed = false;
  const state = () => writing ? "unknown" : "not-sent";
  const failure = (code) => createPrintError(code, { deliveryState: state(), retryable: !writing && ["TIMEOUT", "CONNECTION_CLOSED"].includes(code) });
  const fail = (error) => {
    if (terminalError) return;
    terminalError = error;
    connectWaiter?.reject(error); ackWaiter?.reject(error); writeWaiter?.reject(error);
    if (!destroyed) { destroyed = true; socket.destroy(); }
  };
  const onError = (error) => fail(wrapTransportError(error, { deliveryState: state(), fallbackCode: "CONNECTION_FAILED" }));
  const onTimeout = () => fail(failure("TIMEOUT"));
  const onAbort = () => fail(failure("ABORTED"));
  const onClose = () => { closed = true; socket.off("error", onError); fail(failure("CONNECTION_CLOSED")); };
  const onConnect = () => { connectWaiter?.resolve(); connectWaiter = null; };
  const rejectAck = (code) => {
    const error = failure("PRINTER_REJECTED");
    error.printerCode = code;
    return error;
  };
  const onData = (bytes) => {
    for (const code of bytes) {
      if (ackWaiter) {
        const waiter = ackWaiter; ackWaiter = null;
        if (code === 0) waiter.resolve(); else waiter.reject(rejectAck(code));
      } else queued.push(code);
    }
  };
  const nextAck = () => {
    if (terminalError) return Promise.reject(terminalError);
    if (queued.length) {
      const code = queued.shift();
      return code === 0 ? Promise.resolve() : Promise.reject(rejectAck(code));
    }
    return new Promise((resolve, reject) => { ackWaiter = { resolve, reject }; });
  };
  const send = async (bytes) => {
    if (terminalError) throw terminalError;
    const acknowledgement = nextAck();
    const written = new Promise((resolve, reject) => {
      writeWaiter = { resolve, reject };
      writing = true;
      try {
        socket.write(bytes, (error) => {
          writeWaiter = null;
          if (error) { reject(wrapTransportError(error, { deliveryState: state(), fallbackCode: "WRITE_FAILED" })); return; }
          resolve();
        });
      } catch (error) { reject(wrapTransportError(error, { deliveryState: state(), fallbackCode: "WRITE_FAILED" })); }
    });
    await Promise.all([written, acknowledgement]);
  };
  socket.on("data", onData);
  socket.on("error", onError);
  socket.once("close", onClose);
  socket.once("timeout", onTimeout);
  socket.once("connect", onConnect);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const deadline = setTimeout(onTimeout, timeoutMs);
  try {
    socket.setTimeout(timeoutMs);
    await new Promise((resolve, reject) => {
      connectWaiter = { resolve, reject };
      try { socket.connect(port, options.host); } catch (error) { onError(error); }
    });
    await send(Buffer.from(`\x02${queue}\n`, "binary"));
    await send(Buffer.from(`\x02${control.length} ${controlName}\n`, "binary"));
    await send(Buffer.concat([control, Buffer.from([0])]));
    await send(Buffer.from(`\x03${data.length} ${dataName}\n`, "binary"));
    await send(Buffer.concat([data, Buffer.from([0])]));
    socket.end();
    return { bytesWritten: data.length, queue };
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", onAbort);
    if (!destroyed && !closed) { destroyed = true; socket.destroy(); }
    socket.setTimeout(0);
    socket.off("data", onData);
    if (closed) socket.off("error", onError);
    socket.off("timeout", onTimeout);
    socket.off("connect", onConnect);
  }
}

function createLprSender(dependencies = {}) {
  return {
    send({ transport, base64Data, signal }) {
      return sendLpr({ ...(transport?.config || {}), base64Data, signal }, dependencies);
    },
  };
}
module.exports = { createLprSender, sendLpr };
