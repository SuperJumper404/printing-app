const crypto = require("node:crypto");

function createDurableJobs({ store, execute, now = Date.now, shutdownTimeoutMs = 10000,
  retryIntervalMs = 30000, maxRetryAgeMs = 24 * 60 * 60 * 1000, maxRetryRounds = 2880, maxCompletedEntries = 1000, onResult }) {
  let running = false;
  let timer;
  const active = new Map();
  let records = store.get("durableJobs", []);
  if (!Array.isArray(records)) throw new Error("Journal des impressions invalide");
  const dedupe = store.get("durableDedupe", {});
  if (!dedupe || typeof dedupe !== "object" || Array.isArray(dedupe)) throw new Error("Index des impressions invalide");
  const dedupeDigest = key => crypto.createHash("sha256").update(String(key)).digest("hex");
  const persist = () => {
    const completed = records.filter((record) => record.state === "completed" && !record.result?.results?.some((result) => !result.success))
      .sort((first, second) => (second.finishedAt || second.createdAt || 0) - (first.finishedAt || first.createdAt || 0));
    const retained = new Set(completed.slice(0, Math.max(0, Number(maxCompletedEntries) || 0)));
    const removable = new Set(completed.filter((record) => !retained.has(record)));
    let changed = false;
    for (const record of removable) {
      if (!record.dedupeKey) continue;
      const key = dedupeDigest(record.dedupeKey);
      if (!dedupe[key]) {
        // Keep the identity, never the full ticket, after its visible journal is compacted.
        dedupe[key] = { id: record.id, success: true, status: "success", finishedAt: record.finishedAt };
        changed = true;
      }
    }
    if (changed) store.set("durableDedupe", dedupe);
    records = records.filter((record) => !removable.has(record));
    store.set("durableJobs", records);
  };
  for (const record of records) {
    if (record.state === "sending") {
      record.state = "unknown";
      record.finishedAt = now();
      record.result = { success: false, status: "unknown", error: "Envoi interrompu par le redémarrage. Vérifiez le ticket avant de réessayer.", durableJobId: record.id };
      record.historyPending = true;
    }
  }
  persist();

  const targets = (record) => (record.result?.results || []).filter((result) => !result.success && result.deliveryState === "not-sent" && result.retryable === true);
  function mergeResults(previous, current) {
    if (!previous?.results?.length && !current.results?.length) return current;
    const results = new Map((previous?.results || []).map((result) => [`${result.printerId}:${result.transportId}`, result]));
    for (const result of current.results || []) results.set(`${result.printerId}:${result.transportId}`, result);
    const merged = [...results.values()];
    const success = merged.some((result) => result.success);
    const allSucceeded = merged.every((result) => result.success);
    return { ...current, results: merged, success, allSucceeded, partial: success && !allSucceeded,
      status: allSucceeded ? "success" : success ? "partial" : merged.some((result) => result.deliveryState === "unknown") ? "unknown" : "error",
      transportCount: merged.length, protocolCount: merged.length, printerCount: new Set(merged.map((result) => result.printerId)).size,
      error: allSucceeded ? undefined : merged.filter((result) => !result.success).map((result) => result.error).filter(Boolean).join("; ") };
  }
  function schedule() {
    clearTimeout(timer);
    if (!running) return;
    const waiting = records.filter((record) => record.state === "waiting");
    if (!waiting.length) return;
    const due = Math.min(...waiting.map((record) => record.nextAttemptAt || now()));
    timer = setTimeout(() => retryPending().catch(() => {}), Math.max(1, due - now()));
    timer.unref?.();
  }

  function run(record) {
    if (active.has(record.id)) return active.get(record.id).promise;
    const controller = new AbortController();
    const retryTargets = record.state === "waiting" ? targets(record).map(({ printerId, transportId }) => ({ printerId, transportId })) : undefined;
    const promise = (async () => {
      if (!running) return { success: false, status: "queued", durableJobId: record.id };
      record.state = "sending";
      record.startedAt = now();
      record.attempts = (record.attempts || 0) + 1;
      persist();
      let result;
      try { result = await execute(structuredClone(record.payload), { signal: controller.signal, durableJobId: record.id, retryTargets, previousResult: structuredClone(record.result) }); }
      catch { result = { success: false, status: "unknown", error: "Résultat d'impression inconnu. Vérifiez le ticket avant de réessayer.",
        ...(retryTargets ? { results: retryTargets.map((target) => ({ ...target, success: false, deliveryState: "unknown", retryable: false })) } : {}) }; }
      result = { ...mergeResults(record.result, result), durableJobId: record.id };
      record.result = result;
      const canRetry = targets(record).length > 0 && now() - record.createdAt < maxRetryAgeMs && record.attempts < maxRetryRounds;
      record.state = canRetry ? "waiting" : result.status === "unknown" || result.results?.some((item) => item.deliveryState === "unknown")
        ? "unknown" : result.success ? "completed" : "failed";
      if (canRetry) record.nextAttemptAt = now() + retryIntervalMs;
      else delete record.nextAttemptAt;
      result.pending = canRetry;
      if (canRetry) result.nextAttemptAt = record.nextAttemptAt;
      if (onResult) record.result = result = await onResult(structuredClone(record.payload), result);
      record.finishedAt = now();
      persist();
      schedule();
      return structuredClone(result);
    })();
    active.set(record.id, { promise, controller });
    promise.then(() => active.delete(record.id), () => active.delete(record.id));
    return promise;
  }
  async function retryPending({ wakeCompanion = false } = {}) {
    const ready = [];
    for (const record of records) {
      if (record.state === "queued") ready.push(record);
      if (record.state !== "waiting") continue;
      if (now() - record.createdAt >= maxRetryAgeMs || record.attempts >= maxRetryRounds) {
        record.state = "failed"; record.result.pending = false; record.result.retryExpired = true; delete record.nextAttemptAt;
        if (onResult) record.result = await onResult(structuredClone(record.payload), record.result);
        persist();
        continue;
      }
      if (record.nextAttemptAt <= now() || (wakeCompanion && targets(record).some((result) => ["COMPANION_OFFLINE", "COMPANION_UNAVAILABLE"].includes(result.code)))) ready.push(record);
    }
    const results = await Promise.all(ready.map(run));
    schedule();
    return results;
  }
  return {
    async start() {
      running = true;
      if (onResult) for (const record of records.filter((record) => record.historyPending && record.state === "unknown")) {
        record.result = await onResult(structuredClone(record.payload), record.result);
        delete record.historyPending;
        persist();
      }
      return retryPending();
    },
    async stop() {
      running = false;
      clearTimeout(timer);
      for (const entry of active.values()) entry.controller.abort();
      let shutdownTimer;
      await Promise.race([Promise.allSettled([...active.values()].map((entry) => entry.promise)), new Promise((resolve) => { shutdownTimer = setTimeout(resolve, shutdownTimeoutMs); })]);
      clearTimeout(shutdownTimer);
    },
    submit(payload, { dedupeKey } = {}) {
      if (dedupeKey) {
        const existing = records.find((record) => record.dedupeKey === dedupeKey);
        if (existing) return active.get(existing.id)?.promise || Promise.resolve(structuredClone(existing.result || { success: false, status: existing.state, durableJobId: existing.id }));
        const compacted = dedupe[dedupeDigest(dedupeKey)];
        if (compacted) return Promise.resolve({ success: compacted.success, status: compacted.status, allSucceeded: true, durableJobId: compacted.id, duplicate: true });
      }
      const record = { id: crypto.randomUUID(), state: "queued", createdAt: now(), payload: structuredClone(payload), ...(dedupeKey ? { dedupeKey } : {}) };
      records.push(record);
      persist();
      return run(record);
    },
    retryPending,
    list() { return structuredClone(records); },
  };
}

module.exports = { createDurableJobs };
