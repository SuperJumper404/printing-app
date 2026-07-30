const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const bonjour = require("bonjour")();
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const baseDir = app.isPackaged
  ? path.dirname(app.getPath("exe")) // dossier de l'exe
  : process.cwd();

console.log("Base Directory for Store:", baseDir);
const store = new (Store.default || Store)({
  cwd: baseDir,
  name: "settings",
});

const net = require("net");
const { execFile } = require("child_process");
require("dotenv").config();
const fetch = require("node-fetch");
const ipp = require("ipp");
const express = require("express");
const os = require("os");
const bodyParser = require("body-parser");

const escpos = require("escpos");
const Network = require("escpos-network");
escpos.Network = Network;
console.log("Process Platform", process.platform);

let mainWindow = null;
let tray = null;
let isQuitting = false;
let updateEventsRegistered = false;

function getAppIconPath() {
  const iconCandidates = [
    path.join(__dirname, "build", "icon.ico"),
    path.join(__dirname, "public", "icon.ico"),
    path.join(__dirname, "public", "favicon.ico"),
  ];

  return iconCandidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function runPowerShell(script, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        env: { ...process.env, ...env },
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 5,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function normalizeSerialPortName(portName, fallbackPortName = "") {
  const cleanedPortName = String(portName || "").replace(/:$/, "");

  const directPort = cleanedPortName.match(/^COM\d+$/i)?.[0];
  if (directPort) return directPort.toUpperCase();

  const fallbackComPort = String(fallbackPortName || "").match(/COM\d+/i)?.[0];
  if (fallbackComPort) return fallbackComPort.toUpperCase();

  const embeddedComPort = cleanedPortName.match(/COM\d+/i)?.[0];
  if (embeddedComPort) return embeddedComPort.toUpperCase();

  return cleanedPortName;
}

async function runPowerShellJson(script, env = {}) {
  const output = await runPowerShell(script, env);
  if (!output) return [];
  try {
    const data = JSON.parse(output);
    return Array.isArray(data) ? data : [data];
  } catch (error) {
    console.error("PowerShell JSON parse error:", error.message, output);
    return [];
  }
}

// -------------------------------------------------------------
// 🪟 Fenêtre principale
// -------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    icon: getAppIconPath() || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform === "win32") {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    console.log(
      "file fronted",
      path.join(__dirname, "frontend/dist/index.html")
    );
    mainWindow.loadFile(path.join(__dirname, "frontend/dist/index.html"));
  }
}

function getTrayIcon() {
  const iconPath = getAppIconPath();

  if (!iconPath) {
    return nativeImage.createEmpty();
  }

  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;

  tray = new Tray(getTrayIcon());
  tray.setToolTip("SmartEat Printer Agent");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Ouvrir SmartEat Printer Agent",
        click: showMainWindow,
      },
      {
        label: "Verifier les mises a jour",
        click: () => checkForUpdates({ manual: true }),
      },
      { type: "separator" },
      {
        label: "Quitter",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );

  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

function registerUpdateEvents() {
  if (updateEventsRegistered) return;
  updateEventsRegistered = true;

  autoUpdater.autoDownload = false;

  autoUpdater.on("update-available", async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Mise a jour disponible",
      message: `Une nouvelle version est disponible (${info.version}).`,
      detail: "Voulez-vous la telecharger maintenant ?",
      buttons: ["Telecharger", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on("update-not-available", () => {
    console.log("Aucune mise a jour disponible.");
  });

  autoUpdater.on("update-downloaded", async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Mise a jour prete",
      message: "La mise a jour est telechargee.",
      detail: "Redemarrez l'application pour installer la nouvelle version.",
      buttons: ["Redemarrer et installer", "Plus tard"],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (error) => {
    console.error("Erreur de mise a jour:", error);
  });
}

function checkForUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Mises a jour",
        message:
          "Les mises a jour automatiques sont actives seulement dans l'application installee.",
      });
    }
    return;
  }

  registerUpdateEvents();
  autoUpdater.checkForUpdates().catch((error) => {
    console.error("Impossible de verifier les mises a jour:", error);
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Mise a jour impossible",
        message: "Impossible de verifier les mises a jour pour le moment.",
      });
    }
  });
}

app.setLoginItemSettings({
  openAtLogin: true,
});
app.whenReady().then(() => {
  console.log("📦 Contenu complet du Store au démarrage:");
  console.log(JSON.stringify(store.store, null, 2));
  createWindow();
  createTray();
  checkForUpdates();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") return;
  app.quit();
});

async function discoverNetworkPrinters(timeout = 8000) {
  console.log("🔍 Recherche des imprimantes réseau...");
  return new Promise((resolve) => {
    const printers = [];

    const browser = bonjour.find({}, (service) => {
      console.log("SErvice en cour d'analyse", service);
      if (!service || !service.name) return;

      // Éviter les doublons (même IP déjà vue)
      const ip = service.addresses?.[0];
      if (printers.some((p) => p.ip === ip)) return;

      printers.push({
        name: service.name,
        type: service.type,
        ip,
        port: service.port,
        protocol: service.protocol,
        manufacturer: service.txt?.usb_mfg || null,
        model: service.txt?.usb_mdl || null,
        product: service.txt?.product || null,
        adminUrl: service.txt?.adminurl || null,
      });
      console.log(
        "🖨️ Imprimante trouvée :",
        service.name,
        ip,
        "port:",
        service.port
      );
      console.log("All Printers Founded", printers);
      console.log("BROWSER", browser);
    });
    // });

    // Arrêter la recherche après `timeout` ms
    setTimeout(() => {
      console.log("Printer Search Timeout");
      try {
        browser.stop?.();
      } catch {}
      resolve(printers);
    }, timeout);
  });
}

async function discoverBluetoothPrinters({ useFilters = true } = {}) {
  if (process.platform !== "win32") {
    console.log("Bluetooth discovery is only implemented on Windows.");
    return [];
  }

  const script = `
    $serialPorts = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue |
      Where-Object {
        $env:SMARTEAT_USE_FILTERS -eq 'false' -or
        $_.Name -match 'Bluetooth|BTH|Standard Serial over Bluetooth' -or
        $_.Description -match 'Bluetooth|BTH|Standard Serial over Bluetooth' -or
        $_.PNPDeviceID -match 'BTH|Bluetooth'
      } |
      ForEach-Object {
        [pscustomobject]@{
          source = 'serial'
          name = $_.Name
          portName = $_.DeviceID
          description = $_.Description
          pnpDeviceId = $_.PNPDeviceID
        }
      }

    $printerQueues = Get-Printer -ErrorAction SilentlyContinue |
      Where-Object {
        $env:SMARTEAT_USE_FILTERS -eq 'false' -or
        $_.PortName -match 'BTH|Bluetooth|COM[0-9]+' -or
        $_.Name -match 'Bluetooth'
      } |
      ForEach-Object {
        [pscustomobject]@{
          source = 'spooler'
          name = $_.Name
          printerName = $_.Name
          portName = $_.PortName
          driverName = $_.DriverName
          status = $_.PrinterStatus
        }
      }

    @($serialPorts + $printerQueues) | ConvertTo-Json -Depth 4
  `;

  const devices = await runPowerShellJson(script, {
    SMARTEAT_USE_FILTERS: String(useFilters),
  });
  const printers = new Map();

  for (const device of devices) {
    if (device.source === "serial" && device.portName) {
      const id = `bluetooth-serial-${device.portName}`;
      printers.set(id, {
        id,
        name: device.name || `Bluetooth ${device.portName}`,
        type: "bluetooth",
        connectionType: "bluetooth",
        portName: device.portName,
        protocol: "serial",
        description: device.description || null,
        pnpDeviceId: device.pnpDeviceId || null,
          availableProtocols: {
            bluetoothSerial: true,
            bluetoothWindowsSpooler: false,
          },
      });
    }

    if (device.source === "spooler" && device.printerName) {
      const id = `bluetooth-spooler-${device.printerName}`;
      printers.set(id, {
        id,
        name: device.name || device.printerName,
        type: "bluetooth",
        connectionType: "bluetooth",
        printerName: device.printerName,
        portName: device.portName || null,
        protocol: "windows-spooler",
        driverName: device.driverName || null,
        status: device.status || null,
          availableProtocols: {
            bluetoothSerial: false,
            bluetoothWindowsSpooler: true,
          },
      });
    }
  }

  return [...printers.values()];
}

async function discoverUsbPrinters({ useFilters = true } = {}) {
  if (process.platform !== "win32") {
    console.log("USB discovery is only implemented on Windows.");
    return [];
  }

  const script = `
    $serialPorts = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue |
      Where-Object {
        $env:SMARTEAT_USE_FILTERS -eq 'false' -or
        (
          $_.PNPDeviceID -match 'USB' -or
          $_.Name -match 'USB' -or
          $_.Description -match 'USB'
        ) -and
        $_.PNPDeviceID -notmatch 'BTH|Bluetooth' -and
        $_.Name -notmatch 'Bluetooth|BTH' -and
        $_.Description -notmatch 'Bluetooth|BTH'
      } |
      ForEach-Object {
        [pscustomobject]@{
          source = 'serial'
          name = $_.Name
          portName = $_.DeviceID
          description = $_.Description
          pnpDeviceId = $_.PNPDeviceID
        }
      }

    $printerQueues = Get-Printer -ErrorAction SilentlyContinue |
      Where-Object {
        $env:SMARTEAT_USE_FILTERS -eq 'false' -or
        (
          $_.PortName -match 'USB|DOT4' -or
          $_.DriverName -match 'USB' -or
          $_.Name -match 'USB|NIIMBOT|NIMBOT|EPSON|Zebra|Bixolon|Star'
        ) -and
        $_.PortName -notmatch 'BTH|Bluetooth' -and
        $_.Name -notmatch 'Bluetooth|BTH'
      } |
      ForEach-Object {
        [pscustomobject]@{
          source = 'spooler'
          name = $_.Name
          printerName = $_.Name
          portName = $_.PortName
          driverName = $_.DriverName
          status = $_.PrinterStatus
        }
      }

    @($serialPorts + $printerQueues) | ConvertTo-Json -Depth 4
  `;

  const devices = await runPowerShellJson(script, {
    SMARTEAT_USE_FILTERS: String(useFilters),
  });
  const printers = new Map();

  for (const device of devices) {
    if (device.source === "serial" && device.portName) {
      const id = `usb-serial-${device.portName}`;
      printers.set(id, {
        id,
        name: device.name || `USB ${device.portName}`,
        type: "usb",
        connectionType: "usb",
        portName: device.portName,
        protocol: "serial",
        description: device.description || null,
        pnpDeviceId: device.pnpDeviceId || null,
          availableProtocols: {
            usbSerial: true,
            usbWindowsSpooler: false,
          },
      });
    }

    if (device.source === "spooler" && device.printerName) {
      const id = `usb-spooler-${device.printerName}`;
      printers.set(id, {
        id,
        name: device.name || device.printerName,
        type: "usb",
        connectionType: "usb",
        printerName: device.printerName,
        portName: device.portName || null,
        protocol: "windows-spooler",
        driverName: device.driverName || null,
        status: device.status || null,
          availableProtocols: {
            usbSerial: false,
            usbWindowsSpooler: true,
          },
      });
    }
  }

  return [...printers.values()];
}

async function discoverLocalPrinterQueues({ useFilters = true } = {}) {
  if (process.platform !== "win32") {
    console.log("Local printer queue discovery is only implemented on Windows.");
    return [];
  }

  const script = `
    $printerQueues = Get-Printer -ErrorAction SilentlyContinue |
      Where-Object {
        $env:SMARTEAT_USE_FILTERS -eq 'false' -or
        $_.Name -match 'TSP|Star|EPSON|TM-|Zebra|Bixolon|Citizen|POS|Receipt|Ticket|NIIMBOT|NIMBOT' -or
        $_.DriverName -match 'TSP|Star|EPSON|TM-|Zebra|Bixolon|Citizen|POS|Receipt|Ticket|Generic / Text' -or
        $_.PortName -match '^test$|^test:|COM[0-9]+:|TSP|Star|Ticket|Receipt|POS'
      } |
      ForEach-Object {
        [pscustomobject]@{
          name = $_.Name
          printerName = $_.Name
          portName = $_.PortName
          driverName = $_.DriverName
          status = $_.PrinterStatus
        }
      }

    $starVirtualPorts = @()
    $starConfigPath = 'C:\\ProgramData\\StarMicronics\\TSP100\\Configuration\\portemu_config.xml'
    if (Test-Path $starConfigPath) {
      try {
        [xml]$starConfig = Get-Content $starConfigPath
        $pairs = $starConfig.configuration.PortEmulator.ChildNodes |
          Where-Object { $_.Name -match '^Pair[0-9]*$' }
        foreach ($pair in $pairs) {
          $emulated = ($pair.setting | Where-Object { $_.name -eq 'emulated' }).'#text'
          $emulation = ($pair.setting | Where-Object { $_.name -eq 'emulation' }).'#text'
          $real = ($pair.setting | Where-Object { $_.name -eq 'real' }).'#text'
          if ($emulated) {
            $starVirtualPorts += [pscustomobject]@{
              name = "Star Virtual Port $emulated"
              printerName = $null
              portName = $emulated
              realPortName = $real
              emulation = $emulation
              driverName = 'Star TSP100 Port Emulator'
              status = 'Normal'
              source = 'star-port-emulator'
            }
          }
        }
      } catch {}
    }

    @($printerQueues + $starVirtualPorts) | ConvertTo-Json -Depth 4
  `;

  const devices = await runPowerShellJson(script, {
    SMARTEAT_USE_FILTERS: String(useFilters),
  });

  return devices.map((device) => ({
    id: device.source === "star-port-emulator"
      ? `star-port-emulator-${device.portName}`
      : `local-spooler-${device.printerName}`,
    name: device.name || device.printerName || device.portName,
    type: "local",
    connectionType: "local",
    printerName: device.printerName || null,
    portName: device.portName || null,
    realPortName: device.realPortName || null,
    effectivePortName: normalizeSerialPortName(device.portName, device.realPortName),
    protocol: device.emulation || device.source || "local",
    driverName: device.driverName || null,
    status: device.status || null,
    availableProtocols: {
      localSerial: Boolean(device.portName),
      localWindowsSpooler: Boolean(device.printerName),
    },
  }));
}

ipcMain.handle("check-printer-online", async (_, { ip, port }) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);

    socket
      .once("connect", () => {
        socket.destroy();
        resolve(true);
      })
      .once("timeout", () => {
        socket.destroy();
        resolve(false);
      })
      .once("error", () => {
        resolve(false);
      })
      .connect(port || 9100, ip);
  });
});

ipcMain.handle("check-bluetooth-printer-online", async (_, printer) => {
  if (process.platform !== "win32") return false;
  if (printer?.portName) return true;
  if (!printer?.printerName) return false;

  const script = `
    $printer = Get-Printer -Name $env:SMARTEAT_PRINTER_NAME -ErrorAction SilentlyContinue
    if ($null -eq $printer) { 'false' } else { 'true' }
  `;

  const output = await runPowerShell(script, {
    SMARTEAT_PRINTER_NAME: printer.printerName,
  });

  return output.toLowerCase() === "true";
});

ipcMain.handle("check-usb-printer-online", async (_, printer) => {
  if (process.platform !== "win32") return false;
  if (printer?.portName && !printer?.printerName) return true;
  if (!printer?.printerName) return false;

  const script = `
    $printer = Get-Printer -Name $env:SMARTEAT_PRINTER_NAME -ErrorAction SilentlyContinue
    if ($null -eq $printer) { 'false' } else { 'true' }
  `;

  const output = await runPowerShell(script, {
    SMARTEAT_PRINTER_NAME: printer.printerName,
  });

  return output.toLowerCase() === "true";
});

ipcMain.handle("check-local-printer-online", async (_, printer) => {
  if (process.platform !== "win32") return false;
  if (printer?.portName && !printer?.printerName) return true;
  if (!printer?.printerName) return false;

  const script = `
    $printer = Get-Printer -Name $env:SMARTEAT_PRINTER_NAME -ErrorAction SilentlyContinue
    if ($null -eq $printer) { 'false' } else { 'true' }
  `;

  const output = await runPowerShell(script, {
    SMARTEAT_PRINTER_NAME: printer.printerName,
  });

  return output.toLowerCase() === "true";
});

// 📂 Lecture des préférences sauvegardées
ipcMain.handle("get-saved-printers", () => {
  const savedPrinters = store.get("printers", []);
  return savedPrinters;
});
// -------------------------------------------------------------
// 📡 Communication avec le front-end (printer.html)
// -------------------------------------------------------------
ipcMain.handle("discover-printers", async (_, options = {}) => {
  const useFilters = options.useFilters !== false;
  const networkPrinters = await discoverNetworkPrinters();
  const bluetoothPrinters = await discoverBluetoothPrinters({ useFilters });
  const usbPrinters = await discoverUsbPrinters({ useFilters });
  const localPrinters = await discoverLocalPrinterQueues({ useFilters });

  return [
    ...networkPrinters.map((printer) => ({
      ...printer,
      id: printer.ip || Math.random().toString(36).slice(2),
      connectionType: "network",
      availableProtocols: {
        9100: true,
        631: true,
        515: true,
        80: true,
      },
    })),
    ...bluetoothPrinters,
    ...usbPrinters,
    ...localPrinters,
  ];
});

ipcMain.on("save-printer-config", (event, printers) => {
  store.set("printers", printers);
  console.log("💾 Config sauvegardée :", printers);
});

function testPrinter() {
  console.log("Test Printer depuis endpoint");
  const savedPrinters = store.get("printers", []);
  const printersToTest = savedPrinters.filter((x) => {
    const activePorts = Object.entries(x.protocols).filter(
      ([_, enabled]) => enabled
    );
    if (activePorts.length) return x;
  });
  console.log("Les Imprimantes a test", printersToTest);
}

function getPrintHistory() {
  return store.get("printHistory", []);
}

function savePrintHistory(history) {
  store.set("printHistory", history.slice(0, 100));
}

function addPrintHistoryEntry(payload, result) {
  const history = getPrintHistory();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    printedAt: new Date().toISOString(),
    ticketType: payload?.ticketType || "unknown",
    status: result.success ? "success" : "error",
    printerCount: result.printerCount || 0,
    protocolCount: result.protocolCount || 0,
    error: result.error || null,
    payload,
  };

  savePrintHistory([entry, ...history]);
  return entry;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripEscPosCommands(buffer) {
  const output = [];

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    const next = buffer[i + 1];

    if (byte === 0x1b) {
      if ([0x40, 0x45, 0x61, 0x74, 0x21, 0x4d, 0x33, 0x20].includes(next)) {
        i += next === 0x40 ? 1 : 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (byte === 0x1d) {
      if ([0x21, 0x56, 0x42, 0x48, 0x68, 0x77].includes(next)) {
        i += next === 0x56 ? 2 : 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (byte === 0x0a || byte === 0x0d || byte >= 0x20) {
      output.push(byte);
    }
  }

  return Buffer.from(output);
}

function normalizeTicketText(text) {
  return text
    .replace(/\x80/g, "EUR")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{4,}$/g, "\n");
}

function getTicketPrintableText(payload) {
  if (!payload) return "";

  const directText =
    payload.text ||
    payload.ticketText ||
    payload.content ||
    payload.printableText ||
    payload.rawText;

  if (directText) return normalizeTicketText(String(directText));

  if (!payload.dataFormatESCPOS) return "";

  try {
    const printableBuffer = stripEscPosCommands(
      Buffer.from(payload.dataFormatESCPOS, "base64")
    );
    return normalizeTicketText(printableBuffer.toString("latin1"));
  } catch {
    return "";
  }
}

function buildTicketPdfHtml(entry) {
  const payload = entry.payload || {};
  const ticketText = getTicketPrintableText(payload);

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page {
            margin: 0;
          }
          body {
            margin: 0;
            background: #f3f4f6;
            color: #111827;
          }
          .page {
            width: 80mm;
            min-height: 100vh;
            margin: 0 auto;
            background: #ffffff;
            padding: 6mm 5mm;
            box-sizing: border-box;
          }
          pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            font-family: "Consolas", "Courier New", monospace;
            font-size: 11px;
            line-height: 1.28;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <pre>${escapeHtml(ticketText || "Ticket vide ou non lisible.")}</pre>
        </div>
      </body>
    </html>
  `;
}

async function openTicketPdf(historyId) {
  const history = getPrintHistory();
  const entry = history.find((ticket) => ticket.id === historyId);

  if (!entry) {
    throw new Error("Ticket introuvable dans l'historique");
  }

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
    },
  });

  try {
    const html = buildTicketPdfHtml(entry);
    await pdfWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );
    const pdf = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      marginsType: 0,
      pageSize: "A4",
    });
    const safeId = entry.id.replace(/[^a-zA-Z0-9-_]/g, "-");
    const pdfPath = path.join(app.getPath("temp"), `smarteat-ticket-${safeId}.pdf`);
    await fs.promises.writeFile(pdfPath, pdf);
    await shell.openPath(pdfPath);
    return { success: true, pdfPath };
  } finally {
    pdfWindow.destroy();
  }
}

async function printTicketPayload(payload) {
  const savedPrinters = store.get("printers", []);
  const ticketType = payload.ticketType;
  const activePrinters = savedPrinters.filter(
    (printer) => printer.ticketTypes?.[ticketType]
  );
  const printTasks = [];

  activePrinters.forEach((printer) => {
    const activeProtocols = Object.entries(printer.protocols || {})
      .filter(([_, enabled]) => enabled)
      .map(([protocol]) => protocol);

    activeProtocols.forEach((activeProtocol) => {
      if (printer.connectionType === "bluetooth") {
        printTasks.push(
          printBluetooth(printer, payload.dataFormatESCPOS, activeProtocol)
        );
        return;
      }

      if (printer.connectionType === "usb") {
        printTasks.push(printUsb(printer, payload.dataFormatESCPOS, activeProtocol));
        return;
      }

      if (printer.connectionType === "local") {
        printTasks.push(
          printLocal(printer, payload.dataFormatESCPOS, activeProtocol)
        );
        return;
      }

      const port = parseInt(activeProtocol, 10);
      if (port === 9100) {
        printTasks.push(printESCPOS(printer.ip, payload.dataFormatESCPOS));
      }
    });
  });

  await Promise.all(printTasks);

  return {
    printerCount: activePrinters.length,
    protocolCount: printTasks.length,
  };
}

ipcMain.handle("get-print-history", () => {
  return getPrintHistory();
});

ipcMain.handle("reprint-ticket", async (_, historyId) => {
  const history = getPrintHistory();
  const entry = history.find((ticket) => ticket.id === historyId);

  if (!entry) {
    throw new Error("Ticket introuvable dans l'historique");
  }

  try {
    const result = await printTicketPayload(entry.payload);
    const historyEntry = addPrintHistoryEntry(entry.payload, {
      success: true,
      ...result,
    });
    return { success: true, historyEntry };
  } catch (error) {
    const historyEntry = addPrintHistoryEntry(entry.payload, {
      success: false,
      error: error.message,
    });
    throw new Error(historyEntry.error);
  }
});

ipcMain.handle("open-ticket-pdf", async (_, historyId) => {
  return openTicketPdf(historyId);
});

ipcMain.handle("print-job", async (_, job) => {
  try {
    const result = await printTicketPayload(job);
    const historyEntry = addPrintHistoryEntry(job, {
      success: true,
      ...result,
    });
    return { success: true, historyEntry };
  } catch (error) {
    const historyEntry = addPrintHistoryEntry(job, {
      success: false,
      error: error.message,
    });
    return { success: false, error: error.message, historyEntry };
  }
});

ipcMain.on("test-printer", (event, config) => {
  console.log("🧾 Test d’impression reçu :", config);

  const savedPrinters = store.get("printers", []);
  const currentPrinter = savedPrinters.find(
    (x) => x.id === config.id || x.ip === config.ip
  );

  console.log("🧾 Current Testing Printer", currentPrinter);

  if (!currentPrinter) {
    event.reply("test-printer-response", {
      success: false,
      message: "Imprimante introuvable dans la configuration",
    });
    return;
  }

  if (currentPrinter.connectionType === "bluetooth") {
    testBluetoothPrinter(currentPrinter)
      .then(() => {
        event.reply("test-printer-response", {
          success: true,
          message: `Test Bluetooth envoye a ${currentPrinter.name}`,
        });
      })
      .catch((err) => {
        event.reply("test-printer-response", {
          success: false,
          message: err.message,
        });
      });
    return;
  }

  if (currentPrinter.connectionType === "usb") {
    testUsbPrinter(currentPrinter)
      .then(() => {
        event.reply("test-printer-response", {
          success: true,
          message: `Test USB envoye a ${currentPrinter.name}`,
        });
      })
      .catch((err) => {
        event.reply("test-printer-response", {
          success: false,
          message: err.message,
        });
      });
    return;
  }

  if (currentPrinter.connectionType === "local") {
    testLocalPrinter(currentPrinter)
      .then(() => {
        event.reply("test-printer-response", {
          success: true,
          message: `Test local envoye a ${currentPrinter.name}`,
        });
      })
      .catch((err) => {
        event.reply("test-printer-response", {
          success: false,
          message: err.message,
        });
      });
    return;
  }

  const activePorts = Object.entries(currentPrinter.protocols)
    .filter(([_, enabled]) => enabled)
    .map(([port]) => parseInt(port, 10));

  console.log(
    `🎯 Protocoles actifs pour ${currentPrinter.ip}:`,
    activePorts.join(", ")
  );

  // Tester chaque port activé
  activePorts.forEach(async (port) => {
    if (port === 9100) {
      await testEscPos(currentPrinter.ip);
    } else if (port === 515) {
      await printLpr(currentPrinter.ip);
    } else if (port === 631) {
      await printIpp(currentPrinter.ip);
    } else if (port === 80) {
      await printHttp(currentPrinter.ip);
    } else {
      const client = new net.Socket();

      client.connect(port, currentPrinter.ip, () => {
        console.log(`✅ Connexion établie à ${currentPrinter.ip}:${port}`);
        client.write("Test d'impression SmartEat\n\n\n");
        client.write(Buffer.from([0x1d, 0x56, 0x00])); // cut command ESC/POS
        client.destroy();

        event.reply("test-printer-response", {
          success: true,
          message: `Test envoyé à ${currentPrinter.ip}:${port}`,
        });
      });

      client.on("error", (err) => {
        console.error(
          `❌ Erreur sur ${currentPrinter.ip}:${port} →`,
          err.message
        );
        // event.reply("test-printer-response", {
        //   success: false,
        //   message: `Erreur sur ${currentPrinter.ip}:${port} → ${err.message}`,
        // });
      });
    }
  });
});

async function testBluetoothPrinter(printer) {
  const text = Buffer.from("Test d'impression SmartEat Bluetooth\n\n", "utf8");
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  const payload = Buffer.concat([text, cut]).toString("base64");
  await printBluetooth(printer, payload);
}

async function testUsbPrinter(printer) {
  const text = Buffer.from("Test d'impression SmartEat USB\n\n", "utf8");
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  const payload = Buffer.concat([text, cut]).toString("base64");
  await printUsb(printer, payload);
}

async function testLocalPrinter(printer) {
  const text = Buffer.from("Test d'impression SmartEat Local ESC/POS\n\n", "utf8");
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  const payload = Buffer.concat([text, cut]).toString("base64");
  await printLocal(printer, payload);
}

/**
 * Impression via IPP (port 631)
 */
async function printIpp(ip) {
  return new Promise((resolve, reject) => {
    const printer = ipp.Printer(`http://${ip}:631/ipp/print`);
    const msg = {
      "operation-attributes-tag": {
        "requesting-user-name": "SmartEat",
        "document-format": "text/plain",
      },
      data: Buffer.from("Test SmartEat via IPP\n\n"),
    };

    printer.execute("Print-Job", msg, (err, res) => {
      if (err) {
        console.error("❌ IPP error:", err.message);
        reject(err);
      } else {
        console.log("✅ IPP OK:", res.statusCode || "OK");
        resolve();
      }
    });
  });
}

async function printHttp(ip) {
  try {
    const xml = `
      <epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
        <text>Test SmartEat via HTTP</text>
        <cut />
      </epos-print>
    `;

    const url = `http://${ip}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=6000`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: xml,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`✅ HTTP ePOS-Print OK sur ${ip}`);
  } catch (err) {
    console.error("❌ HTTP ePOS error:", err.message);
    throw err;
  }
}

async function printLpr(ip) {
  console.log(`LPR non implemente pour ${ip}`);
}

async function testEscPos(ip) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    client.connect(9100, ip, () => {
      console.log(`✅ ESC/POS connecté à ${ip}:9100`);
      client.write("Test d'impression SmartEat\n\n");
      client.write(Buffer.from([0x1d, 0x56, 0x00])); // CUT
      client.end();
      resolve();
    });

    client.on("error", (err) => {
      console.error("❌ ESC/POS error:", err.message);
      reject(err);
    });
  });
}

const appServer = express();
appServer.use(bodyParser.json());
appServer.use(bodyParser.urlencoded({ extended: true }));
const cors = require("cors");
appServer.use(cors({ origin: "*" }));

// Fonction utilitaire pour récupérer l’IP locale
function getLocalIP() {
  const nets = os.networkInterfaces();
  console.log("Networks Available", nets);
  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name]) {
      if (netInfo.family === "IPv4" && !netInfo.internal) {
        if (netInfo.address.startsWith("192.")) return netInfo.address;
      }
    }
  }
  return "127.0.0.1";
}

const localIP = getLocalIP();
const PORT = 8989; // Port de ton agent local
const BASE_URL = `http://${localIP}:${PORT}`;

// ———————————————————————————————
// 🧩 ENDPOINT 1 — Test (ping)
// ———————————————————————————————
appServer.get("/test", (req, res) => {
  console.log("✅ Ping reçu sur /test");
  testPrinter();
  res.json({ status: "ok", ip: localIP, message: "SmartEat Agent en ligne" });
});

// ———————————————————————————————
// 🖨️ ENDPOINT 2 — Impression
// ———————————————————————————————
appServer.post("/print", async (req, res) => {
  try {
    const result = await printTicketPayload(req.body);
    const historyEntry = addPrintHistoryEntry(req.body, {
      success: true,
      ...result,
    });

    console.log("TEXT a Imprimer", req.body);
    res.json({
      success: true,
      historyEntry,
      message: `Impression envoyee a ${result.protocolCount} protocole(s)`,
    });
  } catch (err) {
    const historyEntry = addPrintHistoryEntry(req.body, {
      success: false,
      error: err.message,
    });
    console.error("Erreur impression:", err.message);
    res.status(500).json({ success: false, error: err.message, historyEntry });
  }
});

appServer.post("/print-legacy", async (req, res) => {
  const savedPrinters = store.get("printers", []);
  const tickeType = req.body.ticketType;
  const activedPrinters = savedPrinters.filter((x) => x.ticketTypes[tickeType]);

  activedPrinters.forEach((printer) => {
    let activePortocols = Object.entries(printer.protocols)
      .filter(([_, enabled]) => enabled)
      .map(([port]) => parseInt(port, 10));

    activePortocols.forEach(async (activeProtocol) => {
      if (activeProtocol === 9100)
        await printESCPOS(printer.ip, req.body.dataFormatESCPOS);
    });
  });
  // console.log(`🖨️ Requête impression reçue pour ${ip}`);
  console.log("TEXT a Imprimer", req.body);
  try {
    // await printESCPOS(ip, text);
    res.json({ success: true, message: `Impression envoyée à ${ip}` });
  } catch (err) {
    console.error("❌ Erreur impression:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ———————————————————————————————
// 🚀 Démarrage du serveur
// ———————————————————————————————
appServer.listen(PORT, () => {
  console.log(`🚀 Serveur SmartEat agent en ligne sur : ${BASE_URL}`);
  console.log("🧭 Endpoints disponibles :");
  console.log(`   • GET  ${BASE_URL}/test`);
  console.log(`   • POST ${BASE_URL}/print`);
});

// ———————————————————————————————
// 🧾 Fonction impression ESC/POS
// ———————————————————————————————
async function printESCPOS(ip, text) {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.from(text, "base64"); //
    const client = new net.Socket();
    client.connect(9100, ip, () => {
      console.log(`✅ Connecté à ${ip}:9100`);
      client.write(buffer);
      client.write(Buffer.from([0x1d, 0x56, 0x00])); // Cut
      client.end();
      resolve();
    });
    client.on("error", reject);
  });
}

async function printBluetooth(printer, base64Data, forcedProtocol = null) {
  const activeProtocols = forcedProtocol
    ? [forcedProtocol]
    : Object.entries(printer.protocols || {})
        .filter(([_, enabled]) => enabled)
        .map(([protocol]) => protocol);

  if (activeProtocols.includes("bluetoothSerial")) {
    if (!printer.portName) {
      throw new Error(`Aucun port COM Bluetooth configure pour ${printer.name}`);
    }
    await printBluetoothSerial(
      normalizeSerialPortName(printer.portName, printer.realPortName),
      base64Data
    );
  }

  if (activeProtocols.includes("bluetoothWindowsSpooler")) {
    if (!printer.printerName) {
      throw new Error(`Aucune file Windows configuree pour ${printer.name}`);
    }
    await printWindowsRaw(printer.printerName, base64Data);
  }
}

async function printUsb(printer, base64Data, forcedProtocol = null) {
  const activeProtocols = forcedProtocol
    ? [forcedProtocol]
    : Object.entries(printer.protocols || {})
        .filter(([_, enabled]) => enabled)
        .map(([protocol]) => protocol);

  if (activeProtocols.includes("usbSerial")) {
    if (!printer.portName) {
      throw new Error(`Aucun port COM USB configure pour ${printer.name}`);
    }
    await printBluetoothSerial(
      normalizeSerialPortName(printer.portName, printer.realPortName),
      base64Data
    );
  }

  if (activeProtocols.includes("usbWindowsSpooler")) {
    if (!printer.printerName) {
      throw new Error(`Aucune file Windows configuree pour ${printer.name}`);
    }
    await printWindowsRaw(printer.printerName, base64Data);
  }
}

async function printLocal(printer, base64Data, forcedProtocol = null) {
  const activeProtocols = forcedProtocol
    ? [forcedProtocol]
    : Object.entries(printer.protocols || {})
        .filter(([_, enabled]) => enabled)
        .map(([protocol]) => protocol);

  if (activeProtocols.includes("localSerial")) {
    if (!printer.portName) {
      throw new Error(`Aucun port local configure pour ${printer.name}`);
    }
    const portName = normalizeSerialPortName(
      printer.portName.replace(/:$/, ""),
      printer.realPortName
    );
    await printBluetoothSerial(portName, base64Data);
  }

  if (activeProtocols.includes("localWindowsSpooler")) {
    if (!printer.printerName) {
      throw new Error(`Aucune file Windows configuree pour ${printer.name}`);
    }
    await printWindowsRaw(printer.printerName, base64Data);
  }
}

async function printBluetoothSerial(portName, base64Data) {
  const serialPortName = normalizeSerialPortName(portName);
  const script = `
    $bytes = [Convert]::FromBase64String($env:SMARTEAT_PRINT_BASE64)
    $port = New-Object System.IO.Ports.SerialPort $env:SMARTEAT_COM_PORT, 9600, None, 8, One
    $port.WriteTimeout = 5000
    $port.Open()
    try {
      $port.Write($bytes, 0, $bytes.Length)
    } finally {
      $port.Close()
      $port.Dispose()
    }
  `;

  await runPowerShell(script, {
    SMARTEAT_COM_PORT: serialPortName,
    SMARTEAT_PRINT_BASE64: base64Data,
  });
}

async function printWindowsRaw(printerName, base64Data) {
  const script = `
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "SmartEat RAW Ticket";
    di.pDataType = "RAW";

    IntPtr hPrinter;
    int written;
    bool success = false;
    if (OpenPrinter(printerName.Normalize(), out hPrinter, IntPtr.Zero)) {
      if (StartDocPrinter(hPrinter, 1, di)) {
        if (StartPagePrinter(hPrinter)) {
          success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
          EndPagePrinter(hPrinter);
        }
        EndDocPrinter(hPrinter);
      }
      ClosePrinter(hPrinter);
    }
    Marshal.FreeCoTaskMem(pUnmanagedBytes);
    return success;
  }
}
"@

    $bytes = [Convert]::FromBase64String($env:SMARTEAT_PRINT_BASE64)
    $ok = [RawPrinterHelper]::SendBytesToPrinter($env:SMARTEAT_PRINTER_NAME, $bytes)
    if (-not $ok) { throw "Impossible d'envoyer le ticket RAW a la file Windows." }
  `;

  await runPowerShell(script, {
    SMARTEAT_PRINTER_NAME: printerName,
    SMARTEAT_PRINT_BASE64: base64Data,
  });
}

ipcMain.handle("get-target-config", async () => {
  const config = {
    targetIp: localIP,
    targetPort: PORT,
    targetBaseUrl: BASE_URL,
  };
  console.log("Config IP TArget", config);
  return config;
});

ipcMain.handle("get-user-session", async () => {
  const session = store.get("userSession", null);
  return session;
});
ipcMain.handle("set-user-session", (event, session) => {
  console.log("Setting User Session", session);
  store.set("userSession", session);
  console.log("💾 Session utilisateur sauvegardée :", session);
});
