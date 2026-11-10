const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const modulePath = path.resolve(__dirname, '../../scripts/windows-service/InstallSecurity.psm1');
const run = (script, env = {}) => new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '$ErrorActionPreference="Stop"; Import-Module (Join-Path $PSHOME "Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1") -Force; Import-Module $env:TEST_MODULE -Force; ' + script], { windowsHide: true, timeout: 15000, env: { ...process.env, TEST_MODULE: modulePath, ...env } }, (error, stdout, stderr) => { if (error) { error.stderr = stderr; reject(error); } else resolve(stdout.trim()); }));

test('install ACL validation rejects nonprivileged writes, ownership, and replaceable ancestors', { skip: process.platform !== 'win32' }, async () => {
  const script = '$results=@(); foreach ($rights in @(\'ReadAndExecute\',\'Write\',\'Modify\',\'Delete\',\'DeleteSubdirectoriesAndFiles\',\'ChangePermissions\',\'TakeOwnership\')) { $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new(\'S-1-5-32-544\')); $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new(\'S-1-5-32-544\'),\'FullControl\',\'Allow\')); $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new(\'S-1-5-32-545\'),$rights,\'Allow\')); $results += Test-InstallAclSafety -Acl $acl }; $results | ConvertTo-Json -Compress';
  assert.deepEqual(JSON.parse(await run(script)), [true, false, false, false, false, false, false]);
});

test('a user-owned directory is unsafe even after its ordinary write ACE was removed', { skip: process.platform !== 'win32' }, async () => {
  const result = await run('$acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new(\'S-1-5-21-1-2-3-1001\')); $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new(\'S-1-5-32-544\'),\'FullControl\',\'Allow\')); Test-InstallAclSafety -Acl $acl');
  assert.equal(result, 'False');
});

test('sibling creation on a higher ancestor cannot be mistaken for permission to replace its protected child', { skip: process.platform !== 'win32' }, async () => {
  const result = await run('$acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new(\'S-1-5-32-544\')); $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new(\'S-1-5-32-544\'),\'FullControl\',\'Allow\')); $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new(\'S-1-5-11\'),\'CreateDirectories\',\'Allow\')); @((Test-InstallAclSafety -Acl $acl),(Test-InstallAclSafety -Acl $acl -AllowSiblingCreation)) | ConvertTo-Json -Compress');
  assert.deepEqual(JSON.parse(result), [false, true]);
});

test('install root hardening grants only SYSTEM/Admin writes and one companion read/execute', { skip: process.platform !== 'win32' }, async () => {
  const reader = 'S-1-5-21-1-2-3-1001';
  const output = await run('$acl=New-InstallRootAcl -ReaderSid $env:TEST_READER -Directory; @($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { @{sid=$_.IdentityReference.Value;rights=$_.FileSystemRights.ToString();inheritance=$_.InheritanceFlags.ToString()} }) | ConvertTo-Json -Compress', { TEST_READER: reader });
  const rules = JSON.parse(output);
  assert.deepEqual(rules.map((rule) => rule.sid).sort(), ['S-1-5-18', 'S-1-5-32-544', reader].sort());
  assert.doesNotMatch(rules.find((rule) => rule.sid === reader).rights, /Write|Modify|FullControl|Delete/);
  assert.match(rules.find((rule) => rule.sid === reader).inheritance, /ContainerInherit/);
});

test('custom destinations in an ordinary user-writable tree and junction paths are rejected without changing ACLs', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SmartEat install security test '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'target'));
  await fs.symlink(path.join(dir, 'target'), path.join(dir, 'redirect'), 'junction');
  await assert.rejects(run('Assert-SafeInstallPath -InstallRoot $env:TEST_INSTALL', { TEST_INSTALL: path.join(dir, 'SmartEat') }), (error) => error.stderr.includes('UNSAFE_INSTALL_PATH'));
  await assert.rejects(run('Assert-InstallPathHasNoReparse -InstallRoot $env:TEST_INSTALL', { TEST_INSTALL: path.join(dir, 'redirect', 'SmartEat') }), (error) => error.stderr.includes('UNSAFE_INSTALL_REPARSE'));
  assert.ok((await fs.stat(path.join(dir, 'target'))).isDirectory());
});

test('a new application directory below protected Program Files passes a read-only preflight', { skip: process.platform !== 'win32' }, async () => {
  const installRoot = path.join(process.env.ProgramFiles, 'SmartEat-read-only-validation-' + require('node:crypto').randomUUID());
  const output = await run('Assert-SafeInstallPath -InstallRoot $env:TEST_INSTALL', { TEST_INSTALL: installRoot });
  assert.equal(output.toLowerCase(), installRoot.toLowerCase());
  await assert.rejects(fs.stat(installRoot), { code: 'ENOENT' });
});
