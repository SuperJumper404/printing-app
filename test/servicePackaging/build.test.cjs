const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { ensureVerifiedArtifact, copyNodeRuntime, copyDependencyTree, buildService, verifyNodeSignature } = require('../../scripts/build-service');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SmartEat service test '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('a pinned wrapper download is checksum verified and reused without network access', async (t) => {
  const dir = await temporary(t);
  let downloads = 0;
  const fixture = Buffer.from('verified-wrapper');
  const options = { cachePath: path.join(dir, 'wrapper.exe'), url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe', sha256: hash(fixture), download: async (_url, target) => { downloads++; await fs.writeFile(target, fixture); } };
  await ensureVerifiedArtifact(options); await ensureVerifiedArtifact(options);
  assert.equal(downloads, 1);
  await fs.writeFile(options.cachePath, 'tampered');
  await assert.rejects(ensureVerifiedArtifact(options), /checksum|empreinte/i);
  assert.equal(downloads, 1);
});

test('Node runtime is copied with its actual version/hash and refuses an untrusted signer', async (t) => {
  const dir = await temporary(t);
  const executable = path.join(dir, 'source-node.exe');
  const data = Buffer.from('signed-node-runtime'); await fs.writeFile(executable, data);
  const target = path.join(dir, 'output');
  await fs.mkdir(target);
  await assert.rejects(copyNodeRuntime({ source: executable, destination: target, version: 'v22.13.1', verifySignature: async () => false }), /signature/i);
  const metadata = await copyNodeRuntime({ source: executable, destination: target, version: 'v22.13.1', verifySignature: async () => true });
  assert.equal(metadata.version, 'v22.13.1'); assert.equal(metadata.sha256, hash(data));
  assert.deepEqual(await fs.readFile(path.join(target, 'node.exe')), data);
});

test('official local Node signature can be checked under a restricted PowerShell policy', { skip: process.platform !== 'win32' }, async () => {
  assert.equal(await verifyNodeSignature(process.execPath), true);
});

test('native serialport dependencies retain the Windows N-API prebuild and load from packaged files', async (t) => {
  const dir = await temporary(t);
  await copyDependencyTree('serialport', process.cwd(), path.join(dir, 'node_modules', 'serialport'));
  const output = await new Promise((resolve, reject) => execFile(process.execPath, ['-e', 'console.log(typeof require("serialport").SerialPort)'], { cwd: dir, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
  assert.equal(output, 'function');
  const bindings = path.join(dir, 'node_modules', 'serialport', 'node_modules', '@serialport', 'bindings-cpp', 'prebuilds', 'win32-x64', '@serialport+bindings-cpp.node');
  assert.ok((await fs.stat(bindings)).size > 1000);
});

test('service build bundles literal mjs imports and runs without the project node_modules', async (t) => {
  const dir = await temporary(t);
  const worker = path.join(dir, 'worker.js');
  await fs.writeFile(path.join(dir, 'merge.mjs'), 'export const value = "préservé";');
  await fs.writeFile(worker, 'import("./merge.mjs").then(({value}) => console.log(value));');
  const wrapper = path.join(dir, 'cached-wrapper.exe'); await fs.writeFile(wrapper, 'wrapper');
  const fakeNode = path.join(dir, 'fake-node.exe'); await fs.writeFile(fakeNode, 'node');
  await buildService({ rootDir: process.cwd(), outputDir: path.join(dir, 'service-dist'), workspaceRoot: dir, workerEntry: worker, nodeExecutable: fakeNode, verifyNodeSignature: async () => true,
    wrapper: { cachePath: wrapper, sha256: hash('wrapper'), url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' }, copyNativeDependencies: false });
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'service-dist', 'manifest.json'), 'utf8'));
  assert.equal(manifest.winsw.sha256, hash('wrapper'));
  assert.match(await fs.readFile(path.join(dir, 'service-dist', 'LICENSE-Node.txt'), 'utf8'), /Node\.js/);
  assert.match(await fs.readFile(path.join(dir, 'service-dist', 'LICENSE-WinSW.txt'), 'utf8'), /Copyright/);
  const result = await new Promise((resolve, reject) => execFile(process.execPath, [path.join(dir, 'service-dist', 'agent.cjs')], { cwd: os.tmpdir(), windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  assert.match(result, /préservé/);
});

test('Electron packaging preserves the complete service manifest and nested native dependencies', async (t) => {
  const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher');
  const configuration = require('../../package.json').build;
  const dir = await temporary(t);
  const fixture = {
    'agent.cjs': 'console.log(require("serialport"));',
    'node_modules/serialport/package.json': '{"name":"serialport","main":"index.js"}',
    'node_modules/serialport/index.js': 'module.exports = require("binding");',
    'node_modules/serialport/index.d.ts': 'export declare const version: string;',
    'node_modules/serialport/node_modules/binding/package.json': '{"name":"binding","main":"index.js"}',
    'node_modules/serialport/node_modules/binding/index.js': 'module.exports = "standalone native dependency";',
    'node_modules/serialport/node_modules/binding/prebuilds/win32-x64/binding.node': 'native fixture',
  };
  for (const [name, contents] of Object.entries(fixture)) {
    const filename = path.join(dir, 'service-dist', name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, contents);
  }
  const manifest = { files: Object.fromEntries(Object.entries(fixture).map(([name, contents]) => [name, hash(contents)])) };
  await fs.writeFile(path.join(dir, 'service-dist/manifest.json'), JSON.stringify(manifest));
  const resources = path.join(dir, 'packaged/resources');
  const matchers = getFileMatchers({ extraResources: configuration.extraResources.filter(entry => entry.to === 'service' || entry.to.startsWith('service/')) }, 'extraResources', resources, {
    defaultSrc: dir, globalOutDir: path.join(dir, 'packaged'), macroExpander: value => value, customBuildOptions: {},
  });
  await copyFiles(matchers);
  const service = path.join(resources, 'service');
  const packagedManifest = JSON.parse(await fs.readFile(path.join(service, 'manifest.json'), 'utf8'));
  for (const [name, checksum] of Object.entries(packagedManifest.files)) {
    assert.equal(hash(await fs.readFile(path.join(service, name))), checksum, name);
  }
  const stdout = await new Promise((resolve, reject) => execFile(process.execPath, [path.join(service, 'agent.cjs')], { cwd: dir, windowsHide: true }, (error, output) => error ? reject(error) : resolve(output)));
  assert.match(stdout, /standalone native dependency/);
});
