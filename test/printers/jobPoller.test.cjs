const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobPoller } = require('../../lib/printers/jobPoller');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('polls without any mounted view and reads the current session every time', async () => {
  let session = { shopid: 'one' }; const printed = []; let next;
  const poller = createJobPoller({ getSession: () => session, fetchJobs: async s => [{ id: s.shopid }], printJob: async job => printed.push(job.id), setTimer: callback => { next = callback; return 1; }, clearTimer() {} });
  poller.start(); await tick(); assert.deepEqual(printed, ['one']);
  session = { shopid: 'two' }; next(); await tick(); assert.deepEqual(printed, ['one', 'two']); poller.stop();
});
test('does not overlap a slow fetch and cancels it on stop', async () => {
  let count = 0; let signal; let release; const printed = [];
  const poller = createJobPoller({ getSession: () => ({ shopid: 'one' }), fetchJobs: async (_, options) => { count++; signal = options.signal; return new Promise(resolve => { release = resolve; }); }, printJob: async job => printed.push(job) });
  poller.start(); await tick(); poller.wake(); await tick(); assert.equal(count, 1);
  poller.stop(); assert.equal(signal.aborted, true); release([{ id: 'old' }]); await tick(); assert.deepEqual(printed, []);
});
test('does not print results belonging to a session that logged out', async () => {
  let session = { shopid: 'one' }; let release; let printed = false;
  const poller = createJobPoller({ getSession: () => session, fetchJobs: () => new Promise(resolve => { release = resolve; }), printJob: async () => { printed = true; }, setTimer: () => 1, clearTimer() {} });
  poller.start(); await tick(); session = null; release([{ id: 'old' }]); await tick(); assert.equal(printed, false); poller.stop();
});
