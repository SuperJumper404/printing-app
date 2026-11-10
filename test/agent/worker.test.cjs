const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { fork } = require("node:child_process");
const { createServiceClient } = require("../../lib/desktop/serviceClient");

test("standalone worker starts authenticated HTTP without Electron and stops on supervisor request", async (t) => {
  const filename = path.resolve(__dirname, "../../service/worker.js");
  assert.equal(fs.existsSync(filename), true);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smarteat-worker-test-"));
  const child = fork(filename, ["--data-dir", dataDir, "--public-port", "0", "--control-port", "0", "--no-discovery"], {
    stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
    env: { ...process.env, SMARTEAT_CONTROL_TOKEN: "ab".repeat(32) },
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  t.after(() => { if (child.exitCode === null) child.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Worker startup timeout")), 10000);
    child.on("message", (message) => { if (message.type === "ready") { clearTimeout(timer); resolve(message); } });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Worker exited: ${code}`)); });
  });
  assert.ok(ready.publicPort > 0);
  assert.ok(ready.controlPort > 0);
  const connection = JSON.parse(fs.readFileSync(path.join(dataDir, "connection.json"), "utf8"));
  assert.equal(connection.token, "ab".repeat(32));
  assert.match(connection.certificate, /BEGIN CERTIFICATE/);
  assert.equal((await createServiceClient({ dataDir }).request("get-service-status")).running, true);
  assert.equal(output.includes(connection.token), false);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.send({ type: "stop" });
  assert.equal(await exited, 0);
});

test("existing provisioned control secrets are preserved across worker configuration changes", (t) => {
  const { loadControlToken } = require("../../service/worker");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smarteat-token-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, "control-token"), "cd".repeat(32));
  assert.equal(loadControlToken(dataDir, "ef".repeat(32)), "cd".repeat(32));
  assert.equal(fs.readFileSync(path.join(dataDir, "control-token"), "utf8"), "cd".repeat(32));
});

test("a second worker cannot own the same machine data even with different HTTP ports", async (t) => {
  const { startWorker } = require("../../service/worker");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smarteat-worker-lock-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const configuration = { argv: ["--data-dir", dataDir, "--no-discovery"], env: {}, send: () => {},
    tlsFactory: async () => ({ serverOptions: {}, certificate: "synthetic certificate" }),
    brokerFactory: () => ({}), runtimeFactory: () => ({ start: async () => {}, stop: async () => {}, status: () => ({ publicPort: 12345, controlPort: 12346 }) }) };
  const first = await startWorker(configuration);
  t.after(() => first.stop());
  await assert.rejects(startWorker(configuration), /déjà actif/i);
  await first.stop();
});

test("a stale diagnostic lock belonging to a live unrelated process cannot prevent startup", async (t) => {
  const { startWorker } = require("../../service/worker");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "smarteat-stale-worker-lock-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, "worker.lock"), JSON.stringify({ pid: process.pid, nonce: "stale-unrelated-process" }));
  const worker = await startWorker({ argv: ["--data-dir", dataDir, "--no-discovery"], env: {}, send: () => {},
    tlsFactory: async () => ({ serverOptions: {}, certificate: "synthetic certificate" }), brokerFactory: () => ({}),
    runtimeFactory: () => ({ start: async () => {}, stop: async () => {}, status: () => ({ publicPort: 12345, controlPort: 12346 }) }),
  });
  await worker.stop();
});
