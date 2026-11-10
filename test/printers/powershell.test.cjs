const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPowerShellRunner } = require('../../lib/printers/powershell');

test('preserves UTF-8 output and bounds PowerShell execution', async () => {
  let options; let script;
  const run = createPowerShellRunner({ execFile: (_, args, opts, callback) => {
    options = opts; script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const child = new EventEmitter(); queueMicrotask(() => { callback(null, 'Écriture réussie\n', ''); child.emit('close', 0); }); return child;
  } });
  assert.equal(await run('Write-Output "Écriture réussie"', {}, { timeoutMs: 1234 }), 'Écriture réussie');
  assert.equal(options.timeout, 1234); assert.match(script, /UTF8Encoding/);
});
test('does not expose command text and waits for subprocess close after cancellation', async () => {
  let callback; const child = new EventEmitter(); const controller = new AbortController();
  const run = createPowerShellRunner({ execFile: (_, args, opts, cb) => { callback = cb; return child; } });
  let settled = false;
  const result = run('sensitive command', {}, { signal: controller.signal }).catch(error => { settled = true; return error; });
  callback(Object.assign(new Error('Command failed: sensitive command'), { code: 'ABORT_ERR' }), '', 'SMARTEAT_NOT_SENT:CONNECTION_FAILED');
  await Promise.resolve(); assert.equal(settled, false); child.emit('close', 1);
  const error = await result; assert.doesNotMatch(error.message, /sensitive command/); assert.match(error.stderr, /SMARTEAT_NOT_SENT/);
});
