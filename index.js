const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const bonjour = require("bonjour")();
const Store = require("electron-store");
const baseDir = app.isPackaged
  ? path.dirname(app.getPath("exe")) // dossier de l'exe
  : process.cwd();

console.log("Base Directory for Store:", baseDir);
const store = new (Store.default || Store)({
  cwd: baseDir,
  name: "settings",
});

const net = require("net");
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

// -------------------------------------------------------------
// 🪟 Fenêtre principale
// -------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
  } else {
    console.log(
      "file fronted",
      path.join(__dirname, "frontend/dist/index.html")
    );
    win.loadFile(path.join(__dirname, "frontend/dist/index.html"));
  }
}
app.setLoginItemSettings({
  openAtLogin: true,
});
app.whenReady().then(() => {
  console.log("📦 Contenu complet du Store au démarrage:");
  console.log(JSON.stringify(store.store, null, 2));
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
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

// 📂 Lecture des préférences sauvegardées
ipcMain.handle("get-saved-printers", () => {
  const savedPrinters = store.get("printers", []);
  return savedPrinters;
});
// -------------------------------------------------------------
// 📡 Communication avec le front-end (printer.html)
// -------------------------------------------------------------
ipcMain.handle("discover-printers", async () => {
  const printers = await discoverNetworkPrinters();
  return printers;
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

ipcMain.on("test-printer", (event, config) => {
  console.log("🧾 Test d’impression reçu :", config);

  const savedPrinters = store.get("printers", []);
  const currentPrinter = savedPrinters.find((x) => x.ip === config.ip);

  console.log("🧾 Current Testing Printer", currentPrinter);

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
