const path = require('node:path');
const fs = require('node:fs');
const { fork, execFile } = require('node:child_process');

function terminateTree(child) {
  if (process.platform !== 'win32') { child.kill('SIGKILL'); return Promise.resolve(); }
  return new Promise((resolve, reject) => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true, timeout: 5000,
  }, (error) => error ? reject(error) : resolve()));
}

function createSupervisor(options = {}) {
  const forkWorker = options.fork || fork;
  const killTree = options.killTree || terminateTree;
  const workerPath = options.workerPath || path.join(__dirname, 'agent.cjs');
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30000;
  const startupTimeoutMs = options.startupTimeoutMs ?? 60000;
  const gracefulStopMs = options.gracefulStopMs ?? 10000;
  const checkIntervalMs = options.checkIntervalMs ?? 1000;
  const restartDelayMs = options.restartDelayMs ?? 2000;
  const log = options.log || (() => {});
  let active;
  let checking;
  let restarting;
  let stopping = false;
  let stopped;
  let resolveStop;
  let rejectStop;
  let failures = 0;
  const fatal = (error) => {
    stopping = true;
    clearInterval(checking); clearTimeout(restarting);
    rejectStop?.(error);
    options.onFatal?.(error);
  };
  const scheduleRestart = () => {
    if (stopping || restarting) return;
    const delay = Math.min(30000, restartDelayMs * Math.pow(2, Math.min(failures++, 4)));
    restarting = setTimeout(() => { restarting = null; launch(); }, delay);
  };
  const terminate = (record, reason) => {
    if (!record || record.terminating) return;
    record.terminating = true;
    log(reason);
    try { if (record.child.connected) record.child.send({ type: 'stop' }); } catch {}
    record.killTimer = setTimeout(async () => {
      if (active !== record) return;
      try { await killTree(record.child); }
      catch (error) { if (active === record) fatal(error); return; }
      // Never overlap a new worker with one whose termination has not been observed.
      if (active === record) record.killDeadline = setTimeout(() => fatal(new Error('Le processus moteur ne s’est pas arrêté.')), 5000);
    }, gracefulStopMs);
  };
  const launch = () => {
    if (stopping || active) return;
    let child;
    try {
      child = forkWorker(workerPath, [], {
        execPath: options.execPath || process.execPath,
        cwd: options.cwd || path.dirname(workerPath),
        env: options.env || process.env,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true,
      });
    } catch { log('worker-spawn-failed'); scheduleRestart(); return; }
    const record = { child, lastHeartbeat: Date.now(), ready: false, terminating: false };
    active = record;
    child.on('message', (message) => {
      if (active !== record || record.terminating) return;
      if (message?.type === 'ready' || message?.type === 'heartbeat') {
        record.ready = true; record.lastHeartbeat = Date.now();
      }
    });
    const exited = () => {
      if (active !== record) return;
      clearTimeout(record.killTimer); clearTimeout(record.killDeadline);
      active = null;
      if (stopping) { clearInterval(checking); resolveStop?.(); }
      else { log('worker-exited'); scheduleRestart(); }
    };
    child.once('exit', exited);
    child.once('close', exited);
    child.once('error', () => log('worker-process-error'));
  };
  return {
    start() {
      if (stopping || active || checking) return;
      launch();
      checking = setInterval(() => {
        if (!active || active.terminating) return;
        const limit = active.ready ? heartbeatTimeoutMs : startupTimeoutMs;
        if (Date.now() - active.lastHeartbeat >= limit) terminate(active, 'worker-heartbeat-expired');
      }, checkIntervalMs);
    },
    stop() {
      if (stopped) return stopped;
      stopping = true;
      clearTimeout(restarting); restarting = null;
      stopped = new Promise((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
      if (active) terminate(active, 'service-stopping');
      else { clearInterval(checking); resolveStop(); }
      return stopped;
    },
    status() { return { running: Boolean(active), stopping, ready: Boolean(active?.ready), pid: active?.child.pid || null }; },
  };
}

function getDataDir() {
  return process.env.SMARTEAT_DATA_DIR || path.join(process.env.ProgramData || 'C:\\ProgramData', 'SmartEat', 'PrinterAgent');
}

function requestStop(dataDir = getDataDir()) {
  // The installer restricts this directory to SYSTEM and Administrators.
  fs.writeFileSync(path.join(dataDir, 'service-stop.request'), String(Date.now()), { flag: 'w', mode: 0o600 });
}

function runSupervisor() {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const stopPath = path.join(dataDir, 'service-stop.request');
  fs.rmSync(stopPath, { force: true });
  const supervisor = createSupervisor({
    onFatal: () => { console.error('Arrêt du moteur impossible. Reprise par Windows.'); process.exit(1); },
    log: (event) => console.log(new Date().toISOString(), event),
  });
  let requested = false;
  const stop = () => {
    if (requested) return;
    requested = true; clearInterval(checkStop);
    supervisor.stop().then(() => process.exit(0), () => process.exit(1));
  };
  const checkStop = setInterval(() => { if (fs.existsSync(stopPath)) { fs.rmSync(stopPath, { force: true }); stop(); } }, 1000);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, stop);
  supervisor.start();
}

if (require.main === module) {
  try { if (process.argv.includes('--stop')) requestStop(); else runSupervisor(); }
  catch { console.error('Impossible de démarrer ou arrêter le service SmartEat.'); process.exitCode = 1; }
}

module.exports = { createSupervisor, terminateTree, requestStop, runSupervisor };
