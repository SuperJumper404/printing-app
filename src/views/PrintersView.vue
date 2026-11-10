<template>
  <main class="printers-page">
    <header class="page-header">
      <div>
        <h1>Mes imprimantes</h1>
        <p>{{ printers.length }} imprimante{{ printers.length > 1 ? "s" : "" }} enregistrée{{ printers.length > 1 ? "s" : "" }}</p>
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
        <span>Filtrer les modèles probables</span>
      </label>
      <div class="mode-controls">
        <span>Sources</span>
        <label><input v-model="discoveryModes.bluetooth" type="checkbox" @change="loadPrinters(true)" /> Bluetooth</label>
        <label><input v-model="discoveryModes.usb" type="checkbox" @change="loadPrinters(true)" /> USB</label>
        <label><input v-model="discoveryModes.com" type="checkbox" @change="loadPrinters(true)" /> COM / Windows</label>
        <label><input v-model="discoveryModes.ipScan" type="checkbox" @change="loadPrinters(true)" /> Réseau</label>
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

    <section v-if="printers.length" ref="listControls" class="list-controls" aria-label="Affichage des imprimantes">
      <div class="list-views" role="group" aria-label="Choisir les imprimantes à afficher">
        <button class="view-button" :class="{ selected: !showHidden }" type="button" :aria-pressed="!showHidden" @click="showHidden = false">
          Visibles <span>{{ printers.length - hiddenPrinterCount }}</span>
        </button>
        <button class="view-button" :class="{ selected: showHidden }" type="button" :aria-pressed="showHidden" @click="showHidden = true">
          Masquées <span>{{ hiddenPrinterCount }}</span>
        </button>
      </div>
      <div class="bulk-actions">
        <button class="card-button" type="button" :disabled="!displayedPrinters.some(printer => printer.collapsed !== false)" @click="setAllCollapsed(false)">Tout déplier</button>
        <button class="card-button" type="button" :disabled="!displayedPrinters.some(printer => printer.collapsed === false)" @click="setAllCollapsed(true)">Tout replier</button>
      </div>
    </section>
    <p v-if="showHidden && hiddenPrinterCount" class="view-hint">Ces imprimantes continuent d’imprimer selon leurs réglages. Réaffichez-les pour les retrouver dans la liste principale.</p>

    <section v-if="loading && printers.length === 0" class="empty-state" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <p>Recherche des imprimantes et interfaces disponibles...</p>
    </section>

    <section v-else-if="printers.length === 0" class="empty-state">
      <h2>Aucune imprimante détectée</h2>
      <p>Vérifiez la connexion USB, Bluetooth, COM ou réseau, puis relancez la recherche.</p>
    </section>

    <section v-else ref="printerList" class="printer-list" aria-label="Imprimantes détectées">
      <div v-if="!displayedPrinters.length" class="empty-state filtered-empty" role="status">
        <h2>{{ showHidden ? "Aucune imprimante masquée" : "Aucune imprimante visible" }}</h2>
        <p>{{ showHidden ? "Les imprimantes que vous masquez apparaîtront ici." : "Vos imprimantes sont conservées dans la vue Masquées." }}</p>
        <button v-if="!showHidden" class="button neutral" type="button" @click="showHidden = true">Voir les imprimantes masquées</button>
      </div>
      <article v-for="printer in displayedPrinters" :key="printer.id" class="printer-card" :class="{ 'is-collapsed': printer.collapsed !== false }">
        <header class="printer-header">
          <div class="printer-title">
            <div class="printer-name-row">
              <h2>{{ printer.name || "Imprimante inconnue" }}</h2>
              <button
                class="favorite-button"
                type="button"
                :class="{ selected: printer.favorite }"
                :aria-pressed="Boolean(printer.favorite)"
                :aria-label="`${printer.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'} : ${printer.name || 'Imprimante'}`"
                @click="toggleFavorite(printer)"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39L17.56 20 12 17.08 6.44 20l1.06-6.07L3 9.54l6.22-.91Z" /></svg>
                <span>{{ printer.favorite ? "Favori" : "Favoris" }}</span>
              </button>
            </div>
            <div class="card-summary">
              <span class="availability" :class="{ available: printer.detected !== false && hasAvailableTransport(printer) }">
                <span class="status-dot" aria-hidden="true"></span>
                {{ printer.detected === false ? "Hors ligne" : hasAvailableTransport(printer) ? "Détectée" : "À configurer" }}
              </span>
              <span>{{ enabledTransportCount(printer) }} transport{{ enabledTransportCount(printer) > 1 ? "s" : "" }} actif{{ enabledTransportCount(printer) > 1 ? "s" : "" }}</span>
              <span v-if="printer.addresses?.length" class="printer-address" :title="printer.addresses.join(', ')">{{ printer.addresses.join(", ") }}</span>
            </div>
          </div>
          <div class="card-actions">
            <button class="card-button visibility-button" type="button" :aria-label="`${printer.hidden ? 'Réafficher' : 'Masquer'} : ${printer.name || 'Imprimante'}`" @click="toggleVisibility(printer)">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /><path v-if="!printer.hidden" d="m3 3 18 18" /></svg>
              {{ printer.hidden ? "Réafficher" : "Masquer" }}
            </button>
            <button class="card-button expand-button" type="button" :aria-expanded="printer.collapsed === false" :aria-controls="`printer-details-${printer.id}`" :aria-label="`${printer.collapsed === false ? 'Replier' : 'Déplier'} : ${printer.name || 'Imprimante'}`" @click="toggleCollapsed(printer)">
              {{ printer.collapsed === false ? "Replier" : "Déplier" }}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" :class="{ expanded: printer.collapsed === false }"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </div>
        </header>

        <div :id="`printer-details-${printer.id}`" v-show="printer.collapsed === false" class="printer-details">
          <dl class="identity-grid">
            <div><dt>VID / PID</dt><dd>{{ hardwareId(printer) }}</dd></div>
            <div><dt>Série</dt><dd>{{ printer.serialNumber || "-" }}</dd></div>
            <div><dt>Adresse</dt><dd>{{ printer.addresses?.join(", ") || "-" }}</dd></div>
            <div><dt>Instance</dt><dd :title="printer.instanceIds?.join('\n')">{{ printer.instanceIds?.[0] || "-" }}</dd></div>
          </dl>

        <div class="printer-settings">
          <div class="printer-preferences">
            <fieldset class="ticket-types">
              <legend>Tickets reçus</legend>
              <label>
                <input v-model="printer.ticketTypes.caisse" type="checkbox" @change="savePrinterConfig" />
                Caisse
              </label>
              <label>
                <input v-model="printer.ticketTypes.cuisine" type="checkbox" @change="savePrinterConfig" />
                Cuisine
              </label>
            </fieldset>

            <fieldset class="ticket-source">
              <legend>Source du ticket</legend>
              <label>
                <input v-model="printer.ticketSource" type="radio" value="received" @change="savePrinterConfig" />
                Ticket reçu
              </label>
              <label>
                <input v-model="printer.ticketSource" type="radio" value="ticketData" @change="savePrinterConfig" />
                Données ticket
              </label>
            </fieldset>

            <div class="encoding-setting">
              <label :for="`encoding-${printer.id}`">Encodage</label>
              <select
                :id="`encoding-${printer.id}`"
                v-model="printer.encoding"
                @change="encodingChanged(printer)"
              >
                <option v-for="option in PRINTER_ENCODING_OPTIONS" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>

              <div class="encoding-fields">
                <label>
                  <span>Table ESC/POS</span>
                  <input
                    v-model.number="printer.escPosCodePage"
                    type="number"
                    min="0"
                    max="255"
                    placeholder="Auto"
                    :disabled="!supportsEscPosCodePage(printer.encoding)"
                    @change="savePrinterConfig"
                  />
                </label>
                <label>
                  <span>Caractères / ligne</span>
                  <input
                    v-model.number="printer.charsPerLine"
                    type="number"
                    min="24"
                    max="96"
                    @change="savePrinterConfig"
                  />
                </label>
              </div>
            </div>
          </div>

          <div class="transport-list">
            <h3>Transports détectés</h3>
            <div v-for="row in visibleTransportRows(printer)" :key="row.id" class="transport-row" :class="{ unavailable: row.controlDisabled }">
              <div class="transport-summary">
                <div>
                  <strong>{{ row.label }}</strong>
                  <span class="transport-family">{{ row.family }}</span>
                  <span v-if="row.reason" class="transport-reason">{{ row.reason }}</span>
                </div>
                <div class="transport-actions">
                  <span v-if="printer.transports[row.id].verified" class="verified">Ticket confirmé</span>
                  <span
                    v-else-if="printer.testResults?.[row.id]"
                    class="test-result"
                    :class="printer.testResults[row.id].success ? 'success' : 'failure'"
                  >
                    {{ printer.testResults[row.id].success ? "Envoi accepté" : printer.testResults[row.id].error }}
                  </span>
                  <button
                    v-if="row.canAuthorize"
                    class="authorize-button"
                    type="button"
                    :disabled="printer.authorizationPending === row.id"
                    @click="authorizeTransport(printer, row.id)"
                  >
                    {{ printer.transports[row.id].config.authorized ? "Réautoriser" : "Autoriser" }}
                  </button>
                  <label class="switch" :title="row.controlDisabled ? row.reason : `Activer ${row.label}`">
                    <input
                      v-model="printer.transports[row.id].enabled"
                      type="checkbox"
                      :disabled="row.controlDisabled"
                      :aria-label="`Activer ${row.label} pour ${printer.name}`"
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
                      :disabled="row.configDisabled"
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
                      :placeholder="field.placeholder || field.defaultValue"
                      :disabled="row.configDisabled"
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
        </div>
      </article>
    </section>
  </main>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import {
  PRINTER_ENCODING_OPTIONS,
  TRANSPORT_PRESENTATION,
  createEmptyTransports,
  createDiscoveryRefresh,
  getTransportRows,
  getPrinterList,
  mergeDiscoveredAndSavedPrinters,
  togglePrinterFavorite,
} from "../printers/transportPresentation.mjs";
import { authorizeUsbDevice } from "../printers/webUsbTransport";
import { authorizeHidDevice } from "../printers/webHidTransport";
import { authorizeBluetoothDevice } from "../printers/webBluetoothTransport";

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
const showHidden = ref(false);
const printerList = ref(null);
const listControls = ref(null);
const hiddenPrinterCount = computed(() => printers.value.filter(printer => printer.hidden).length);
const displayedPrinters = computed(() => getPrinterList(printers.value, { hidden: showHidden.value }));
let refreshTimer;
let disposed = false;

const discoveryRefresh = createDiscoveryRefresh({
  getSaved: () => ipcRenderer.invoke("get-saved-printers"),
  discover: () => ipcRenderer.invoke("discover-printers", {
    useFilters: useDiscoveryFilters.value,
    modes: clone(discoveryModes.value),
  }),
  getCurrent: () => printers.value,
  apply: (updated) => {
    setPrinters(updated);
    savePrinterConfig();
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function updatePrinterCache() {
  printerCache.printers = clone(printers.value);
  printerCache.useDiscoveryFilters = useDiscoveryFilters.value;
  printerCache.discoveryModes = clone(discoveryModes.value);
}

async function savePrinterConfig() {
  updatePrinterCache();
  try {
    await ipcRenderer.invoke("save-printer-config", clone(printers.value.map(({ testing, testResults, authorizationPending, ...printer }) => printer)));
  } catch {
    pageMessage.value = "Réglages non enregistrés : le service Windows est indisponible. Démarrez le service, puis réessayez.";
  }
}

function setPrinters(updated) {
  const existing = new Map(printers.value.map((printer) => [printer.id, printer]));
  printers.value = updated.map((printer) => {
    const previous = existing.get(printer.id);
    if (!previous) return { ...printer, testing: false, testResults: {}, authorizationPending: null };
    const transient = { testing: previous.testing, testResults: previous.testResults, authorizationPending: previous.authorizationPending };
    return Object.assign(previous, printer, transient);
  });
}

function toggleFavorite(printer) {
  setPrinters(togglePrinterFavorite(printers.value, printer.id));
  savePrinterConfig();
}

function toggleCollapsed(printer) {
  const collapsed = printer.collapsed !== false;
  printer.collapsed = !collapsed;
  savePrinterConfig();
}

function setAllCollapsed(collapsed) {
  for (const printer of displayedPrinters.value) printer.collapsed = collapsed;
  savePrinterConfig();
}

async function toggleVisibility(printer) {
  const previousIndex = displayedPrinters.value.findIndex(item => item.id === printer.id);
  printer.hidden = !printer.hidden;
  pageMessage.value = printer.hidden
    ? "Imprimante masquée. Retrouvez-la dans la vue Masquées. Ses réglages d’impression sont conservés."
    : "Imprimante réaffichée dans la liste principale.";
  savePrinterConfig();
  await nextTick();
  const remaining = printerList.value?.querySelectorAll(".visibility-button");
  const nextButton = remaining?.[Math.min(previousIndex, remaining.length - 1)]
    || listControls.value?.querySelector('[aria-pressed="true"]');
  nextButton?.focus();
}

function visibleTransportRows(printer) {
  const rows = getTransportRows(printer).filter((row) => row.available || row.enabled || row.candidate);
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

function encodingChanged(printer) {
  if (!supportsEscPosCodePage(printer.encoding)) printer.escPosCodePage = null;
  savePrinterConfig();
}

function supportsEscPosCodePage(encoding) {
  return ["cp858", "cp850", "windows-1252"].includes(encoding);
}

async function authorizeTransport(printer, transportId) {
  printer.authorizationPending = transportId;
  try {
    if (!["usbRaw", "usbHid", "bluetoothGatt"].includes(transportId)) {
      throw new Error("Autorisation non prise en charge");
    }
    const identity = {
      ...printer.transports[transportId].config,
      vendorId: printer.vendorId || printer.transports[transportId].config.vendorId,
      productId: printer.productId || printer.transports[transportId].config.productId,
      serialNumber: printer.serialNumber || printer.transports[transportId].config.serialNumber,
      name: printer.transports[transportId].config.name || printer.name,
    };
    let config;
    if (transportId === "usbRaw") config = await authorizeUsbDevice(identity);
    else if (transportId === "usbHid") config = await authorizeHidDevice(identity);
    else config = await authorizeBluetoothDevice(identity);
    printer.transports[transportId].config = {
      ...printer.transports[transportId].config,
      ...config,
      authorized: true,
    };
    printer.transports[transportId].reason = null;
    printer.transports[transportId].available = true;
    printer.transports[transportId].needsAuthorization = false;
    const transportLabel = { usbRaw: "USB", usbHid: "HID", bluetoothGatt: "Bluetooth" }[transportId];
    pageMessage.value = `Périphérique ${transportLabel} autorisé.`;
    savePrinterConfig();
  } catch (error) {
    printer.transports[transportId].config.authorized = false;
    printer.transports[transportId].available = false;
    printer.transports[transportId].needsAuthorization = true;
    const recovery = {
      "configure-bluetooth-gatt": "Renseignez un UUID de service GATT valide dans Configuration, puis réessayez.",
      "authorize-bluetooth-service": "Autorisez à nouveau le périphérique avec le service GATT configuré.",
    }[error.action];
    printer.transports[transportId].reason = recovery || "Autorisation refusée ou périphérique incompatible. Vérifiez la connexion, puis réessayez.";
    pageMessage.value = printer.transports[transportId].reason;
    console.error("Autorisation du périphérique impossible", error);
    savePrinterConfig();
  } finally {
    printer.authorizationPending = null;
    updatePrinterCache();
  }
}

async function loadPrinters(forceDiscovery = false) {
  if (disposed || purging.value || loading.value && printers.value.length > 0) return;
  if (!Object.values(discoveryModes.value).some(Boolean)) {
    pageMessage.value = "Sélectionnez au moins une source de recherche.";
    loading.value = false;
    return;
  }

  loading.value = true;
  pageMessage.value = "";
  try {
    await discoveryRefresh.run();
  } catch (error) {
    console.error("Erreur découverte imprimantes:", error);
    if (!disposed) pageMessage.value = "Recherche indisponible. Vérifiez les connexions, puis rechargez la liste.";
  } finally {
    if (!disposed) {
      loading.value = false;
      updatePrinterCache();
    }
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
        `Le ticket imprimé par ${label} est-il lisible ?`,
      );
    }
    pageMessage.value = result.message || result.error || "Test terminé.";
    savePrinterConfig();
  } catch (error) {
    console.error("Test de l'imprimante impossible", error);
    pageMessage.value = "Test impossible. Vérifiez la connexion et la configuration, puis réessayez.";
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
  const matching = printers.value.filter((printer) => printer.addresses?.includes(address.ip));
  if (matching.length > 1) {
    pageMessage.value = "Plusieurs imprimantes utilisent cette adresse. Vérifiez leur configuration avant l'ajout.";
    return;
  }
  const existing = matching[0];
  const transportId = ({ 631: "ipp", 515: "lpr", 80: "eposHttp" })[port] || "network9100";
  if (existing?.transports?.[transportId]?.available) {
    pageMessage.value = "Ce service est déjà dans la liste.";
    return;
  }

  addingManualPrinter.value = true;
  try {
    const online = await ipcRenderer.invoke("check-printer-online", { ip: address.ip, port });
    if (!online) {
      pageMessage.value = `Aucun service détecté sur ${address.ip}:${port}.`;
      return;
    }
    const transports = createEmptyTransports();
    const config = { host: address.ip, port };
    if (transportId === "network9100") config.timeoutMs = 15000;
    transports[transportId] = {
      available: true,
      enabled: false,
      verified: false,
      config,
      reason: null,
    };
    if (existing) {
      existing.transports[transportId] = transports[transportId];
      existing.detected = true;
      existing.online = true;
    } else printers.value.unshift({
      printerConfigVersion: 2,
      id: `manual-network-${address.ip}-${port}`,
      name: `Imprimante ${address.ip}`,
      addresses: [address.ip],
      instanceIds: [],
      ticketTypes: { caisse: false, cuisine: false },
      ticketSource: "received",
      encoding: "auto",
      escPosCodePage: null,
      charsPerLine: 48,
      favorite: false,
      hidden: false,
      collapsed: true,
      online: true,
      detected: true,
      transports,
      observations: [],
      testResults: {},
    });
    manualPrinterIp.value = "";
    manualPrinterPort.value = 9100;
    pageMessage.value = `Service détecté sur ${address.ip}:${port}.`;
    savePrinterConfig();
  } catch (error) {
    console.error("Ajout manuel de l'imprimante impossible", error);
    pageMessage.value = "Ajout impossible. Vérifiez l'adresse et le port, puis réessayez.";
  } finally {
    addingManualPrinter.value = false;
  }
}

async function openDebugConsole() {
  try {
    const result = await ipcRenderer.invoke("open-debug-console");
    pageMessage.value = `Console ouverte : ${result.logPath}`;
  } catch (error) {
    console.error("Ouverture de la console impossible", error);
    pageMessage.value = "Console indisponible. Réessayez dans quelques instants.";
  }
}

async function purgePrinterData() {
  if (!window.confirm("Supprimer les imprimantes et l'historique d'impression ?")) return;
  purging.value = true;
  discoveryRefresh.invalidate();
  try {
    await ipcRenderer.invoke("purge-printer-data");
    printers.value = [];
    printerCache.printers = null;
    pageMessage.value = "Données imprimantes purgées.";
  } catch (error) {
    console.error("Purge des imprimantes impossible", error);
    pageMessage.value = "Suppression impossible. Réessayez dans quelques instants.";
  } finally {
    purging.value = false;
  }
}

function printersUpdated(_event, updated) {
  if (disposed || purging.value || !Array.isArray(updated)) return;
  setPrinters(mergeDiscoveredAndSavedPrinters(updated, printers.value));
  updatePrinterCache();
}

onMounted(() => {
  ipcRenderer.on("printers-updated", printersUpdated);
  loadPrinters(true);
  refreshTimer = window.setInterval(() => loadPrinters(true), 30000);
});

onUnmounted(() => {
  disposed = true;
  window.clearInterval(refreshTimer);
  discoveryRefresh.dispose();
  ipcRenderer.removeListener("printers-updated", printersUpdated);
});
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
.ticket-types,
.ticket-source {
  display: flex;
  align-items: center;
}

.printer-preferences {
  display: grid;
  align-content: start;
  gap: 22px;
}

.encoding-setting {
  display: grid;
  gap: 6px;
}

.encoding-setting > label,
.encoding-fields span {
  color: #273246;
  font-size: 13px;
  font-weight: 800;
}

.encoding-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  margin-top: 4px;
}

.encoding-fields label {
  display: grid;
  gap: 5px;
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
.ticket-types,
.ticket-source {
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
.favorite-button:focus-visible,
.card-button:focus-visible,
.view-button:focus-visible,
.authorize-button:focus-visible,
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
.ticket-types label,
.ticket-source label {
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
  min-width: 0;
  flex: 1;
}

.list-controls, .list-views, .bulk-actions, .card-actions, .card-summary { display: flex; align-items: center; }
.list-controls { justify-content: space-between; gap: 16px; margin-top: 24px; flex-wrap: wrap; }
.list-views, .bulk-actions, .card-actions { gap: 8px; }
.view-button, .card-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; border: 1px solid #b8c2cf; border-radius: 6px; padding: 8px 11px; color: #465165; background: #fff; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.view-button span { font-variant-numeric: tabular-nums; }
.view-button.selected { border-color: #2563eb; color: #1d4ed8; background: #eff6ff; }
.view-button:hover, .card-button:hover:not(:disabled) { background: #f1f5f9; }
.card-button:disabled { opacity: 0.5; cursor: not-allowed; }
.card-button svg { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.expand-button { min-width: 98px; }
.expand-button svg { transition: transform 160ms ease-out; }
.expand-button svg.expanded { transform: rotate(180deg); }
.card-actions { flex-shrink: 0; }
.card-summary { gap: 8px 16px; flex-wrap: wrap; margin-top: 10px; color: #5d6779; font-size: 13px; }
.card-summary .availability { margin-top: 0; }
.printer-address { overflow-wrap: anywhere; }
.view-hint { margin-top: 12px; color: #5d6779; font-size: 13px; line-height: 1.5; }
.printer-card.is-collapsed .printer-header { border-bottom: 0; }
.printer-details > .identity-grid { width: auto; padding: 16px 20px; border-bottom: 1px solid #e3e8ef; background: #f7f9fb; }
.filtered-empty { margin-top: 0; padding: 24px; }

.printer-title h2 {
  font-size: 19px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.printer-name-row { display: flex; align-items: flex-start; gap: 12px; }
.printer-name-row h2 { min-width: 0; }
.favorite-button { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; min-height: 34px; padding: 5px 8px; border: 1px solid #b8c2cf; border-radius: 6px; color: #465165; background: #fff; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.favorite-button svg { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; }
.favorite-button:hover { background: #f1f5f9; }
.favorite-button.selected { color: #805400; border-color: #bd8b20; background: #fff8e7; }
.favorite-button.selected svg { fill: #f3c767; }

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

.ticket-types,
.ticket-source {
  align-content: flex-start;
  align-items: flex-start;
  flex-direction: column;
  margin: 0;
  padding: 0;
  border: 0;
}

.ticket-types legend,
.ticket-source legend,
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
.switch input:focus-visible + .slider { outline: 3px solid rgba(37, 99, 235, 0.5); outline-offset: 2px; }
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
  .printer-header { gap: 16px; }
  .card-actions .card-button { flex: 1; min-height: 44px; }
  .list-controls { align-items: stretch; }
  .bulk-actions { margin-left: auto; }
  .printer-name-row { flex-wrap: wrap; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
</style>
