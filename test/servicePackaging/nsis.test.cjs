const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const nsisDir = path.join(process.env.LOCALAPPDATA || '', 'electron-builder/Cache/nsis/nsis-3.0.4.1');
const compiler = path.join(nsisDir, 'makensis.exe');

test('NSIS consumes all install/update/uninstall hooks without running the resulting installer', { skip: process.platform !== 'win32' || !fsSync.existsSync(compiler) }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SmartEat NSIS build test '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.resolve(__dirname, '../..');
  const output = path.join(dir, 'compile-only.exe');
  const source = path.join(dir, 'compile-only.nsi');
  await fs.writeFile(source, `Unicode true\n!include LogicLib.nsh\n!define PROJECT_DIR "${root}"\n!define APP_EXECUTABLE_FILENAME "SmartEat Printer Agent.exe"\n!define INSTALL_REGISTRY_KEY "Software\\SmartEat-Compile-Only"\nName "SmartEat compile test"\nOutFile "${output}"\nRequestExecutionLevel admin\n!include "${root}\\build\\windows-service\\installer.nsh"\n!insertmacro customHeader\nFunction .onInit\n!insertmacro customInit\nFunctionEnd\nSection\n!insertmacro customInstall\nWriteUninstaller "$TEMP\\smarteat-compile-only-uninstall.exe"\nSectionEnd\nSection "Uninstall"\n!insertmacro customUnInstall\nSectionEnd\n`, 'utf8');
  await new Promise((resolve, reject) => execFile(compiler, ['/V2', source], { windowsHide: true, timeout: 30000, env: { ...process.env, NSISDIR: nsisDir } }, (error, stdout, stderr) => error ? reject(new Error(stderr || stdout)) : resolve()));
  assert.ok((await fs.stat(output)).size > 1000);
});
