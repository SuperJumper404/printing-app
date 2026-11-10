const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { createServiceClient, serviceDataDirectory } = require("./serviceClient");
const { registerServiceIpc, configureWindowLifecycle } = require("./serviceIpc");
const { configureDevicePermissions } = require("./devicePermissions");
const { createCompanionClient } = require("./companionClient");
const { identityMatchesDevice } = require("../printers/devicePermissions");

function startDesktop(electron = require("electron")) {
  const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = electron;
  app.setAppUserModelId("com.smarteat.printeragent");
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const projectRoot = path.resolve(__dirname, "../..");
  const dataDir = serviceDataDirectory();
  const client = createServiceClient({ dataDir });
  let window;
  let tray;
  let quitting = false;
  let companion;
  let companionStarted = false;
  let statusTimer;
  let refreshing = false;
  let grants = [];
  let grantFile;
  let updater;

  function iconPath() {
    return [path.join(process.resourcesPath || "", "icon.ico"), path.join(projectRoot, "build/icon.ico"), path.join(projectRoot, "public/icon.png")].find(filename => fs.existsSync(filename));
  }
  const trusted = event => event.sender === window?.webContents;
  const send = (channel, payload) => { if (window && !window.webContents.isDestroyed()) window.webContents.send(channel, payload); };
  function showWindow() { if (!window) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }

  function persistGrant(type, metadata) {
    grants = grants.filter(grant => grant.deviceType !== type || !identityMatchesDevice(grant, metadata));
    grants.push({ ...metadata, deviceType: type });
    try { fs.writeFileSync(grantFile, JSON.stringify(grants), { encoding: "utf8", mode: 0o600 }); } catch {}
    client.request("save-device-grant", { deviceType: type, device: metadata }).catch(() => {});
  }

  async function readStatus() {
    try {
      const status = await client.request("get-service-status", null, { timeoutMs: 2000 });
      return { online: status.running !== false, version: status.version, companionOnline: Boolean(status.companion?.online),
        pollingConfigured: Boolean(status.pollingConfigured), jobs: status.jobs || {} };
    } catch { return { online: false, companionOnline: false, message: "Le service Windows SmartEat est indisponible." }; }
  }

  async function refreshStatus() {
    if (quitting || refreshing) return;
    refreshing = true;
    try {
      const status = await readStatus();
      if (status.online) {
        if (!companionStarted && companion) {
          const saved = await client.request("get-device-grants", null, { timeoutMs: 2000 });
          if (Array.isArray(saved)) {
            for (const grant of saved) if (!grants.some(previous => previous.deviceType === grant.deviceType && identityMatchesDevice(previous, grant))) grants.push(grant);
          }
          companion.start(); companionStarted = true;
        }
        const printers = await readPrinterConfiguration("get-saved-printers", null, { timeoutMs: 5000 });
        send("printers-updated", printers);
        send("print-history-updated");
      }
      send("service-status-updated", status);
    } catch { send("service-status-updated", { online: false, companionOnline: false }); }
    finally { refreshing = false; }
  }

  const { readPrinterConfiguration } = registerServiceIpc({ ipc: ipcMain, client, isTrusted: trusted });
  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-service-status", readStatus);
  ipcMain.handle("restart-service", async event => {
    if (!trusted(event)) throw new Error("Fenêtre non autorisée");
    await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Start-Service -Name 'SmartEatPrinterAgent' -ErrorAction Stop"], { windowsHide: true, timeout: 15000 }, error => error ? reject(new Error("Impossible de démarrer le service. Vérifiez son installation et vos droits Windows.")) : resolve()));
    await refreshStatus(); return { success: true };
  });
  ipcMain.handle("open-debug-console", async event => {
    if (!trusted(event)) throw new Error("Fenêtre non autorisée");
    const logs = path.join(dataDir, "logs");
    const error = await shell.openPath(logs);
    if (error) throw new Error("Les journaux du service ne sont pas encore disponibles.");
    return { logPath: logs };
  });
  ipcMain.handle("open-ticket-pdf", async (event, id) => {
    if (!trusted(event)) throw new Error("Fenêtre non autorisée");
    const history = await client.request("get-print-history");
    const entry = history.find(item => item.id === id);
    if (!entry) throw new Error("Ticket introuvable dans l’historique");
    const escape = value => String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    const pdf = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    try {
      await pdf.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<html lang="fr"><meta charset="utf-8"><body><pre style="font:14px monospace;white-space:pre-wrap">${escape(entry.printableText || "Aperçu indisponible")}</pre></body></html>`)}`);
      const filename = path.join(app.getPath("temp"), `smarteat-${crypto.randomUUID()}.pdf`);
      await fs.promises.writeFile(filename, await pdf.webContents.printToPDF({ pageSize: "A4", printBackground: true }));
      const error = await shell.openPath(filename);
      if (error) throw new Error("Impossible d’ouvrir le PDF");
      return { success: true, pdfPath: filename };
    } finally { pdf.destroy(); }
  });

  function checkUpdates(manual = false) {
    if (!app.isPackaged) return;
    if (!updater) {
      updater = require("electron-updater").autoUpdater;
      updater.autoDownload = false;
      updater.on("update-available", async info => {
        const result = await dialog.showMessageBox(window, { type: "info", title: "Mise à jour disponible", message: `La version ${info.version} est disponible.`, buttons: ["Télécharger", "Plus tard"], cancelId: 1 });
        if (result.response === 0) updater.downloadUpdate().catch(() => {});
      });
      updater.on("update-downloaded", async () => {
        const result = await dialog.showMessageBox(window, { type: "info", title: "Mise à jour prête", message: "Installer la mise à jour du service et du compagnon ?", buttons: ["Installer", "Plus tard"], cancelId: 1 });
        if (result.response === 0) { quitting = true; updater.quitAndInstall(); }
      });
      updater.on("error", () => { if (manual) dialog.showMessageBox(window, { type: "error", message: "La recherche de mises à jour est indisponible." }); });
    }
    updater.checkForUpdates().catch(() => {});
  }

  app.on("second-instance", (_event, argv) => { if (!argv?.includes("--hidden")) showWindow(); });
  app.on("before-quit", () => { quitting = true; clearInterval(statusTimer); });
  app.on("window-all-closed", () => { if (process.platform !== "win32") app.quit(); });
  app.whenReady().then(async () => {
    grantFile = path.join(app.getPath("userData"), "device-grants.json");
    try { const saved = JSON.parse(fs.readFileSync(grantFile, "utf8")); if (Array.isArray(saved)) grants = saved; } catch {}
    window = new BrowserWindow({ width: 1100, height: 850, show: !process.argv.includes("--hidden"), icon: iconPath(),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, backgroundThrottling: false, preload: path.join(__dirname, "preload.js") } });
    configureWindowLifecycle(window, { isQuitting: () => quitting });
    configureDevicePermissions(window, { ipc: ipcMain, getGrants: () => grants, saveGrant: persistGrant });
    companion = createCompanionClient({ serviceClient: client, ipcMain, webContents: window.webContents });
    window.webContents.on("did-finish-load", () => { void refreshStatus(); });
    window.webContents.on("render-process-gone", () => {
      companion.stop(); companionStarted = false;
      if (!quitting) setTimeout(() => { if (!window.isDestroyed()) window.reload(); }, 1000);
    });
    window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {}); return { action: "deny" }; });
    window.webContents.on("will-navigate", (event, url) => {
      if (url.split("#")[0] !== window.webContents.getURL().split("#")[0]) { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {}); }
    });
    const icon = iconPath() ? nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
    tray = new Tray(icon); tray.setToolTip("SmartEat — compagnon matériel");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Ouvrir SmartEat", click: showWindow },
      { label: "Vérifier les mises à jour", click: () => checkUpdates(true) },
      { type: "separator" },
      { label: "Quitter le compagnon (le service continue)", click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on("click", showWindow); tray.on("double-click", showWindow);
    statusTimer = setInterval(() => { void refreshStatus(); }, 5000); statusTimer.unref?.();
    if (process.env.NODE_ENV === "development") await window.loadURL("http://localhost:5173");
    else await window.loadFile(path.join(projectRoot, "frontend/dist/index.html"));
    checkUpdates();
  }).catch(() => { dialog.showErrorBox("SmartEat", "Impossible de démarrer le compagnon matériel."); app.quit(); });
}

module.exports = { startDesktop };
