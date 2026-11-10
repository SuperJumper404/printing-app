function createJobPoller({ getSession, fetchJobs, printJob, onError = console.error, intervalMs = 30000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let running = false;
  let active = null;
  let timer = null;
  let wakeRequested = false;
  let controller = null;

  function schedule(ms) {
    if (!running) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; poll(); }, ms);
  }
  async function poll() {
    if (!running || active) return;
    const currentController = new AbortController();
    controller = currentController;
    active = (async () => {
      const session = getSession();
      if (!session?.shopid) return;
      const jobs = await fetchJobs(session, { signal: currentController.signal });
      for (const job of Array.isArray(jobs) ? jobs : []) {
        if (!running || currentController.signal.aborted || getSession()?.shopid !== session.shopid) break;
        await printJob(job, { signal: currentController.signal });
      }
    })();
    try { await active; }
    catch (error) { if (!currentController.signal.aborted) onError(error); }
    finally {
      active = null;
      if (controller === currentController) controller = null;
      schedule(wakeRequested ? 0 : intervalMs);
      wakeRequested = false;
    }
  }
  return {
    start() { if (running) return false; running = true; poll(); return true; },
    stop() { running = false; wakeRequested = false; if (timer !== null) clearTimer(timer); timer = null; controller?.abort(); },
    wake() { if (!running) return; if (active) wakeRequested = true; else schedule(0); },
  };
}

module.exports = { createJobPoller };
