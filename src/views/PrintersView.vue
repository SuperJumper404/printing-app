<template>
  <div class="main-content">
    <div class="card">
      <h1>🖨️ Mes imprimantes réseau</h1>
      <button id="reload-btn" @click="loadPrinters">
        🔄 Recharger la liste
      </button>

      <div v-if="loading" class="printer-list">
        <p class="no-printer">🔍 Recherche d’imprimantes...</p>
      </div>

      <div v-else-if="printers.length === 0" class="printer-list">
        <p class="no-printer">❌ Aucune imprimante trouvée</p>
      </div>

      <div v-else id="printer-list" class="printer-list">
        <div v-for="printer in printers" :key="printer.id" class="printer-card">
          <div class="printer-header">
            <div class="printer-name">
              {{ printer.name || "Imprimante inconnue" }}
            </div>
            <div class="printer-status">
              <div
                class="status-dot"
                :class="printer.online ? 'online' : 'offline'"
              ></div>
              <span>{{ printer.online ? "En ligne" : "Hors ligne" }}</span>
            </div>
          </div>

          <div class="printer-info">
            🌐 <b>IP :</b> {{ printer.ip || "—" }}<br />
            🔌 <b>Port (Bonjour) :</b> {{ printer.port || "—" }}<br />
            🏷️ <b>Modèle :</b> {{ printer.model || printer.product || "—"
            }}<br />
            🧠 <b>Type :</b> {{ printer.type || "—" }}
          </div>

          <div class="sections-row">
            <div class="section-block">
              <h4>🎫 Types de ticket</h4>

              <div class="toggle-line">
                <span>Ticket de caisse</span>
                <label class="switch">
                  <input
                    type="checkbox"
                    @change="savePrinterConfig()"
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
                    @change="savePrinterConfig()"
                    v-model="printer.ticketTypes.cuisine"
                  />
                  <span class="slider"></span>
                </label>
              </div>
            </div>

            <div class="section-block">
              <h4>⚙️ Protocoles</h4>
              <div
                class="toggle-line"
                v-for="proto in protocols"
                :key="proto.port"
              >
                <span>{{ proto.label }}</span>
                <label class="switch">
                  <input
                    type="checkbox"
                    @change="savePrinterConfig()"
                    v-model="printer.protocols[proto.port]"
                  />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </div>

          <button class="btn-print-selected" @click="testPrinter(printer)">
            🖨️ Test impression
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

const protocols = [
  { label: "ESC/POS (9100)", port: 9100 },
  { label: "IPP (631)", port: 631 },
  { label: "LPR/IPP (515)", port: 515 },
  { label: "HTTP (80)", port: 80 },
];

async function updateStatus(printer) {
  try {
    const online = await ipcRenderer.invoke("check-printer-online", {
      ip: printer.ip,
      port: printer.port || 9100,
    });
    printer.online = online;
  } catch (e) {
    printer.online = false;
  }

  // Rafraîchissement périodique
  setTimeout(() => updateStatus(printer), 10000);
}

function savePrinterConfig() {
  const data = JSON.parse(JSON.stringify(this.printers)); // ✅ retire les proxies Vue
  ipcRenderer.send("save-printer-config", data);
}

function testPrinter(printer) {
  const config = { ip: printer.ip };
  ipcRenderer.send("test-printer", config);
}

async function loadPrinters() {
  loading.value = true;
  printers.value = [];

  try {
    const saved = await ipcRenderer.invoke("get-saved-printers");
    const discovered = await ipcRenderer.invoke("discover-printers");

    printers.value = discovered.map((p) => {
      const savedCfg = saved.find((s) => s.ip === p.ip);
      return {
        ...p,
        id: p.ip || Math.random().toString(36).slice(2),
        online: false,
        ticketTypes: savedCfg?.ticketTypes || { caisse: false, cuisine: false },
        protocols: savedCfg?.protocols || {
          9100: false,
          631: false,
          515: false,
          80: false,
        },
      };
    });

    for (const prt of printers.value) updateStatus(prt);
  } catch (e) {
    console.error("Erreur découverte imprimantes:", e);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  await loadPrinters();
});
</script>

<style scoped>
/* -- Styles identiques à ton design préféré -- */

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

.printer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.printer-name {
  font-weight: 600;
  font-size: 18px;
  color: #1e293b;
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
  margin-top: 8px;
  padding: 6px 4px;
  border-radius: 6px;
}

.toggle-line span {
  font-size: 14px;
  color: #2c3e50;
}

/* SWITCH */
.switch {
  font-size: 17px;
  position: relative;
  display: inline-block;
  width: 62px;
  height: 35px;
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
