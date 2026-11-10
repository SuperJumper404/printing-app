const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const os = require("node:os");
const { JsonFileStore } = require("../lib/agent/store");
const { createAgentRuntime } = require("../lib/agent/runtime");

function readArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-discovery") result.noDiscovery = true;
    else if (["--data-dir", "--public-port", "--control-port", "--legacy-path"].includes(argument)) {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("Argument du service incomplet");
      result[argument.slice(2)] = argv[++index];
    } else throw new Error("Argument du service inconnu");
  }
  return result;
}

function portNumber(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Port du service invalide");
  return port;
}

function loadControlToken(dataDir, explicit) {
  const filename = path.join(dataDir, "control-token");
  try {
    const existing = fs.readFileSync(filename, "utf8").trim();
    if (!/^[a-f0-9]{64}$/i.test(existing)) throw new Error("Secret de contrôle invalide");
    return existing;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (explicit && !/^[a-f0-9]{64}$/i.test(explicit)) throw new Error("Secret de contrôle invalide");
  const token = explicit || crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(filename, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return token;
}

function writeConnection(filename, value) {
  // The installer gives this existing file a read ACL for the companion account.
  // Replacing it by rename would discard that ACL.
  let descriptor;
  try {
    descriptor = fs.openSync(filename, fs.existsSync(filename) ? "r+" : "wx", 0o600);
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    fs.writeFileSync(descriptor, bytes);
    fs.ftruncateSync(descriptor, bytes.length);
    fs.fsyncSync(descriptor);
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

async function acquireWorkerLock(dataDir) {
  const filename = path.join(dataDir, "worker.lock");
  const owner = { pid: process.pid, nonce: crypto.randomBytes(16).toString("hex") };
  const canonical = process.platform === "win32" ? path.resolve(dataDir).toLowerCase() : path.resolve(dataDir);
  const digest = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  const address = process.platform === "win32" ? `\\\\.\\pipe\\SmartEatPrinterAgent-${digest}`
    : process.platform === "linux" ? `\0SmartEatPrinterAgent-${digest}` : path.join(os.tmpdir(), `SmartEatPrinterAgent-${digest}.sock`);
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new Error("Le moteur est déjà actif ou son verrou système est inaccessible")));
    server.listen(address, resolve);
  });
  server.unref();
  try { fs.writeFileSync(filename, JSON.stringify(owner), { encoding: "utf8", mode: 0o600 }); }
  catch (error) { await new Promise((resolve) => server.close(resolve)); throw error; }
  return async () => {
    await new Promise((resolve) => server.close(resolve));
    try {
      const current = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (current.nonce === owner.nonce) fs.unlinkSync(filename);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  };
}

async function startWorker({ env = process.env, argv = process.argv.slice(2), send = process.send?.bind(process),
  runtimeFactory = createAgentRuntime, brokerFactory, tlsFactory } = {}) {
  const arguments_ = readArguments(argv);
  const dataDir = path.resolve(arguments_["data-dir"] || env.SMARTEAT_DATA_DIR || path.join(env.ProgramData || "C:\\ProgramData", "SmartEat", "PrinterAgent"));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const releaseLock = await acquireWorkerLock(dataDir);
  try {
  const tls = await (tlsFactory || require("../lib/agent/controlTls").ensureControlTls)(dataDir);
  const store = new JsonFileStore({ dataDir, legacyPath: arguments_["legacy-path"] || env.SMARTEAT_LEGACY_SETTINGS });
  const token = loadControlToken(dataDir, env.SMARTEAT_CONTROL_TOKEN);
  const createBroker = brokerFactory || require("../lib/agent/companionBroker").createCompanionBroker;
  const bridge = createBroker({ stateStore: store });
  const version = env.SMARTEAT_VERSION || require("../package.json").version;
  const runtime = runtimeFactory({ store, bridge, dataDir, version, controlToken: token, controlTls: tls.serverOptions,
    publicPort: portNumber(arguments_["public-port"] ?? env.SMARTEAT_PUBLIC_PORT, 8989),
    controlPort: portNumber(arguments_["control-port"] ?? env.SMARTEAT_CONTROL_PORT, 8990),
    discoveryIntervalMs: arguments_.noDiscovery || env.SMARTEAT_DISABLE_DISCOVERY === "1" ? 0 : 30000,
    onError: (message) => process.stderr.write(`[SmartEat] ${message}\n`),
  });
  let heartbeat;
  let stopping;
  const announce = (type) => {
    if (typeof send !== "function") return;
    try { send({ type, pid: process.pid, version, publicPort: runtime.status().publicPort, controlPort: runtime.status().controlPort, timestamp: Date.now() }); } catch {}
  };
  try {
    await runtime.start();
    writeConnection(path.join(dataDir, "connection.json"), { controlPort: runtime.status().controlPort, token, certificate: tls.certificate, version, pid: process.pid });
    announce("ready");
    heartbeat = setInterval(() => announce("heartbeat"), 5000);
    heartbeat.unref?.();
  } catch (error) { await runtime.stop(); throw error; }
  return { runtime, dataDir,
    stop() {
      if (!stopping) {
        clearInterval(heartbeat);
        stopping = Promise.resolve(runtime.stop()).finally(releaseLock);
      }
      return stopping;
    },
  };
  } catch (error) { await releaseLock(); throw error; }
}

if (require.main === module) {
  let worker;
  let stopRequested = false;
  const stop = async () => {
    stopRequested = true;
    if (!worker) return;
    try { await worker.stop(); process.exit(0); }
    catch { process.stderr.write("[SmartEat] Arrêt incomplet du service\n"); process.exit(1); }
  };
  for (const signal of ["SIGTERM", "SIGINT", ...(process.platform === "win32" ? ["SIGBREAK"] : [])]) process.on(signal, stop);
  process.on("message", (message) => { if (message?.type === "stop") stop(); });
  process.on("disconnect", stop);
  startWorker().then((created) => { worker = created; if (stopRequested) stop(); }, () => {
    process.stderr.write("[SmartEat] Démarrage impossible ; vérifiez la configuration du service\n");
    process.exit(1);
  });
}

module.exports = { startWorker, loadControlToken, readArguments };
