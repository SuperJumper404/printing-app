const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function downloadHttps(url, destination, redirects = 0) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname) || redirects > 5) throw new Error('Source WinSW HTTPS non autorisée.');
  const response = await new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers: { 'User-Agent': 'SmartEat-service-builder' } }, resolve);
    request.setTimeout(30000, () => request.destroy(new Error('Délai du téléchargement WinSW dépassé.')));
    request.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    return downloadHttps(new URL(response.headers.location, parsed).href, destination, redirects + 1);
  }
  if (response.statusCode !== 200) { response.resume(); throw new Error('Téléchargement WinSW refusé.'); }
  const deadline = setTimeout(() => response.destroy(new Error('Délai du téléchargement WinSW dépassé.')), 120000);
  try { await pipeline(response, createWriteStream(destination, { flags: 'wx' })); }
  finally { clearTimeout(deadline); }
}

async function ensureVerifiedArtifact({ cachePath, url, sha256: expected, download = downloadHttps }) {
  if (!/^[0-9a-f]{64}$/i.test(expected || '')) throw new Error('Empreinte WinSW absente.');
  try {
    await fs.access(cachePath);
    if (await sha256(cachePath) !== expected.toLowerCase()) throw new Error('Checksum WinSW invalide dans le cache. Supprimez ce fichier et relancez la construction.');
    return cachePath;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const pending = `${cachePath}.${crypto.randomUUID()}.download`;
  try {
    await download(url, pending);
    if (await sha256(pending) !== expected.toLowerCase()) throw new Error('Checksum WinSW téléchargé invalide.');
    await fs.rename(pending, cachePath);
    return cachePath;
  } finally { await fs.rm(pending, { force: true }); }
}

function verifyNodeSignature(file) {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '$ErrorActionPreference="Stop"; Import-Module (Join-Path $PSHOME "Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1") -Force; $s=Get-AuthenticodeSignature -LiteralPath $env:SMARTEAT_NODE_EXE; if ($s.Status -eq "Valid" -and $s.SignerCertificate.Subject -match "(OpenJS Foundation|Node.js Foundation)") { "valid" } else { exit 1 }'], {
    env: { ...process.env, SMARTEAT_NODE_EXE: file }, windowsHide: true, timeout: 15000,
  }, (error, stdout) => error ? reject(new Error('Signature du runtime Node non approuvée.')) : resolve(stdout.trim() === 'valid')));
}

async function copyNodeRuntime({ source = process.execPath, destination, version = process.version, verifySignature = verifyNodeSignature }) {
  if (!await verifySignature(source)) throw new Error('Signature du runtime Node non approuvée.');
  const expected = await sha256(source);
  const output = path.join(destination, 'node.exe');
  await fs.copyFile(source, output);
  if (await sha256(output) !== expected) throw new Error('Empreinte du runtime Node copié invalide.');
  return { version, architecture: 'x64', sha256: expected, publisher: 'OpenJS Foundation / Node.js Foundation (Authenticode valid)' };
}

async function copyDependencyTree(name, fromDirectory, destination, ancestors = new Set()) {
  let packageFile;
  try { packageFile = require.resolve(`${name}/package.json`, { paths: [fromDirectory] }); }
  catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    let current = path.dirname(require.resolve(name, { paths: [fromDirectory] }));
    while (true) {
      const candidate = path.join(current, 'package.json');
      try { if (JSON.parse(await fs.readFile(candidate, 'utf8')).name === name) { packageFile = candidate; break; } }
      catch (readError) { if (readError.code !== 'ENOENT') throw readError; }
      const parent = path.dirname(current);
      if (parent === current) throw new Error(`Métadonnées de dépendance absentes: ${name}`);
      current = parent;
    }
  }
  const source = path.dirname(packageFile);
  if (ancestors.has(source)) throw new Error(`Dépendance native cyclique: ${name}`);
  const manifest = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(source, entry).split(path.sep);
      if (relative.includes('node_modules')) return false;
      const prebuild = relative.indexOf('prebuilds');
      return prebuild < 0 || relative.length <= prebuild + 1 || relative[prebuild + 1] === 'win32-x64';
    },
  });
  const visited = new Set(ancestors); visited.add(source);
  for (const dependency of Object.keys(manifest.dependencies || {})) await copyDependencyTree(dependency, source, path.join(destination, 'node_modules', dependency), visited);
  return { name, version: manifest.version };
}

function checkedOutput(workspaceRoot, outputDir) {
  const base = path.resolve(workspaceRoot);
  const target = path.resolve(outputDir);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).includes('node_modules')) throw new Error('Le dossier de sortie doit rester dans l’espace de construction.');
  return target;
}

async function fileChecksums(directory, prefix = '') {
  const result = {};
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await fileChecksums(directory, relative));
    else if (entry.isFile()) result[relative.split(path.sep).join('/')] = await sha256(path.join(directory, relative));
  }
  return result;
}

async function buildService(options = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Construisez le service sur Windows x64 avec un Node Windows signé.');
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const outputDir = checkedOutput(options.workspaceRoot || rootDir, options.outputDir || path.join(rootDir, 'service-dist'));
  const staging = checkedOutput(options.workspaceRoot || rootDir, `${outputDir}.staging-${crypto.randomUUID()}`);
  const descriptor = options.wrapper || JSON.parse(await fs.readFile(path.join(rootDir, 'build/windows-service/winsw.json'), 'utf8'));
  const wrapper = await ensureVerifiedArtifact({ ...descriptor, cachePath: descriptor.cachePath || path.join(rootDir, 'service/.cache/WinSW-v2.12.0-x64.exe') });
  await fs.mkdir(staging, { recursive: true });
  try {
    const esbuild = require('esbuild');
    const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'warning', external: ['serialport'] };
    await esbuild.build({ ...common, entryPoints: [options.workerEntry || path.join(rootDir, 'service/worker.js')], outfile: path.join(staging, 'agent.cjs') });
    await esbuild.build({ ...common, entryPoints: [path.join(rootDir, 'service/supervisor.js')], outfile: path.join(staging, 'supervisor.cjs') });
    const node = await copyNodeRuntime({ source: options.nodeExecutable || process.execPath, destination: staging, verifySignature: options.verifyNodeSignature || verifyNodeSignature });
    await fs.copyFile(wrapper, path.join(staging, 'SmartEatPrinterAgent.exe'));
    await fs.copyFile(path.join(rootDir, 'build/windows-service/SmartEatPrinterAgent.xml'), path.join(staging, 'SmartEatPrinterAgent.xml'));
    const dependencies = options.copyNativeDependencies === false ? [] : [await copyDependencyTree('serialport', rootDir, path.join(staging, 'node_modules/serialport'))];
    const nodeLicense = path.join(rootDir, 'build/windows-service', `LICENSE-Node-${process.version}.txt`);
    await fs.copyFile(nodeLicense, path.join(staging, 'LICENSE-Node.txt'));
    await fs.copyFile(path.join(rootDir, 'build/windows-service/LICENSE-WinSW.txt'), path.join(staging, 'LICENSE-WinSW.txt'));
    const manifest = { formatVersion: 1, node, winsw: { version: descriptor.version || '2.12.0', sha256: descriptor.sha256, url: descriptor.url }, dependencies, files: await fileChecksums(staging) };
    await fs.writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rename(staging, outputDir);
    return { outputDir, manifest };
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}

if (require.main === module) buildService().then(({ outputDir }) => console.log(`Service autonome préparé: ${outputDir}`), (error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { ensureVerifiedArtifact, copyNodeRuntime, copyDependencyTree, buildService, checkedOutput, verifyNodeSignature };
