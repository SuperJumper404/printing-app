const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchEscPosJob, testPrinterTransports, dispatchCashDrawerOpen, quarantinePrinterResources } = require('../../lib/printers/dispatch');

const job = { ticketType: 'caisse', dataFormatESCPOS: 'VEVTVAo=' };
function printer(id = 'counter', ids = ['windowsRaw', 'usbSerial']) {
  return { id, encoding: 'raw', ticketTypes: { caisse: true }, transports: Object.fromEntries(ids.map(id => [id, { enabled: true, config: {} }])) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('finishes one protocol before starting the next and still sends all enabled protocols', async () => {
  const events = []; let release;
  const senders = {
    windowsRaw: { send: () => { events.push('windows:start'); return new Promise(resolve => { release = () => { events.push('windows:end'); resolve(); }; }); } },
    usbSerial: { send: async () => events.push('serial') },
  };
  const pending = dispatchEscPosJob(job, [printer()], senders);
  await tick();
  assert.deepEqual(events, ['windows:start']);
  release();
  const result = await pending;
  assert.deepEqual(events, ['windows:start', 'windows:end', 'serial']);
  assert.equal(result.results.length, 2);
});

test('serializes jobs, tests and drawer commands for one printer', async () => {
  let active = 0; let maxActive = 0; let release;
  const p = printer('counter', ['windowsRaw']); let calls = 0;
  const senders = { windowsRaw: { send: async () => {
    active++; maxActive = Math.max(maxActive, active); calls++;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
    active--;
  } } };
  const a = dispatchEscPosJob(job, [p], senders);
  await tick();
  const b = testPrinterTransports(p, 'VEVTVAo=', senders);
  const c = dispatchCashDrawerOpen([p], senders);
  await tick();
  assert.equal(calls, 1);
  release(); await Promise.all([a, b, c]);
  assert.equal(calls, 3); assert.equal(maxActive, 1);
});

test('locks shared endpoints even when printer records have different IDs', async () => {
  let release; let count = 0;
  const senders = { usbSerial: { send: async () => { count++; if (count === 1) await new Promise(r => { release = r; }); } } };
  const a = printer('old', ['usbSerial']); a.transports.usbSerial.config.portName = 'COM7';
  const b = printer('new', ['usbSerial']); b.transports.usbSerial.config.portName = 'com7:';
  const first = dispatchEscPosJob(job, [a], senders); await tick();
  const second = dispatchEscPosJob(job, [b], senders); await tick();
  assert.equal(count, 1); release(); await Promise.all([first, second]); assert.equal(count, 2);
});

test('reconnects transient failures before transmission with bounded increasing waits', async () => {
  let count = 0; const waits = [];
  const result = await dispatchEscPosJob(job, [printer('counter', ['windowsRaw'])], {
    windowsRaw: { send: async () => { if (++count < 3) throw Object.assign(new Error('offline'), { code: 'CONNECTION_FAILED', retryable: true, deliveryState: 'not-sent' }); } },
  }, { delay: async ms => waits.push(ms) });
  assert.equal(result.success, true); assert.equal(count, 3);
  assert.deepEqual(waits, [500, 1500]); assert.equal(result.results[0].attemptCount, 3);
});

test('does not automatically replay an uncertain delivery and reports partial success', async () => {
  let count = 0;
  const result = await dispatchEscPosJob(job, [printer()], {
    windowsRaw: { send: async () => { count++; throw Object.assign(new Error('timeout'), { code: 'TIMEOUT', retryable: true, deliveryState: 'unknown' }); } },
    usbSerial: { send: async () => {} },
  });
  assert.equal(count, 1); assert.equal(result.partial, true); assert.equal(result.allSucceeded, false);
  assert.equal(result.status, 'partial'); assert.equal(result.results[0].deliveryState, 'unknown');
});

test('a malformed structured destination does not block a valid received destination', async () => {
  const bad = { ...printer('bad', ['windowsRaw']), ticketSource: 'ticketData' };
  const good = printer('good', ['usbSerial']); let printed = false;
  const result = await dispatchEscPosJob(job, [bad, good], {
    windowsRaw: { send: async () => assert.fail('invalid data must not reach transport') },
    usbSerial: { send: async () => { printed = true; } },
  });
  assert.equal(printed, true); assert.equal(result.partial, true);
});

test('quarantines every protocol of a physical printer until cancelled USB cleanup is acknowledged', async () => {
  let cleaned; let writes = 0; let usbCalls = 0;
  const cleanup = new Promise(resolve => { cleaned = resolve; });
  const p = printer('counter', ['usbSerial', 'usbRaw']);
  const senders = {
    usbSerial: { send: async () => { writes++; } },
    usbRaw: { send: async () => { usbCalls++; if (usbCalls === 1) throw Object.assign(new Error('timeout'), { code: 'TIMEOUT', deliveryState: 'unknown', cleanup }); } },
  };
  await dispatchEscPosJob(job, [p], senders);
  const blocked = await dispatchEscPosJob(job, [p], senders);
  assert.equal(writes, 1); assert.equal(usbCalls, 1);
  assert.ok(blocked.results.every(result => result.code === 'DEVICE_BUSY'));
  cleaned(); await tick();
  const resumed = await dispatchEscPosJob(job, [p], senders);
  assert.equal(resumed.allSucceeded, true); assert.equal(writes, 2);
});

test('service recovery can quarantine all protocols until an earlier companion write is cleaned up', async () => {
  let release; let count = 0;
  const cleanup = new Promise(resolve => { release = resolve; });
  const p = printer('counter', ['windowsRaw']);
  const senders = { windowsRaw: { send: async () => { count++; } } };
  quarantinePrinterResources(senders, p, cleanup);
  const blocked = await dispatchEscPosJob(job, [p], senders);
  assert.equal(count, 0); assert.equal(blocked.results[0].code, 'DEVICE_BUSY');
  assert.equal(blocked.results[0].retryable, true);
  release(); await tick();
  assert.equal((await dispatchEscPosJob(job, [p], senders)).allSucceeded, true); assert.equal(count, 1);
});

test('an absent session companion produces an explicit useful error', async () => {
  const p = printer('counter', ['usbRaw']);
  const result = await dispatchEscPosJob(job, [p], { usbRaw: { send: async () => { throw Object.assign(new Error('offline'), { code: 'COMPANION_OFFLINE', deliveryState: 'not-sent' }); } } });
  assert.match(result.error, /compagnon.*session Windows/i);
});
