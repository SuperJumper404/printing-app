const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('preload exposes only authorized IPC and strips privileged event objects', async () => {
  const ipc = new EventEmitter(); ipc.invoke = async (action, value) => ({ action, value });
  ipc.send = () => {};
  let browserRequire;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../lib/desktop/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_, value) => { browserRequire = value; } }, ipcRenderer: ipc }),
  });
  assert.throws(() => browserRequire('fs'), /non autorisé/);
  const safe = browserRequire('electron').ipcRenderer;
  await assert.rejects(safe.invoke('read-control-token'), /non autorisée/);
  const result = await safe.invoke('get-saved-printers'); assert.equal(result.action, 'get-saved-printers');
  let event; let value;
  const listener = (receivedEvent, payload) => { event = receivedEvent; value = payload; };
  safe.on('service-status-updated', listener);
  ipc.emit('service-status-updated', { secret: 'privileged' }, { online: true });
  assert.equal(event, null); assert.equal(value.online, true);
  safe.removeListener('service-status-updated', listener); assert.equal(ipc.listenerCount('service-status-updated'), 0);
});
