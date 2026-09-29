const net = require("node:net");
const os = require("node:os");

function safeToken(value, fallback) {
  const token = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, "-");
  return token || fallback;
}

function writeSocket(socket, data) {
  return new Promise((resolve, reject) => {
    socket.write(data, (error) => (error ? reject(error) : resolve()));
  });
}

function createAcknowledgementReader(socket) {
  const queued = [];
  const waiters = [];
  let terminalError = null;
  const deliver = (code) => {
    const waiter = waiters.shift();
    if (!waiter) {
      queued.push(code);
      return;
    }
    if (code === 0) waiter.resolve();
    else waiter.reject(new Error(`Accuse LPR ${code ?? "manquant"}`));
  };
  const fail = (error) => {
    terminalError = error;
    while (waiters.length) waiters.shift().reject(error);
  };
  const onData = (data) => {
    for (const code of data || []) deliver(code);
  };
  const onError = (error) => fail(error);
  const onTimeout = () => fail(new Error("Delai LPR depasse"));
  socket.on("data", onData);
  socket.on("error", onError);
  socket.on("timeout", onTimeout);

  return {
    next() {
      if (queued.length) {
        const code = queued.shift();
        return code === 0
          ? Promise.resolve()
          : Promise.reject(new Error(`Accuse LPR ${code}`));
      }
      if (terminalError) return Promise.reject(terminalError);
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    dispose() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    },
  };
}

function connectSocket(socket, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
      socket.off("timeout", onTimeout);
    };
    const onConnect = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const onTimeout = () => { cleanup(); reject(new Error("Delai LPR depasse")); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.once("timeout", onTimeout);
    socket.connect(port, host);
  });
}

async function sendAndAcknowledge(socket, acknowledgements, data) {
  const acknowledgement = acknowledgements.next();
  await writeSocket(socket, data);
  await acknowledgement;
}

async function sendLpr(options, dependencies = {}) {
  const host = options.host;
  if (!host) throw new Error("Adresse LPR manquante");
  const port = Number(options.port) || 515;
  const queue = safeToken(options.queue || options.queueName, "lp");
  const timeoutMs = Number(options.timeoutMs) || 5000;
  const hostname = safeToken(dependencies.hostname || os.hostname(), "smarteat");
  const createSocket = dependencies.createSocket || (() => new net.Socket());
  const socket = createSocket();
  const acknowledgements = createAcknowledgementReader(socket);
  const data = Buffer.from(options.base64Data || "", "base64");
  const dataName = `dfA001${hostname}`;
  const controlName = `cfA001${hostname}`;
  const control = Buffer.from(
    `H${hostname}\nPSmartEat\nJSmartEat Ticket\nU${dataName}\nl${dataName}\n`,
    "ascii",
  );
  let success = false;

  try {
    await connectSocket(socket, host, port, timeoutMs);
    await sendAndAcknowledge(socket, acknowledgements, Buffer.from(`\x02${queue}\n`, "binary"));
    await sendAndAcknowledge(
      socket,
      acknowledgements,
      Buffer.from(`\x02${control.length} ${controlName}\n`, "binary"),
    );
    await sendAndAcknowledge(socket, acknowledgements, Buffer.concat([control, Buffer.from([0])]));
    await sendAndAcknowledge(
      socket,
      acknowledgements,
      Buffer.from(`\x03${data.length} ${dataName}\n`, "binary"),
    );
    await sendAndAcknowledge(socket, acknowledgements, Buffer.concat([data, Buffer.from([0])]));
    success = true;
    return { bytesWritten: data.length, queue };
  } finally {
    acknowledgements.dispose();
    if (success) socket.end?.();
    socket.destroy?.();
  }
}

function createLprSender(dependencies = {}) {
  return {
    send({ transport, base64Data }) {
      return sendLpr(
        { ...(transport?.config || {}), base64Data },
        dependencies,
      );
    },
  };
}

module.exports = {
  createLprSender,
  sendLpr,
};
