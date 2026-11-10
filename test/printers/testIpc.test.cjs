const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerPrinterTestIpc } = require('../../lib/printers/testIpc');
const { migratePrinterConfigurations } = require('../../lib/printers/configMigration');
const { testPrinterTransports } = require('../../lib/printers/dispatch');

test('legacy and current test requests share protocol ordering and the same physical printer queue', async () => {
  const ipc = new EventEmitter(); const handlers = new Map(); ipc.handle = (name, run) => handlers.set(name, run);
  const calls = []; let release; let replied;
  const reply = new Promise(resolve => { replied = resolve; });
  let count = 0;
  registerPrinterTestIpc({ ipc, getPrinters: () => [{ id: 'one', ip: '192.0.2.1', protocols: { 9100: true, 80: true } }], migratePrinters: migratePrinterConfigurations, testPrinterTransports, buildPayload: () => 'VEVTVAo=', label: id => id,
    senders: { network9100: { send: async () => { calls.push('network'); if (++count === 1) await new Promise(resolve => { release = resolve; }); } }, eposHttp: { send: async () => calls.push('epos') } } });
  ipc.emit('test-printer', { reply: (channel, result) => replied({ channel, result }) }, { id: 'one' });
  await new Promise(resolve => setImmediate(resolve));
  const current = handlers.get('test-printer-protocols')({}, { id: 'one' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['network']);
  release(); const legacy = await reply; await current;
  assert.equal(legacy.channel, 'test-printer-response'); assert.equal(legacy.result.success, true);
  assert.deepEqual(calls, ['network', 'epos', 'network', 'epos']);
});
