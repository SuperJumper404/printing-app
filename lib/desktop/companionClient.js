const crypto = require("node:crypto");
const { REQUEST_CHANNEL, RESPONSE_CHANNEL, CANCEL_CHANNEL } = require("../printers/deviceBridgeClient");

function createCompanionClient(options = {}) {
  const { serviceClient, ipcMain, webContents } = options;
  if (!serviceClient?.request || !ipcMain?.on || !ipcMain?.off || !webContents?.send) throw new Error("Client de service et fenêtre compagnon requis.");
  const instanceId = options.instanceId || crypto.randomUUID();
  const processId = options.processId || process.pid;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const intervalMs = Math.max(20, Number(options.pollIntervalMs) || 1000);
  const timeoutMs = Math.max(50, Number(options.timeoutMs) || 5000);
  const active = new Map();
  const completed = new Map();
  const responses = new Map();
  const acknowledged = new Set();
  const seenCommands = new Set();
  let brokerId = null;
  let running = false;
  let timer;
  let currentCycle;
  let controller;
  let flushing;
  let listening = false;
  let rendererEnded = false;
  let reportingEnd;

  const call = (action, payload, signal) => serviceClient.request(action, { instanceId, ...payload }, { signal, timeoutMs });
  const recoveryPayload = () => [...active.entries()].map(([requestId, entry]) => ({ requestId, brokerId: entry.brokerId, operation: entry.operation, payload: entry.payload }));

  async function flushResponses(signal) {
    if (flushing) return flushing;
    flushing = (async () => {
      for (const [requestId, entry] of responses) {
        try { await call("companion:respond", { brokerId: entry.brokerId, response: entry.response }, signal); }
        catch (error) {
          if (!["BROKER_RESTARTED", "COMPANION_OWNER_MISMATCH"].includes(error.code)) throw error;
        }
        if (responses.get(requestId) === entry) responses.delete(requestId);
      }
    })();
    try { await flushing; } finally { flushing = null; }
  }

  const rememberCompleted = (requestId, response) => {
    completed.set(requestId, response);
    while (completed.size > 256) completed.delete(completed.keys().next().value);
  };

  const onResponse = (event, response) => {
    if (event?.sender !== webContents || !response?.requestId) return;
    const entry = active.get(response.requestId);
    const previous = completed.get(response.requestId);
    if (!entry && !previous) return;
    const responseBrokerId = entry?.brokerId || brokerId;
    responses.set(response.requestId, { brokerId: responseBrokerId, response });
    const finished = response.cleanupComplete !== false && (!entry?.cancelled || (response.cancelled && response.cleanupComplete));
    if (finished) {
      active.delete(response.requestId);
      rememberCompleted(response.requestId, response);
    }
    if (!running) void flushResponses().catch(() => {});
  };

  function deliver(command) {
    if (!command?.commandId || ![REQUEST_CHANNEL, CANCEL_CHANNEL].includes(command.channel) || !command.message?.requestId) return;
    acknowledged.add(command.commandId);
    if (seenCommands.has(command.commandId)) return;
    seenCommands.add(command.commandId);
    const { requestId } = command.message;
    if (command.channel === REQUEST_CHANNEL) {
      if (active.has(requestId)) return;
      if (completed.has(requestId)) {
        responses.set(requestId, { brokerId, response: completed.get(requestId) });
        return;
      }
      const payload = command.message.payload || {};
      active.set(requestId, { brokerId, operation: command.message.operation, payload: { config: payload.config || {}, ...(payload.printerId ? { printerId: payload.printerId } : {}) }, cancelled: false });
    } else {
      const entry = active.get(requestId);
      if (entry) { entry.cancelled = true; entry.brokerId = brokerId; }
      else if (!completed.has(requestId)) active.set(requestId, { brokerId, cancelled: true, operation: "recovered.send", payload: {} });
    }
    webContents.send(command.channel, command.message);
  }

  async function poll() {
    if (!running || rendererEnded) return;
    controller = new AbortController();
    try {
      await flushResponses(controller.signal);
      if (!running) return;
      const sentAcknowledgements = [...acknowledged];
      const result = await call("companion:poll", { brokerId, processId, acknowledged: sentAcknowledgements, activeRequests: recoveryPayload() }, controller.signal);
      if (!running) return;
      if (brokerId && result.brokerId !== brokerId) {
        seenCommands.clear();
        acknowledged.clear();
      }
      brokerId = result.brokerId;
      for (const entry of active.values()) entry.brokerId = brokerId;
      for (const id of sentAcknowledgements) { acknowledged.delete(id); seenCommands.delete(id); }
      for (const command of result.commands || []) deliver(command);
      await flushResponses(controller.signal);
    } catch (error) {
      if (options.onError && !controller.signal.aborted) options.onError(error);
    } finally {
      controller = null;
      if (running && !rendererEnded) timer = setTimer(poll, intervalMs);
    }
  }

  async function disconnect(ended) {
    if (!brokerId) return true;
    try { await call("companion:disconnect", { brokerId, processId, ended }); return true; }
    catch (error) { return ended && error.code === "COMPANION_OWNER_MISMATCH"; }
  }

  async function reportRendererEnd() {
    if (reportingEnd) return reportingEnd;
    reportingEnd = (async () => {
      if (!await disconnect(true)) {
        // Preserve proof of renderer termination through a loopback outage. This
        // retry only releases old barriers; it never resumes hardware requests.
        timer = setTimer(reportRendererEnd, intervalMs);
        timer?.unref?.();
      }
    })();
    try { await reportingEnd; } finally { reportingEnd = null; }
  }

  const onDestroyed = () => {
    rendererEnded = true;
    running = false;
    clearTimer(timer);
    controller?.abort();
    if (listening) { ipcMain.off(RESPONSE_CHANNEL, onResponse); listening = false; }
    active.clear();
    responses.clear();
    void reportRendererEnd();
  };
  webContents.once("destroyed", onDestroyed);

  return {
    start() {
      if (rendererEnded || webContents.isDestroyed?.()) return Promise.resolve();
      if (running) return currentCycle || Promise.resolve();
      running = true;
      if (!listening) { ipcMain.on(RESPONSE_CHANNEL, onResponse); listening = true; }
      currentCycle = poll();
      return currentCycle;
    },

    async stop() {
      running = false;
      clearTimer(timer);
      controller?.abort();
      for (const [requestId, entry] of active) {
        entry.cancelled = true;
        try { webContents.send(CANCEL_CHANNEL, { requestId }); } catch {}
      }
      await flushResponses().catch(() => {});
      if (rendererEnded || webContents.isDestroyed?.() === true) await reportRendererEnd();
      else await disconnect(false);
      if (active.size === 0 && listening) { ipcMain.off(RESPONSE_CHANNEL, onResponse); listening = false; }
    },
  };
}

module.exports = { createCompanionClient };
