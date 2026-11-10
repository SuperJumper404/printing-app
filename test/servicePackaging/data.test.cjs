const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const modulePath = path.resolve(__dirname, '../../scripts/windows-service/ServiceData.psm1');
const run = (script, env) => new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$ErrorActionPreference='Stop'; " + script], { windowsHide: true, timeout: 10000, env: { ...process.env, ...env } }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));

test('loading installation security preserves both migration commands and security ACL dependencies', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SmartEat module integration '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'synthetic legacy.json');
  const target = path.join(dir, 'synthetic machine.json');
  const bytes = Buffer.from('{"synthetic":"été"}\r\n');
  await fs.writeFile(source, bytes);
  const output = await run('Import-Module $env:TEST_MODULE -Force; Import-Module $env:TEST_SECURITY -Force; $acl=New-InstallRootAcl -ReaderSid "S-1-5-21-1-2-3-1001" -Directory; if (-not (Test-InstallAclSafety -Acl $acl)) { throw "Invalid installation ACL" }; Import-LegacySettings -SourcePath $env:TEST_SOURCE -DestinationPath $env:TEST_TARGET | Out-Null; Resolve-CompanionUserSid -DataDir $env:TEST_DATA -CompanionUserSid "S-1-5-21-1-2-3-1001"', {
    TEST_MODULE: modulePath, TEST_SECURITY: path.join(path.dirname(modulePath), 'InstallSecurity.psm1'),
    TEST_SOURCE: source, TEST_TARGET: target, TEST_DATA: dir,
  });
  assert.equal(output, 'S-1-5-21-1-2-3-1001');
  assert.deepEqual(await fs.readFile(target), bytes);
});

test('legacy settings import preserves bytes, skips existing machine settings, and never removes the source', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SmartEat migration test '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'ancien réglage.json'); const target = path.join(dir, 'machine settings.json');
  const bytes = Buffer.from('{"synthetic":"été"}\r\n'); await fs.writeFile(source, bytes);
  const script = 'Import-Module $env:TEST_MODULE -Force; Import-LegacySettings -SourcePath $env:TEST_SOURCE -DestinationPath $env:TEST_TARGET | Out-Null';
  const env = { TEST_MODULE: modulePath, TEST_SOURCE: source, TEST_TARGET: target };
  await run(script, env); assert.deepEqual(await fs.readFile(target), bytes);
  await fs.writeFile(source, 'changed synthetic fixture'); await run(script, env);
  assert.deepEqual(await fs.readFile(target), bytes); assert.equal(await fs.readFile(source, 'utf8'), 'changed synthetic fixture');
});

test('credential ACL grants one authorized user read access while only SYSTEM and Administrators may write', { skip: process.platform !== 'win32' }, async () => {
  const reader = 'S-1-5-21-111111111-222222222-333333333-1001';
  const output = await run('Import-Module $env:TEST_MODULE -Force; $acl = New-ServiceAcl -ReaderSid $env:TEST_READER; @($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { @{sid=$_.IdentityReference.Value;rights=$_.FileSystemRights.ToString()} }) | ConvertTo-Json -Compress', { TEST_MODULE: modulePath, TEST_READER: reader });
  const rules = JSON.parse(output);
  assert.deepEqual(rules.map((rule) => rule.sid).sort(), ['S-1-5-18', 'S-1-5-32-544', reader].sort());
  assert.match(rules.find((rule) => rule.sid === reader).rights, /Read/);
  assert.doesNotMatch(rules.find((rule) => rule.sid === reader).rights, /Write|Modify|FullControl/);
  for (const sid of ['S-1-1-0', 'S-1-5-32-545']) assert.ok(!rules.some((rule) => rule.sid === sid));
});

test('legacy login cleanup selects only known SmartEat names with an exact authorized executable', { skip: process.platform !== 'win32' }, async () => {
  const output = await run('Import-Module $env:TEST_MODULE -Force; $entries=@{ "SmartEat Printer Agent"=\'"C:\\Old SmartEat\\SmartEat Printer Agent.exe" --hidden\'; "printing-app"=\'"C:\\Other\\printing-app.exe" --hidden\'; "Unrelated"=\'"C:\\Old SmartEat\\SmartEat Printer Agent.exe" --hidden\'; "SmartEatPrinterAgentCompanion"=\'"C:\\Old SmartEat\\SmartEat Printer Agent.exe" --hidden --unrelated\' }; @(Get-LegacyCompanionRunEntries -Entries $entries -ExecutablePaths @(\'C:\\Old SmartEat\\SmartEat Printer Agent.exe\')) | ConvertTo-Json -Compress', { TEST_MODULE: modulePath });
  assert.equal(JSON.parse(output), 'SmartEat Printer Agent');
});

test('service data initialization rejects a redirected parent before applying privileged ACLs', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SmartEat ACL path test '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'target'));
  await fs.symlink(path.join(dir, 'target'), path.join(dir, 'redirect'), 'junction');
  await assert.rejects(run('Import-Module $env:TEST_MODULE -Force; Assert-ServiceDataPath -DataDir $env:TEST_DATA', { TEST_MODULE: modulePath, TEST_DATA: path.join(dir, 'redirect', 'PrinterAgent') }), /reparse/i);
});

test('service installation PowerShell files have valid syntax without executing installer actions', { skip: process.platform !== 'win32' }, async () => {
  const output = await run('$errorsFound=@(); Get-ChildItem -LiteralPath $env:TEST_SCRIPT_DIR -Filter *.ps* | ForEach-Object { $tokens=$null; $parseErrors=$null; [System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$parseErrors) | Out-Null; $errorsFound += @($parseErrors) }; if ($errorsFound.Count) { throw "PowerShell parse error" }; "valid"', { TEST_SCRIPT_DIR: path.dirname(modulePath) });
  assert.equal(output, 'valid');
});
