<template>
  <div class="main-content">
    <div class="card">
      <h1>Mes imprimantes</h1>
      <div class="toolbar-row">
        <button id="reload-btn" @click="loadPrinters(true)">
          Recharger la liste
        </button>
        <label class="filter-toggle">
          <input
            type="checkbox"
            v-model="useDiscoveryFilters"
            @change="loadPrinters(true)"
          />
          <span>Recherche avec filtre</span>
        </label>
      </div>

      <div v-if="loading" class="printer-list">
        <div class="loading-state">
          <div class="spinner" aria-hidden="true"></div>
          <p class="no-printer">Recherche d'imprimantes reseau, Bluetooth, USB et locales...</p>
        </div>
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
            <template v-else-if="printer.connectionType === 'local'">
              <b>Port local :</b> {{ printer.portName || "-" }}<br />
              <b>Port reel :</b> {{ printer.realPortName || "-" }}<br />
              <b>Port utilise :</b> {{ printer.effectivePortName || printer.portName || "-" }}<br />
              <b>File Windows :</b> {{ printer.printerName || "-" }}<br />
              <b>Driver :</b> {{ printer.driverName || printer.description || "-" }}<br />
              <b>Type :</b> {{ printer.protocol || "local" }}
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
import { ref, onMounted, onBeforeUnmount } from "vue";
const { ipcRenderer } = window.require("electron");

let cachedPrinters = null;
let cachedUseDiscoveryFilters = true;
const statusTimers = new Set();

const printers = ref(cachedPrinters ? clone(cachedPrinters) : []);
const loading = ref(!cachedPrinters);
const useDiscoveryFilters = ref(cachedUseDiscoveryFilters);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function updatePrinterCache() {
  cachedPrinters = clone(printers.value);
  cachedUseDiscoveryFilters = useDiscoveryFilters.value;
}

const networkProtocols = [
  { label: "ESC/POS (9100)", key: "9100" },
  { label: "IPP (631)", key: "631" },
  { label: "LPR/IPP (515)", key: "515" },
  { label: "HTTP ePOS (80)", key: "80" },
];

const bluetoothProtocols = [
  { label: "Bluetooth ESC/POS (port COM)", key: "bluetoothSerial" },
  { label: "File d'impression Windows (Bluetooth)", key: "bluetoothWindowsSpooler" },
];

const usbProtocols = [
  { label: "USB ESC/POS (port COM)", key: "usbSerial" },
  { label: "File d'impression Windows (USB)", key: "usbWindowsSpooler" },
];

const localProtocols = [
  { label: "ESC/POS port local", key: "localSerial" },
  { label: "File d'impression Windows (local)", key: "localWindowsSpooler" },
];

function getConnectionLabel(printer) {
  if (printer.connectionType === "bluetooth") return "Bluetooth Windows";
  if (printer.connectionType === "usb") return "USB Windows";
  if (printer.connectionType === "local") return "Local Windows";
  return "Reseau";
}

function getConnectionCardClass(printer) {
  if (printer.connectionType === "bluetooth") return "bluetooth-card";
  if (printer.connectionType === "usb") return "usb-card";
  if (printer.connectionType === "local") return "local-card";
  return "network-card";
}

function getProtocolsForPrinter(printer) {
  let protocols = networkProtocols;
  if (printer.connectionType === "bluetooth") protocols = bluetoothProtocols;
  if (printer.connectionType === "usb") protocols = usbProtocols;
  if (printer.connectionType === "local") protocols = localProtocols;
  return protocols;
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
    } else if (printer.connectionType === "local") {
      printer.online = await ipcRenderer.invoke(
        "check-local-printer-online",
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

  updatePrinterCache();
  const timer = setTimeout(() => {
    statusTimers.delete(timer);
    updateStatus(printer);
  }, 10000);
  statusTimers.add(timer);
}

function savePrinterConfig() {
  const data = JSON.parse(JSON.stringify(printers.value));
  updatePrinterCache();
  ipcRenderer.send("save-printer-config", data);
}

function testPrinter(printer) {
  const config = { id: printer.id, ip: printer.ip };
  ipcRenderer.send("test-printer", config);
}

function findSavedConfig(saved, printer) {
  const exactMatch = saved.find((savedPrinter) => savedPrinter.id === printer.id);
  if (exactMatch) return exactMatch;

  return saved.find((savedPrinter) => {
    if (savedPrinter.connectionType !== printer.connectionType) return false;

    return (
      (printer.ip && savedPrinter.ip === printer.ip) ||
      (printer.portName && savedPrinter.portName === printer.portName) ||
      (printer.printerName && savedPrinter.printerName === printer.printerName)
    );
  });
}

function buildDefaultProtocols(printer, savedCfg) {
  if (printer.connectionType === "bluetooth") {
    return {
      bluetoothSerial: savedCfg?.protocols?.bluetoothSerial || false,
      bluetoothWindowsSpooler:
        savedCfg?.protocols?.bluetoothWindowsSpooler ||
        (savedCfg?.connectionType === "bluetooth" &&
          savedCfg?.protocols?.windowsSpooler) ||
        false,
    };
  }

  if (printer.connectionType === "usb") {
    return {
      usbSerial: savedCfg?.protocols?.usbSerial || false,
      usbWindowsSpooler:
        savedCfg?.protocols?.usbWindowsSpooler ||
        (savedCfg?.connectionType === "usb" && savedCfg?.protocols?.windowsSpooler) ||
        false,
    };
  }

  if (printer.connectionType === "local") {
    return {
      localSerial: savedCfg?.protocols?.localSerial || false,
      localWindowsSpooler:
        savedCfg?.protocols?.localWindowsSpooler ||
        (savedCfg?.connectionType === "local" &&
          savedCfg?.protocols?.windowsSpooler) ||
        false,
    };
  }

  if (savedCfg?.protocols) return savedCfg.protocols;

  return {
    9100: false,
    631: false,
    515: false,
    80: false,
  };
}

async function loadPrinters(forceDiscovery = false) {
  if (!forceDiscovery && cachedPrinters) {
    printers.value = clone(cachedPrinters);
    loading.value = false;
    return;
  }

  loading.value = true;
  printers.value = [];

  try {
    const saved = await ipcRenderer.invoke("get-saved-printers");
    const discovered = await ipcRenderer.invoke("discover-printers", {
      useFilters: useDiscoveryFilters.value,
    });

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
    updatePrinterCache();
    savePrinterConfig();
  } catch (e) {
    console.error("Erreur decouverte imprimantes:", e);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  const hadCachedPrinters = Boolean(cachedPrinters);
  await loadPrinters(false);
  if (hadCachedPrinters) {
    for (const printer of printers.value) updateStatus(printer);
  }
});

onBeforeUnmount(() => {
  for (const timer of statusTimers) clearTimeout(timer);
  statusTimers.clear();
});
</script>

<style scoped>
.toolbar-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
}

.filter-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #334155;
  cursor: pointer;
}

.filter-toggle input {
  width: 16px;
  height: 16px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 90px;
  color: #475569;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #dbeafe;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex: 0 0 auto;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

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

.local-card {
  border-left-color: #0f766e;
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
