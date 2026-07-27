<template>
  <div class="main-content">
    <div class="card">
      <h1>Mes imprimantes</h1>
      <button id="reload-btn" @click="loadPrinters">
        Recharger la liste
      </button>

      <div v-if="loading" class="printer-list">
        <p class="no-printer">Recherche d'imprimantes reseau, Bluetooth et USB...</p>
      </div>

      <div v-else-if="printers.length === 0" class="printer-list">
        <p class="no-printer">Aucune imprimante trouvee</p>
      </div>

      <div v-else id="printer-list" class="printer-list">
        <div
          v-for="printer in printers"
          :key="printer.id"
          class="printer-card"
          :class="getConnectionCardClass(printer)"
        >
          <div class="printer-header">
            <div>
              <div class="printer-name">
                {{ printer.name || "Imprimante inconnue" }}
              </div>
              <div class="connection-type">
                {{ getConnectionLabel(printer) }}
              </div>
            </div>
            <div class="printer-status">
              <div
                class="status-dot"
                :class="printer.online ? 'online' : 'offline'"
              ></div>
              <span>{{ printer.online ? "Disponible" : "Indisponible" }}</span>
            </div>
          </div>

          <div class="printer-info">
            <template v-if="printer.connectionType === 'bluetooth'">
              <b>Port COM :</b> {{ printer.portName || "-" }}<br />
              <b>File Windows :</b> {{ printer.printerName || "-" }}<br />
              <b>Driver :</b> {{ printer.driverName || printer.description || "-" }}<br />
              <b>Type :</b> {{ printer.protocol || "bluetooth" }}
            </template>
            <template v-else-if="printer.connectionType === 'usb'">
              <b>Port USB/COM :</b> {{ printer.portName || "-" }}<br />
              <b>File Windows :</b> {{ printer.printerName || "-" }}<br />
              <b>Driver :</b> {{ printer.driverName || printer.description || "-" }}<br />
              <b>Type :</b> {{ printer.protocol || "usb" }}
            </template>
            <template v-else>
              <b>IP :</b> {{ printer.ip || "-" }}<br />
              <b>Port Bonjour :</b> {{ printer.port || "-" }}<br />
              <b>Modele :</b> {{ printer.model || printer.product || "-" }}<br />
              <b>Type :</b> {{ printer.type || "-" }}
            </template>
          </div>

          <div class="sections-row">
            <div class="section-block">
              <h4>Types de ticket</h4>

              <div class="toggle-line">
                <span>Ticket de caisse</span>
                <label class="switch">
                  <input
                    type="checkbox"
                    @change="savePrinterConfig"
                    v-model="printer.ticketTypes.caisse"
                  />
                  <span class="slider"></span>
                </label>
              </div>

              <div class="toggle-line">
                <span>Ticket de cuisine</span>
                <label class="switch">
                  <input
                    type="checkbox"
                    @change="savePrinterConfig"
                    v-model="printer.ticketTypes.cuisine"
                  />
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <div class="section-block">
              <h4>Protocoles de communication</h4>
              <div
                class="toggle-line"
                v-for="proto in getProtocolsForPrinter(printer)"
                :key="proto.key"
              >
                <span>{{ proto.label }}</span>
                <label class="switch">
                  <input
                    type="checkbox"
                    @change="savePrinterConfig"
                    v-model="printer.protocols[proto.key]"
                    :disabled="!proto.available"
                  />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </div>

          <button class="btn-print-selected" @click="testPrinter(printer)">
            Test impression
          </button>
        </div>
      </div>
    </div>
    <pre type="json">{{ printers }}</pre>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
const { ipcRenderer } = window.require("electron");

const printers = ref([]);
const loading = ref(true);

const networkProtocols = [
  { label: "ESC/POS (9100)", key: "9100" },
  { label: "IPP (631)", key: "631" },
  { label: "LPR/IPP (515)", key: "515" },
  { label: "HTTP ePOS (80)", key: "80" },
];

const bluetoothProtocols = [
  { label: "Bluetooth ESC/POS (port COM)", key: "bluetoothSerial" },
  { label: "File d'impression Windows", key: "windowsSpooler" },
];

const usbProtocols = [
  { label: "USB ESC/POS (port COM)", key: "usbSerial" },
  { label: "File d'impression Windows", key: "windowsSpooler" },
];

function getConnectionLabel(printer) {
  if (printer.connectionType === "bluetooth") return "Bluetooth Windows";
  if (printer.connectionType === "usb") return "USB Windows";
  return "Reseau";
}

function getConnectionCardClass(printer) {
  if (printer.connectionType === "bluetooth") return "bluetooth-card";
  if (printer.connectionType === "usb") return "usb-card";
  return "network-card";
}

function getProtocolsForPrinter(printer) {
  let protocols = networkProtocols;
  if (printer.connectionType === "bluetooth") protocols = bluetoothProtocols;
  if (printer.connectionType === "usb") protocols = usbProtocols;

  return protocols.map((protocol) => ({
    ...protocol,
    available: printer.availableProtocols?.[protocol.key] !== false,
  }));
}

async function updateStatus(printer) {
  try {
    if (printer.connectionType === "bluetooth") {
      printer.online = await ipcRenderer.invoke(
        "check-bluetooth-printer-online",
        JSON.parse(JSON.stringify(printer))
      );
    } else if (printer.connectionType === "usb") {
      printer.online = await ipcRenderer.invoke(
        "check-usb-printer-online",
        JSON.parse(JSON.stringify(printer))
      );
    } else {
      printer.online = await ipcRenderer.invoke("check-printer-online", {
        ip: printer.ip,
        port: printer.port || 9100,
      });
    }
  } catch (e) {
    printer.online = false;
  }

  setTimeout(() => updateStatus(printer), 10000);
}

function savePrinterConfig() {
  const data = JSON.parse(JSON.stringify(printers.value));
  ipcRenderer.send("save-printer-config", data);
}

function testPrinter(printer) {
  const config = { id: printer.id, ip: printer.ip };
  ipcRenderer.send("test-printer", config);
}

function findSavedConfig(saved, printer) {
  return saved.find((savedPrinter) => {
    return (
      savedPrinter.id === printer.id ||
      (printer.ip && savedPrinter.ip === printer.ip) ||
      (printer.portName && savedPrinter.portName === printer.portName) ||
      (printer.printerName && savedPrinter.printerName === printer.printerName)
    );
  });
}

function buildDefaultProtocols(printer, savedCfg) {
  if (savedCfg?.protocols) return savedCfg.protocols;

  if (printer.connectionType === "bluetooth") {
    return {
      bluetoothSerial: false,
      windowsSpooler: false,
    };
  }

  if (printer.connectionType === "usb") {
    return {
      usbSerial: false,
      windowsSpooler: false,
    };
  }

  return {
    9100: false,
    631: false,
    515: false,
    80: false,
  };
}

async function loadPrinters() {
  loading.value = true;
  printers.value = [];

  try {
    const saved = await ipcRenderer.invoke("get-saved-printers");
    const discovered = await ipcRenderer.invoke("discover-printers");

    printers.value = discovered.map((printer) => {
      const savedCfg = findSavedConfig(saved, printer);

      return {
        ...printer,
        id: printer.id || printer.ip || Math.random().toString(36).slice(2),
        online: false,
        ticketTypes: savedCfg?.ticketTypes || { caisse: false, cuisine: false },
        protocols: buildDefaultProtocols(printer, savedCfg),
        availableProtocols: printer.availableProtocols || {},
      };
    });

    for (const printer of printers.value) updateStatus(printer);
    savePrinterConfig();
  } catch (e) {
    console.error("Erreur decouverte imprimantes:", e);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadPrinters();
});
</script>

<style scoped>
.printer-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 25px;
}

.printer-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
  border-left: 5px solid #3498db;
  position: relative;
}

.bluetooth-card {
  border-left-color: #8e44ad;
}

.usb-card {
  border-left-color: #f39c12;
}

.network-card {
  border-left-color: #3498db;
}

.printer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.printer-name {
  font-weight: 600;
  font-size: 18px;
  color: #1e293b;
}

.connection-type {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.printer-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #555;
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background-color: #ccc;
}

.online {
  background-color: #2ecc71;
}

.offline {
  background-color: #e74c3c;
}

.printer-info {
  margin-top: 10px;
  font-size: 14px;
  color: #555;
  line-height: 1.5em;
}

.sections-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 15px;
}

.section-block {
  flex: 1;
  min-width: 220px;
  background: #f8fafc;
  border-radius: 8px;
  padding: 10px 12px;
}

.section-block h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #334155;
}

.toggle-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding: 6px 4px;
  border-radius: 6px;
}

.toggle-line span {
  font-size: 14px;
  color: #2c3e50;
}

.switch {
  font-size: 17px;
  position: relative;
  display: inline-block;
  width: 62px;
  height: 35px;
  flex: 0 0 auto;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0px;
  background: #fff;
  transition: 0.4s;
  border-radius: 30px;
  border: 1px solid #ccc;
}

.slider:before {
  position: absolute;
  content: "";
  height: 1.9em;
  width: 1.9em;
  border-radius: 16px;
  left: 1.2px;
  top: 0;
  bottom: 0;
  background-color: white;
  box-shadow: 0 2px 5px #999999;
  transition: 0.4s;
}

input:checked + .slider {
  background-color: #5fdd54;
  border: 1px solid transparent;
}

input:checked + .slider:before {
  transform: translateX(1.5em);
}

input:disabled + .slider {
  cursor: not-allowed;
  opacity: 0.5;
}

.btn-print-selected {
  margin-top: 15px;
  background-color: #16a085;
  border: none;
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s ease;
}

.btn-print-selected:hover {
  background-color: #13856c;
}

#reload-btn {
  background-color: #3498db;
  border: none;
  color: #fff;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 15px;
  transition: background 0.2s;
  margin-bottom: 10px;
}

#reload-btn:hover {
  background-color: #2980b9;
}

.no-printer {
  background: #f8fafc;
  border: 1px dashed #ccc;
  padding: 15px;
  border-radius: 10px;
  text-align: center;
  color: #888;
}
</style>
