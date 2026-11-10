const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSupervisor } = require('../../service/supervisor');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function harness(options = {}) {
  const children = [];
  const kills = [];
  const supervisor = createSupervisor({
    workerPath: 'C:\\Program Files\\SmartEat\\resources\\service\\agent.cjs',
    execPath: 'C:\\Program Files\\SmartEat\\resources\\service\\node.exe',
    heartbeatTimeoutMs: 40, startupTimeoutMs: 60, checkIntervalMs: 5,
    gracefulStopMs: 15, restartDelayMs: 5,
    fork: (entry, args, config) => {
      const child = new EventEmitter();
      child.pid = 100 + children.length;
      child.connected = true;
      child.messages = [];
      child.send = (message) => child.messages.push(message);
      children.push({ entry, args, config, child });
      return child;
    },
    killTree: async (child) => { kills.push(child.pid); },
    ...options,
  });
  return { supervisor, children, kills };
}

test('supervisor starts one hidden standalone worker and restarts only after it exits', async () => {
  const { supervisor, children } = harness();
  supervisor.start(); supervisor.start();
  assert.equal(children.length, 1);
  assert.equal(children[0].config.windowsHide, true);
  assert.match(children[0].config.execPath, /\\node\.exe$/);
  children[0].child.emit('message', { type: 'ready' });
  children[0].child.emit('exit', 1, null);
  await pause(12);
  assert.equal(children.length, 2);
  const stopping = supervisor.stop();
  assert.deepEqual(children[1].child.messages, [{ type: 'stop' }]);
  children[1].child.emit('exit', 0, null);
  await stopping;
  await pause(12);
  assert.equal(children.length, 2);
});

test('missed worker heartbeats trigger graceful stop then force termination before restart', async () => {
  const { supervisor, children, kills } = harness();
  supervisor.start();
  children[0].child.emit('message', { type: 'ready' });
  await pause(90);
  assert.deepEqual(children[0].child.messages, [{ type: 'stop' }]);
  assert.deepEqual(kills, [100]);
  assert.equal(children.length, 1, 'no replacement while the old worker may still own a printer');
  children[0].child.emit('exit', 1, null);
  await pause(12);
  assert.equal(children.length, 2);
  const stopping = supervisor.stop(); children[1].child.emit('exit', 0, null); await stopping;
});

test('healthy heartbeats prevent unnecessary worker replacement', async () => {
  const { supervisor, children, kills } = harness();
  supervisor.start();
  const pulse = setInterval(() => children[0].child.emit('message', { type: 'heartbeat' }), 10);
  await pause(100); clearInterval(pulse);
  assert.equal(children.length, 1);
  assert.equal(kills.length, 0);
  const stopping = supervisor.stop(); children[0].child.emit('exit', 0, null); await stopping;
});

test('worker startup hangs and spawn errors are bounded without duplicate restarts', async () => {
  const { supervisor, children, kills } = harness({ startupTimeoutMs: 20 });
  supervisor.start();
  await pause(55);
  assert.deepEqual(kills, [100]);
  children[0].child.emit('error', new Error('spawn failed'));
  children[0].child.emit('close', 1, null);
  await pause(12);
  assert.equal(children.length, 2);
  const stopping = supervisor.stop(); children[1].child.emit('exit', 0, null); await stopping;
});
