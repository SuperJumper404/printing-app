const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { sendLpr } = require("../../lib/printers/transports/lpr");

function fakeSocket({ acknowledgement = () => 0, connect = true } = {}) {
  const socket = new EventEmitter();
  socket.writes = [];
  socket.destroyedByClient = false;
  socket.ended = false;
  socket.setTimeout = () => {};
  socket.connect = () => {
    if (connect) queueMicrotask(() => socket.emit("connect"));
    else queueMicrotask(() => socket.emit("timeout"));
  };
  socket.write = (data, callback) => {
    const buffer = Buffer.from(data);
    socket.writes.push(buffer);
    callback?.();
    const writeNumber = socket.writes.length;
    queueMicrotask(() => socket.emit("data", Buffer.from([acknowledgement(writeNumber)])));
  };
  socket.end = () => { socket.ended = true; };
  socket.destroy = () => { socket.destroyedByClient = true; };
  return socket;
}

test("sends RFC 1179 receive-job, control-file, and ESC/POS data-file commands", async () => {
  const socket = fakeSocket();
  await sendLpr(
    { host: "printer", queue: "receipts", base64Data: "AQID" },
    { createSocket: () => socket, hostname: "smarteat" },
  );

  assert.equal(socket.writes[0].toString(), "\x02receipts\n");
  assert.match(socket.writes[1].toString(), /^\x02\d+ cfA001smarteat\n$/);
  assert.match(socket.writes[2].toString(), /Hsmarteat\nPSmartEat\nJSmartEat Ticket\n/);
  assert.equal(socket.writes[2].at(-1), 0);
  assert.equal(socket.writes[3].toString(), "\x033 dfA001smarteat\n");
  assert.deepEqual(socket.writes[4], Buffer.from([1, 2, 3, 0]));
  assert.equal(socket.ended, true);
  assert.equal(socket.destroyedByClient, true);
});

test("rejects a non-zero LPR acknowledgement and cleans up", async () => {
  const socket = fakeSocket({ acknowledgement: (writeNumber) => (writeNumber === 2 ? 1 : 0) });
  await assert.rejects(
    sendLpr(
      { host: "printer", base64Data: "AQID" },
      { createSocket: () => socket },
    ),
    /accuse LPR 1/i,
  );
  assert.equal(socket.destroyedByClient, true);
  assert.equal(socket.writes.length, 2);
});

test("rejects on timeout and destroys the socket", async () => {
  const socket = fakeSocket({ connect: false });
  await assert.rejects(
    sendLpr(
      { host: "printer", base64Data: "AQID", timeoutMs: 25 },
      { createSocket: () => socket },
    ),
    /delai LPR/i,
  );
  assert.equal(socket.destroyedByClient, true);
});
