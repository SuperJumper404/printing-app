const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const manager = path.resolve(__dirname, '../../scripts/windows-service/manage.ps1');
const enabled = process.platform === 'win32' && process.env.SMARTEAT_RUN_PRIVILEGED_TESTS === '1';

for (const architecture of ['System32', 'SysWOW64']) {
  test(`${architecture} privileged data preparation imports once and preserves credentials across upgrades`, { skip: !enabled }, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'SmartEat privileged fixture '));
    t.after(async () => {
      assert.equal(path.dirname(path.resolve(root)).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
      assert.ok(path.basename(root).startsWith('SmartEat privileged fixture '));
      await fs.rm(root, { recursive: true, force: true });
    });
    const legacy = path.join(root, 'legacy settings.json');
    const dataDir = path.join(root, 'isolated ProgramData', 'SmartEat', 'PrinterAgent');
    const original = Buffer.from('{"printers":[],"synthetic":"été","userSession":{"token":"synthetic-test-token"}}\r\n');
    await fs.writeFile(legacy, original);
    const prepare = () => new Promise((resolve, reject) => execFile(path.join(process.env.WINDIR, architecture, 'WindowsPowerShell/v1.0/powershell.exe'), [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', manager, '-Action', 'PrepareData', '-LegacySettingsPath', legacy,
    ], { windowsHide: true, timeout: 30000, cwd: root, env: { ...process.env, ProgramData: path.join(root, 'isolated ProgramData') } }, (error, stdout, stderr) => {
      if (error) { error.message = `Data preparation failed: ${stderr}`; reject(error); } else resolve(stdout);
    }));
    await prepare();
    assert.deepEqual(await fs.readFile(path.join(dataDir, 'settings.json')), original);
    const secret = await fs.readFile(path.join(dataDir, 'control-token'), 'utf8');
    assert.match(secret, /^[a-f0-9]{64}$/i);
    const connection = JSON.parse(await fs.readFile(path.join(dataDir, 'connection.json'), 'utf8'));
    assert.equal(connection.token, secret);
    const companionSid = await fs.readFile(path.join(dataDir, 'authorized-companion.sid'), 'utf8');
    assert.match(companionSid, /^S-1-(?:5-21-|12-1-)/);
    await fs.mkdir(path.join(dataDir, 'logs', 'archive'));
    await fs.writeFile(path.join(dataDir, 'logs', 'archive', 'synthetic.log'), 'synthetic log');
    await fs.writeFile(legacy, 'changed legacy data');
    await prepare();
    assert.deepEqual(await fs.readFile(path.join(dataDir, 'settings.json')), original);
    assert.equal(await fs.readFile(path.join(dataDir, 'control-token'), 'utf8'), secret);
    assert.equal(await fs.readFile(path.join(dataDir, 'authorized-companion.sid'), 'utf8'), companionSid);
    const log = await fs.readFile(path.join(dataDir, 'logs', 'installer.log'), 'utf8');
    assert.equal((log.match(/Machine data prepared/g) || []).length, 2);
    assert.equal(log.includes(secret), false);
    assert.equal(log.includes('synthetic-test-token'), false);
  });
}
