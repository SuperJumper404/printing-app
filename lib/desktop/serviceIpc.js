const CHANNELS = [
  "get-saved-printers", "discover-printers", "purge-printer-data", "check-printer-online",
  "get-user-session", "set-user-session", "configure-print-polling", "get-print-history", "reprint-ticket",
  "print-job", "test-printer-protocols", "get-target-config", "get-device-grants", "save-device-grant",
  "terminals:list", "terminals:save", "terminals:delete", "terminals:list-serial-ports",
  "terminals:test-connection", "terminal-payments:start", "terminal-payments:get", "terminal-payments:cancel",
];

function registerServiceIpc({ ipc, client, isTrusted = () => true, onError = () => {} }) {
  let saves = Promise.resolve();
  let preferenceRevision = 0;
  const waitForPrinterSaves = async () => {
    let pending;
    do { pending = saves; await pending.catch(() => {}); } while (pending !== saves);
  };
  const readPrinterConfiguration = async (action = "get-saved-printers", payload, options = {}) => {
    // A read started before a save must never restore its stale snapshot after a reload.
    while (true) {
      await waitForPrinterSaves();
      const revision = preferenceRevision;
      const value = await client.request(action, payload, { timeoutMs: 30000, ...options });
      if (revision === preferenceRevision) return value;
    }
  };
  for (const channel of CHANNELS) {
    ipc.handle(channel, async (event, payload) => {
      if (!isTrusted(event)) throw new Error("Fenêtre non autorisée");
      if (["get-saved-printers", "discover-printers"].includes(channel)) return readPrinterConfiguration(channel, payload);
      return client.request(channel, payload, { timeoutMs: ["test-printer-protocols", "print-job", "reprint-ticket"].includes(channel) ? 300000 : 30000 });
    });
  }
  const save = payload => {
    preferenceRevision += 1;
    const pending = saves.catch(() => {}).then(() => client.request("save-printer-config", payload));
    saves = pending;
    return pending;
  };
  ipc.handle("save-printer-config", (event, payload) => {
    if (!isTrusted(event)) throw new Error("Fenêtre non autorisée");
    return save(payload);
  });
  // Older renderer versions may still send the event rather than invoke it.
  ipc.on("save-printer-config", (event, payload) => { if (isTrusted(event)) save(payload).catch(onError); });
  ipc.on("test-printer", async (event, payload) => {
    if (!isTrusted(event)) return;
    try { event.reply("test-printer-response", await client.request("test-printer-protocols", payload, { timeoutMs: 300000 })); }
    catch (error) { event.reply("test-printer-response", { success: false, message: error.message }); }
  });
  return { waitForPrinterSaves, readPrinterConfiguration };
}

function configureWindowLifecycle(window, { isQuitting }) {
  window.on("close", event => { if (!isQuitting()) { event.preventDefault(); window.hide(); } });
}

module.exports = { registerServiceIpc, configureWindowLifecycle };
