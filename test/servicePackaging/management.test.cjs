const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const source = path.resolve(__dirname, '../../scripts/windows-service');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SmartEat installer entry point '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scripts = path.join(dir, 'embedded scripts');
  await fs.mkdir(scripts);
  for (const name of ['manage.ps1', 'ServiceData.psm1', 'InstallSecurity.psm1']) {
    await fs.copyFile(path.join(source, name), path.join(scripts, name));
  }
  return { dir, script: path.join(scripts, 'manage.ps1') };
}

function run(architecture, fixture, args) {
  const executable = path.join(process.env.WINDIR, architecture, 'WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => execFile(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture.script, ...args], {
    cwd: fixture.dir, windowsHide: true, timeout: 15000,
    env: { ...process.env, ProgramData: path.join(fixture.dir, 'synthetic machine data') },
  }, (error, stdout, stderr) => {
    if (error) { error.stderr = stderr; reject(error); } else resolve(stdout.trim());
  }));
}

for (const architecture of ['System32', 'SysWOW64']) {
  test(`${architecture} installer preflight accepts protected Program Files without an explicit ServiceDir`, { skip: process.platform !== 'win32' }, async (t) => {
    const files = await fixture(t);
    const destination = path.join(process.env.ProgramFiles, 'SmartEat-preflight-' + require('node:crypto').randomUUID());
    await run(architecture, files, ['-Action', 'ValidateInstall', '-InstallRoot', destination]);
    await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(files.dir, 'synthetic machine data')), { code: 'ENOENT' });
  });

  test(`${architecture} management status works from an unrelated working directory with default arguments`, { skip: process.platform !== 'win32' }, async (t) => {
    const files = await fixture(t);
    const status = JSON.parse(await run(architecture, files, ['-Action', 'Status']));
    assert.equal(status.name, 'SmartEatPrinterAgent');
    assert.equal(typeof status.state, 'string');
    await assert.rejects(fs.stat(path.join(files.dir, 'synthetic machine data')), { code: 'ENOENT' });
  });
}

test('installer preflight still refuses an ordinary user-writable directory', { skip: process.platform !== 'win32' }, async (t) => {
  const files = await fixture(t);
  await assert.rejects(run('SysWOW64', files, ['-Action', 'ValidateInstall', '-InstallRoot', path.join(files.dir, 'application')]), error => /SmartEat service operation failed/.test(error.stderr));
  await assert.rejects(fs.stat(path.join(files.dir, 'application')), { code: 'ENOENT' });
});
