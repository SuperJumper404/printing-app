const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerServiceIpc, configureWindowLifecycle } = require('../../lib/desktop/serviceIpc');

test('reload and discovery wait for pending printer preferences before reading them', async () => {
  const ipc = new EventEmitter(); const handlers = new Map(); ipc.handle = (name, handler) => handlers.set(name, handler);
  const calls = []; let release; let saved = [{ hidden: true }];
  const controller = registerServiceIpc({ ipc, client: { request: async (action, payload) => {
    calls.push(action);
    if (action === 'save-printer-config') { await new Promise(resolve => { release = resolve; }); saved = payload; return { success: true }; }
    return saved;
  } } });
  const write = handlers.get('save-printer-config')({}, [{ hidden: false, collapsed: false }]);
  await new Promise(resolve => setImmediate(resolve));
  const read = handlers.get('get-saved-printers')({});
  const discovery = handlers.get('discover-printers')({});
  await new Promise(resolve => setImmediate(resolve));
  try { assert.deepEqual(calls, ['save-printer-config']); } finally { release(); }
  await write;
  await controller.waitForPrinterSaves();
  assert.deepEqual(await read, [{ hidden: false, collapsed: false }]);
  assert.deepEqual(await discovery, [{ hidden: false, collapsed: false }]);
});

test('an in-flight stale printer read is refreshed after a newer preference save', async () => {
  const ipc = new EventEmitter(); const handlers = new Map(); ipc.handle = (name, handler) => handlers.set(name, handler);
  let release; let reads = 0; let saved = [{ hidden: true, collapsed: true }];
  registerServiceIpc({ ipc, client: { request: async (action, payload) => {
    if (action === 'save-printer-config') { saved = payload; return { success: true }; }
    const snapshot = structuredClone(saved);
    if (++reads === 1) await new Promise(resolve => { release = resolve; });
    return snapshot;
  } } });
  const pendingRead = handlers.get('get-saved-printers')({});
  await new Promise(resolve => setImmediate(resolve));
  await handlers.get('save-printer-config')({}, [{ hidden: false, collapsed: false }]);
  release();
  assert.deepEqual(await pendingRead, [{ hidden: false, collapsed: false }]);
  assert.equal(reads, 2);
});

test('serializes preference writes to the service and keeps terminal result envelopes compatible', async () => {
  const ipc = new EventEmitter(); const handlers = new Map(); ipc.handle = (name, handler) => handlers.set(name, handler);
  let release; const persisted = [];
  const client = { request: async (action, payload) => {
    if (action === 'save-printer-config') { if (!persisted.length) await new Promise(resolve => { release = resolve; }); persisted.push(payload); return { success: true }; }
    if (action === 'terminals:list') return { ok: true, value: [{ id: 'terminal' }] };
  } };
  registerServiceIpc({ ipc, client });
  const first = handlers.get('save-printer-config')({}, [{ favorite: false }]);
  await new Promise(resolve => setImmediate(resolve));
  const second = handlers.get('save-printer-config')({}, [{ favorite: true }]);
  release(); await Promise.all([first, second]);
  assert.deepEqual(persisted, [[{ favorite: false }], [{ favorite: true }]]);
  assert.deepEqual(await handlers.get('terminals:list')({}), { ok: true, value: [{ id: 'terminal' }] });
});

test('closing the window hides the companion and only explicit application quit closes it', () => {
  const window = new EventEmitter(); let visible = true; let prevented = false; let quitting = false;
  window.hide = () => { visible = false; };
  configureWindowLifecycle(window, { isQuitting: () => quitting });
  window.emit('close', { preventDefault() { prevented = true; } });
  assert.equal(visible, false); assert.equal(prevented, true);
  quitting = true; prevented = false;
  window.emit('close', { preventDefault() { prevented = true; } }); assert.equal(prevented, false);
});
