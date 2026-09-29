<template>
  <main class="printers-page">
    <header class="page-header">
      <div>
        <h1>Mes imprimantes</h1>
        <p>{{ printers.length }} appareil{{ printers.length > 1 ? "s" : "" }} detecte{{ printers.length > 1 ? "s" : "" }}</p>
      </div>
      <div class="toolbar-row">
        <button class="button primary" type="button" :disabled="loading" @click="loadPrinters(true)">
          {{ loading ? "Recherche..." : "Recharger" }}
        </button>
        <button class="button neutral" type="button" @click="openDebugConsole">Logs</button>
        <button class="button danger" type="button" :disabled="purging" @click="purgePrinterData">
          {{ purging ? "Purge..." : "Purger" }}
        </button>
      </div>
    </header>

    <section class="discovery-controls" aria-label="Options de recherche">
      <label class="filter-toggle">
        <input v-model="useDiscoveryFilters" type="checkbox" @change="loadPrinters(true)" />
        <span>Filtrer les modeles probables</span>
      </label>
      <div class="mode-controls">
        <span>Sources</span>
        <label><input v-model="discoveryModes.bluetooth" type="checkbox" /> Bluetooth</label>
        <label><input v-model="discoveryModes.usb" type="checkbox" /> USB</label>
        <label><input v-model="discoveryModes.com" type="checkbox" /> COM / Windows</label>
        <label><input v-model="discoveryModes.ipScan" type="checkbox" /> Reseau</label>
      </div>
    </section>

    <form class="manual-printer-form" @submit.prevent="addManualPrinter">
      <div class="field-group address-field">
        <label for="manual-printer-ip">Adresse IP</label>
        <input id="manual-printer-ip" v-model.trim="manualPrinterIp" type="text" placeholder="192.168.1.30" />
      </div>
      <div class="field-group port-field">
        <label for="manual-printer-port">Port</label>
        <input id="manual-printer-port" v-model.number="manualPrinterPort" type="number" min="1" max="65535" />
      </div>
      <button class="button secondary" type="submit" :disabled="addingManualPrinter">
        {{ addingManualPrinter ? "Test..." : "Ajouter par IP" }}
      </button>
    </form>

    <p v-if="pageMessage" class="page-message" role="status" aria-live="polite">{{ pageMessage }}</p>

    <section v-if="loading" class="empty-state" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <p>Recherche des imprimantes et interfaces disponibles...</p>
    </section>

    <section v-else-if="printers.length === 0" class="empty-state">
      <h2>Aucune imprimante detectee</h2>
      <p>Verifiez la connexion USB, Bluetooth, COM ou reseau, puis relancez la recherche.</p>
    </section>

    <section v-else class="printer-list" aria-label="Imprimantes detectees">
      <article v-for="printer in printers" :key="printer.id" class="printer-card">
        <header class="printer-header">
          <div class="printer-title">
            <h2>{{ printer.name || "Imprimante inconnue" }}</h2>
            <span class="availability" :class="{ available: hasAvailableTransport(printer) }">
              <span class="status-dot" aria-hidden="true"></span>
              {{ hasAvailableTransport(printer) ? "Detectee" : "Indisponible" }}
            </span>
          </div>
          <dl class="identity-grid">
            <div><dt>VID / PID</dt><dd>{{ hardwareId(printer) }}</dd></div>
            <div><dt>Serie</dt><dd>{{ printer.serialNumber || "-" }}</dd></div>
            <div><dt>Adresse</dt><dd>{{ printer.addresses?.join(", ") || "-" }}</dd></div>
            <div><dt>Instance</dt><dd :title="printer.instanceIds?.join('\n')">{{ printer.instanceIds?.[0] || "-" }}</dd></div>
          </dl>
        </header>

        <div class="printer-settings">
          <fieldset class="ticket-types">
            <legend>Tickets recus</legend>
            <label>
              <input v-model="printer.ticketTypes.caisse" type="checkbox" @change="savePrinterConfig" />
              Caisse
            </label>
            <label>
              <input v-model="printer.ticketTypes.cuisine" type="checkbox" @change="savePrinterConfig" />
              Cuisine
            </label>
          </fieldset>

          <div class="transport-list">
            <h3>Transports detectes</h3>
            <div v-for="row in visibleTransportRows(printer)" :key="row.id" class="transport-row" :class="{ unavailable: row.controlDisabled }">
              <div class="transport-summary">
                <div>
                  <strong>{{ row.label }}</strong>
                  <span class="transport-family">{{ row.family }}</span>
                  <span v-if="row.reason" class="transport-reason">{{ row.reason }}</span>
                </div>
                <div class="transport-actions">
                  <span v-if="printer.transports[row.id].verified" class="verified">Ticket confirme</span>
                  <span
                    v-else-if="printer.testResults?.[row.id]"
                    class="test-result"
                    :class="printer.testResults[row.id].success ? 'success' : 'failure'"
                  >
                    {{ printer.testResults[row.id].success ? "Envoi accepte" : printer.testResults[row.id].error }}
                  </span>
                  <button
                    v-if="row.id === 'usbRaw'"
                    class="authorize-button"
                    type="button"
                    :disabled="printer.authorizationPending === row.id"
                    @click="authorizeTransport(printer, row.id)"
                  >
                    {{ printer.transports[row.id].config.authorized ? "Reautoriser" : "Autoriser" }}
                  </button>
                  <label class="switch" :title="row.controlDisabled ? row.reason : `Activer ${row.label}`">
                    <input
                      v-model="printer.transports[row.id].enabled"
                      type="checkbox"
                      :disabled="row.controlDisabled"
                      @change="transportChanged(printer, row.id)"
                    />
                    <span class="slider"></span>
                  </label>
                </div>
              </div>

              <details v-if="row.fields.length" class="transport-config">
                <summary>Configuration</summary>
                <div class="config-grid">
                  <label v-for="field in row.fields" :key="field.key">
                    <span>{{ field.label }}</span>
                    <select
                      v-if="field.type === 'select'"
                      v-model="printer.transports[row.id].config[field.key]"
                      :disabled="row.controlDisabled"
                      @change="savePrinterConfig"
                    >
                      <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
                    </select>
                    <input
                      v-else
                      v-model="printer.transports[row.id].config[field.key]"
                      :type="field.type"
                      :min="field.min"
                      :max="field.max"
                      :placeholder="field.placeholder"
                      :disabled="row.controlDisabled"
                      @change="savePrinterConfig"
                    />
                  </label>
                </div>
              </details>
            </div>
          </div>
        </div>

        <footer class="printer-footer">
          <span>{{ enabledTransportCount(printer) }} transport{{ enabledTransportCount(printer) > 1 ? "s" : "" }} actif{{ enabledTransportCount(printer) > 1 ? "s" : "" }}</span>
          <button
            class="button secondary"
            type="button"
            :disabled="!enabledTransportCount(printer) || printer.testing"
            @click="testPrinter(printer)"
          >
            {{ printer.testing ? "Test en cours..." : "Tester les transports actifs" }}
          </button>
        </footer>
      </article>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from "vue";
import {
  TRANSPORT_PRESENTATION,
  createEmptyTransports,
  getTransportRows,
  mergePrinterConfiguration,
} from "../printers/transportPresentation.mjs";
import { authorizeUsbDevice } from "../printers/webUsbTransport";

const { ipcRenderer } = window.require("electron");

window.__smarteatPrinterDiscoveryCache ||= {
  printers: null,
  useDiscoveryFilters: false,
  discoveryModes: { bluetooth: true, usb: true, com: true, ipScan: true },
};

const printerCache = window.__smarteatPrinterDiscoveryCache;
printerCache.discoveryModes ||= { bluetooth: true, usb: true, com: true, ipScan: true };
const printers = ref(printerCache.printers ? clone(printerCache.printers) : []);
const loading = ref(!printerCache.printers);
const useDiscoveryFilters = ref(Boolean(printerCache.useDiscoveryFilters));
const discoveryModes = ref(clone(printerCache.discoveryModes));
const purging = ref(false);
const manualPrinterIp = ref("");
const manualPrinterPort = ref(9100);
const addingManualPrinter = ref(false);
const pageMessage = ref("");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function updatePrinterCache() {
  printerCache.printers = clone(printers.value);
  printerCache.useDiscoveryFilters = useDiscoveryFilters.value;
  printerCache.discoveryModes = clone(discoveryModes.value);
}

function savePrinterConfig() {
  updatePrinterCache();
  ipcRenderer.send("save-printer-config", clone(printers.value));
}

function visibleTransportRows(printer) {
  const rows = getTransportRows(printer).filter((row) => row.available || row.enabled);
  return rows.length ? rows : getTransportRows(printer);
}

function enabledTransportCount(printer) {
  return Object.values(printer.transports || {}).filter((transport) => transport.enabled).length;
}

function hasAvailableTransport(printer) {
  return Object.values(printer.transports || {}).some((transport) => transport.available);
}

function hardwareId(printer) {
  if (!printer.vendorId && !printer.productId) return "-";
  return `${printer.vendorId || "----"} / ${printer.productId || "----"}`;
}

function transportChanged(printer, transportId) {
  if (!printer.transports[transportId].enabled) {
    printer.transports[transportId].verified = false;
  }
  savePrinterConfig();
}

async function authorizeTransport(printer, transportId) {
  printer.authorizationPending = transportId;
  try {
    if (transportId !== "usbRaw") throw new Error("Autorisation non prise en charge");
    const config = await authorizeUsbDevice({
      ...printer.transports[transportId].config,
      vendorId: printer.vendorId || printer.transports[transportId].config.vendorId,
      productId: printer.productId || printer.transports[transportId].config.productId,
      serialNumber: printer.serialNumber || printer.transports[transportId].config.serialNumber,
    });
    printer.transports[transportId].config = { ...config, authorized: true };
    printer.transports[transportId].reason = null;
    pageMessage.value = "Peripherique USB autorise.";
    savePrinterConfig();
  } catch (error) {
    printer.transports[transportId].config.authorized = false;
    printer.transports[transportId].reason = `Autorisation USB requise : ${error.message}`;
    pageMessage.value = printer.transports[transportId].reason;
  } finally {
    printer.authorizationPending = null;
    updatePrinterCache();
  }
}

function findSavedConfig(saved, printer) {
  const exact = saved.find((item) => item.id === printer.id);
  if (exact) return exact;
  return saved.find((item) => {
    if (printer.containerId && item.containerId === printer.containerId) return true;
    if (
      printer.serialNumber &&
      item.serialNumber === printer.serialNumber &&
      item.vendorId === printer.vendorId &&
      item.productId === printer.productId
    ) return true;
    return (printer.addresses || []).some((address) => item.addresses?.includes(address));
  });
}

async function loadPrinters(forceDiscovery = false) {
  if (!forceDiscovery && printerCache.printers) {
    printers.value = clone(printerCache.printers);
    loading.value = false;
    return;
  }
  if (!Object.values(discoveryModes.value).some(Boolean)) {
    printers.value = [];
    pageMessage.value = "Selectionnez au moins une source de recherche.";
    loading.value = false;
    return;
  }

  loading.value = true;
  pageMessage.value = "";
  try {
    const [saved, discovered] = await Promise.all([
      ipcRenderer.invoke("get-saved-printers"),
      ipcRenderer.invoke("discover-printers", {
        useFilters: useDiscoveryFilters.value,
        modes: clone(discoveryModes.value),
      }),
    ]);
    printers.value = discovered.map((printer) => ({
      ...mergePrinterConfiguration(printer, findSavedConfig(saved, printer)),
      testing: false,
      testResults: {},
    }));
    savePrinterConfig();
  } catch (error) {
    console.error("Erreur decouverte imprimantes:", error);
    pageMessage.value = `Recherche impossible : ${error.message}`;
  } finally {
    loading.value = false;
    updatePrinterCache();
  }
}

async function testPrinter(printer) {
  printer.testing = true;
  printer.testResults = {};
  savePrinterConfig();
  try {
    const result = await ipcRenderer.invoke("test-printer-protocols", clone(printer));
    printer.testResults = Object.fromEntries(
      (result.results || []).map((item) => [item.transportId, item]),
    );
    for (const item of result.results || []) {
      if (!item.success) continue;
      const label = TRANSPORT_PRESENTATION.find((entry) => entry.id === item.transportId)?.label || item.transportId;
      printer.transports[item.transportId].verified = window.confirm(
        `Le ticket imprime par ${label} est-il lisible ?`,
      );
    }
    pageMessage.value = result.message || result.error || "Test termine.";
    savePrinterConfig();
  } catch (error) {
    pageMessage.value = `Test impossible : ${error.message}`;
  } finally {
    printer.testing = false;
    updatePrinterCache();
  }
}

function parseManualPrinterAddress(input) {
  const match = String(input || "").trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/);
  if (!match || match[1].split(".").some((part) => Number(part) > 255)) return null;
  return { ip: match[1], port: match[2] ? Number(match[2]) : null };
}

async function addManualPrinter() {
  const address = parseManualPrinterAddress(manualPrinterIp.value);
  const port = Number(address?.port || manualPrinterPort.value || 9100);
  if (!address || port < 1 || port > 65535) {
    pageMessage.value = "Adresse IP ou port invalide.";
    return;
  }
  if (printers.value.some((printer) => printer.addresses?.includes(address.ip))) {
    pageMessage.value = "Cette adresse est deja dans la liste.";
    return;
  }

  addingManualPrinter.value = true;
  try {
    const online = await ipcRenderer.invoke("check-printer-online", { ip: address.ip, port });
    if (!online) {
      pageMessage.value = `Aucun service detecte sur ${address.ip}:${port}.`;
      return;
    }
    const transports = createEmptyTransports();
    const transportId = ({ 631: "ipp", 515: "lpr", 80: "eposHttp" })[port] || "network9100";
    transports[transportId] = {
      available: true,
      enabled: false,
      verified: false,
      config: { host: address.ip, port },
      reason: null,
    };
    printers.value.unshift({
      printerConfigVersion: 2,
      id: `manual-network-${address.ip}-${port}`,
      name: `Imprimante ${address.ip}`,
      addresses: [address.ip],
      instanceIds: [],
      ticketTypes: { caisse: false, cuisine: false },
      transports,
      observations: [],
      testResults: {},
    });
    manualPrinterIp.value = "";
    manualPrinterPort.value = 9100;
    pageMessage.value = `Service detecte sur ${address.ip}:${port}.`;
    savePrinterConfig();
  } catch (error) {
    pageMessage.value = `Ajout impossible : ${error.message}`;
  } finally {
    addingManualPrinter.value = false;
  }
}

async function openDebugConsole() {
  try {
    const result = await ipcRenderer.invoke("open-debug-console");
    pageMessage.value = `Console ouverte : ${result.logPath}`;
  } catch (error) {
    pageMessage.value = `Console indisponible : ${error.message}`;
  }
}

async function purgePrinterData() {
  if (!window.confirm("Supprimer les imprimantes et l'historique d'impression ?")) return;
  purging.value = true;
  try {
    await ipcRenderer.invoke("purge-printer-data");
    printers.value = [];
    printerCache.printers = null;
    pageMessage.value = "Donnees imprimantes purgees.";
  } finally {
    purging.value = false;
  }
}

onMounted(() => loadPrinters(false));
</script>

<style scoped>
.printers-page {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 24px;
  color: #172033;
}

.page-header,
.printer-header,
.printer-footer,
.transport-summary,
.toolbar-row,
.mode-controls,
.manual-printer-form,
.ticket-types {
  display: flex;
  align-items: center;
}

.page-header,
.printer-header,
.printer-footer,
.transport-summary {
  justify-content: space-between;
}

.page-header {
  gap: 24px;
  margin-bottom: 20px;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: 28px;
  line-height: 1.2;
}

.page-header p {
  margin-top: 5px;
  color: #5d6779;
}

.toolbar-row,
.mode-controls,
.ticket-types {
  gap: 10px;
  flex-wrap: wrap;
}

.button {
  min-height: 38px;
  border: 0;
  border-radius: 6px;
  padding: 9px 14px;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 160ms ease-out, box-shadow 160ms ease-out;
}

.button:focus-visible,
input:focus-visible,
select:focus-visible,
summary:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.28);
  outline-offset: 2px;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.primary { background: #2563eb; }
.primary:hover:not(:disabled) { background: #1d4ed8; }
.secondary { background: #087f5b; }
.secondary:hover:not(:disabled) { background: #066a4b; }
.neutral { background: #475569; }
.neutral:hover:not(:disabled) { background: #334155; }
.danger { background: #c53030; }
.danger:hover:not(:disabled) { background: #9f2525; }

.discovery-controls {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px;
  align-items: center;
  padding: 14px 0;
  border-block: 1px solid #d9e0e8;
}

.filter-toggle,
.mode-controls label,
.ticket-types label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}

.mode-controls > span {
  color: #5d6779;
  font-weight: 700;
}

input[type="checkbox"] {
  width: 17px;
  height: 17px;
  accent-color: #087f5b;
}

.manual-printer-form {
  align-items: flex-end;
  gap: 12px;
  margin-top: 18px;
}

.field-group,
.config-grid label {
  display: grid;
  gap: 5px;
}

.field-group label,
.config-grid span {
  color: #465165;
  font-size: 13px;
  font-weight: 700;
}

.address-field { flex: 1 1 240px; }
.port-field { flex: 0 1 110px; }

input,
select {
  min-width: 0;
  border: 1px solid #b8c2cf;
  border-radius: 6px;
  padding: 9px 10px;
  background: #fff;
  color: #172033;
  font: inherit;
}

input:disabled,
select:disabled {
  background: #eef1f5;
  color: #768195;
}

.page-message {
  margin-top: 16px;
  padding: 11px 13px;
  border-radius: 6px;
  background: #eef7f3;
  color: #155e49;
  white-space: pre-line;
}

.empty-state {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 180px;
  margin-top: 24px;
  border: 1px dashed #aeb8c5;
  border-radius: 8px;
  color: #5d6779;
  text-align: center;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #cbd5e1;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 800ms linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.printer-list {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

.printer-card {
  border: 1px solid #d5dde7;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(25, 36, 54, 0.07);
  overflow: hidden;
}

.printer-header,
.printer-settings,
.printer-footer {
  padding: 18px 20px;
}

.printer-header {
  align-items: flex-start;
  gap: 24px;
  border-bottom: 1px solid #e3e8ef;
}

.printer-title {
  min-width: 220px;
}

.printer-title h2 {
  font-size: 19px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.availability {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 7px;
  color: #9b2c2c;
  font-size: 13px;
  font-weight: 700;
}

.availability.available { color: #087f5b; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

.identity-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(130px, 1fr));
  gap: 10px 20px;
  width: min(600px, 100%);
  margin: 0;
}

.identity-grid div { min-width: 0; }
.identity-grid dt { color: #697487; font-size: 11px; font-weight: 800; text-transform: uppercase; }
.identity-grid dd { margin: 3px 0 0; overflow: hidden; color: #2c374a; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }

.printer-settings {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 24px;
}

.ticket-types {
  align-content: flex-start;
  align-items: flex-start;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border: 0;
}

.ticket-types legend,
.transport-list h3 {
  margin-bottom: 10px;
  color: #273246;
  font-size: 14px;
  font-weight: 800;
}

.transport-list { min-width: 0; }

.transport-row {
  padding: 12px 0;
  border-top: 1px solid #e5e9ef;
}

.transport-row:first-of-type { border-top: 0; }
.transport-row.unavailable { color: #788396; }

.transport-summary { gap: 14px; }
.transport-summary strong { display: block; font-size: 14px; }
.transport-family { margin-right: 8px; color: #697487; font-size: 12px; }
.transport-reason { color: #a13b3b; font-size: 12px; }

.transport-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: 180px;
}

.verified,
.test-result {
  font-size: 12px;
  font-weight: 700;
}
.authorize-button {
  border: 1px solid #8aa2c2;
  border-radius: 5px;
  padding: 5px 8px;
  background: #fff;
  color: #294e7a;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.authorize-button:hover:not(:disabled) { background: #edf4fb; }
.authorize-button:disabled { cursor: wait; opacity: 0.55; }
.verified,
.test-result.success { color: #087f5b; }
.test-result.failure { max-width: 280px; color: #a13b3b; text-align: right; }

.switch { position: relative; width: 44px; height: 24px; flex: 0 0 auto; }
.switch input { width: 1px; height: 1px; opacity: 0; }
.slider { position: absolute; inset: 0; border-radius: 12px; background: #aeb8c5; cursor: pointer; transition: background 160ms ease-out; }
.slider::before { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(23, 32, 51, 0.28); transition: transform 160ms ease-out; }
.switch input:checked + .slider { background: #087f5b; }
.switch input:checked + .slider::before { transform: translateX(20px); }
.switch input:disabled + .slider { cursor: not-allowed; opacity: 0.45; }

.transport-config { margin-top: 9px; }
.transport-config summary { width: fit-content; color: #3b5b8a; font-size: 12px; font-weight: 700; cursor: pointer; }
.config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 10px; margin-top: 10px; }

.printer-footer {
  gap: 16px;
  border-top: 1px solid #e3e8ef;
  background: #f7f9fb;
  color: #5d6779;
  font-size: 13px;
}

@media (max-width: 760px) {
  .printers-page { padding: 16px; }
  .page-header,
  .printer-header,
  .printer-footer,
  .transport-summary { align-items: stretch; flex-direction: column; }
  .toolbar-row .button { flex: 1 1 auto; }
  .discovery-controls { grid-template-columns: 1fr; gap: 12px; }
  .printer-settings { grid-template-columns: 1fr; }
  .identity-grid { grid-template-columns: 1fr 1fr; }
  .transport-actions { justify-content: space-between; min-width: 0; }
  .printer-footer .button { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
</style>
