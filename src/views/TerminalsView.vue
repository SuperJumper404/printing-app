<template>
  <main class="terminals-page">
    <header class="page-header">
      <div>
        <h1>Mes TPE</h1>
        <p>{{ terminals.length }} terminal{{ terminals.length > 1 ? "aux" : "" }} configure{{ terminals.length > 1 ? "s" : "" }}</p>
      </div>
      <button class="button primary" type="button" :disabled="configurationLocked" @click="createTerminal">
        Ajouter un TPE
      </button>
    </header>

    <p v-if="pageMessage" class="page-message" :class="messageTone" role="status" aria-live="polite">
      {{ pageMessage }}
    </p>

    <section v-if="loading" class="empty-state" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <p>Chargement des terminaux...</p>
    </section>

    <div v-else class="workspace">
      <section class="terminal-column" aria-label="Terminaux configures">
        <div v-if="terminals.length === 0" class="empty-state compact">
          <h2>Aucun TPE configure</h2>
          <p>Ajoutez le PAX Q25 relie au poste ou au reseau local.</p>
        </div>

        <article
          v-for="terminal in terminals"
          :key="terminal.id"
          class="terminal-card"
          :class="{ selected: draft.id === terminal.id }"
        >
          <button class="terminal-select" type="button" :disabled="configurationLocked" @click="editTerminal(terminal)">
            <span class="terminal-heading">
              <strong>{{ terminal.name }}</strong>
              <span>{{ terminal.manufacturer }} {{ terminal.model }}</span>
            </span>
            <span class="terminal-route">{{ protocolLabel(terminal.protocol) }} · {{ transportLabel(terminal.transport) }}</span>
          </button>
          <div class="terminal-status">
            <span class="status-line" :class="connectionStatus[terminal.id]?.tone || 'neutral'">
              <span class="status-dot" aria-hidden="true"></span>
              {{ connectionStatus[terminal.id]?.label || "Non verifie" }}
            </span>
            <span v-if="!terminal.enabled" class="disabled-label">Desactive</span>
          </div>
          <footer class="terminal-actions">
            <button class="text-action" type="button" :disabled="configurationLocked || !terminal.enabled" @click="testConnection(terminal)">
              {{ testingId === terminal.id ? "Test en cours..." : "Tester" }}
            </button>
            <button class="text-action payment" type="button" :disabled="configurationLocked || !terminal.enabled" @click="openPayment(terminal)">
              Tester un paiement
            </button>
          </footer>
        </article>
      </section>

      <form class="terminal-editor" @submit.prevent="saveTerminal">
        <div class="editor-header">
          <div>
            <h2>{{ isNewTerminal ? "Nouveau TPE" : "Configuration" }}</h2>
            <p>Les reglages doivent correspondre a l'application chargee sur le terminal.</p>
          </div>
          <label class="enabled-control">
            <input v-model="draft.enabled" type="checkbox" :disabled="configurationLocked" />
            <span>Actif</span>
          </label>
        </div>

        <fieldset :disabled="configurationLocked" class="editor-fields">
          <div class="form-grid identity-fields">
            <label>
              <span>Nom</span>
              <input v-model.trim="draft.name" required type="text" autocomplete="off" />
            </label>
            <label>
              <span>Modele</span>
              <input v-model.trim="draft.model" required type="text" autocomplete="off" />
            </label>
          </div>

          <div class="setting-block">
            <h3>Protocole</h3>
            <div class="segmented" role="radiogroup" aria-label="Protocole du terminal">
              <label :class="{ active: draft.protocol === 'nepting' }">
                <input v-model="draft.protocol" type="radio" value="nepting" @change="protocolChanged" />
                Nepting
              </label>
              <label :class="{ active: draft.protocol === 'caisse-ap' }">
                <input v-model="draft.protocol" type="radio" value="caisse-ap" @change="protocolChanged" />
                Caisse-AP
              </label>
            </div>
            <div class="form-grid protocol-fields">
              <label>
                <span>Version</span>
                <input v-model.trim="draft.protocolVersion" required type="text" inputmode="numeric" maxlength="4" />
              </label>
              <label>
                <span>Identifiant caisse</span>
                <input v-model.trim="draft.cashRegisterId" required type="text" maxlength="12" />
              </label>
              <label>
                <span>Numero de caisse</span>
                <input v-model.trim="draft.cashRegisterNumber" required type="text" inputmode="numeric" maxlength="2" />
              </label>
              <label v-if="visibleFields.showNepting">
                <span>Identifiant commercant</span>
                <input v-model.trim="draft.nepting.merchantId" type="password" autocomplete="off" />
              </label>
            </div>
          </div>

          <div class="setting-block">
            <h3>Connexion</h3>
            <div class="segmented" role="radiogroup" aria-label="Connexion du terminal">
              <label :class="{ active: draft.transport === 'tcp' }">
                <input v-model="draft.transport" type="radio" value="tcp" />
                Reseau IP
              </label>
              <label :class="{ active: draft.transport === 'serial' }">
                <input v-model="draft.transport" type="radio" value="serial" @change="loadSerialPorts" />
                USB / COM
              </label>
            </div>

            <div v-if="visibleFields.showTcp" class="form-grid transport-fields">
              <label class="wide-field">
                <span>Adresse IP</span>
                <input v-model.trim="draft.tcp.host" required type="text" placeholder="192.168.1.40" />
              </label>
              <label>
                <span>Port</span>
                <input v-model.number="draft.tcp.port" required type="number" min="1" max="65535" />
              </label>
            </div>

            <div v-if="visibleFields.showSerial" class="serial-settings">
              <div class="serial-port-row">
                <label>
                  <span>Port COM</span>
                  <select v-model="draft.serial.path" required>
                    <option value="">Selectionner</option>
                    <option v-for="port in serialPorts" :key="port.path" :value="port.path">
                      {{ port.path }}{{ port.manufacturer ? ` · ${port.manufacturer}` : "" }}
                    </option>
                  </select>
                </label>
                <button class="button neutral" type="button" :disabled="serialLoading" @click="loadSerialPorts">
                  {{ serialLoading ? "Recherche..." : "Actualiser" }}
                </button>
              </div>
              <details>
                <summary>Parametres serie avances</summary>
                <div class="form-grid serial-grid">
                  <label><span>Vitesse</span><input v-model.number="draft.serial.baudRate" type="number" min="1" /></label>
                  <label><span>Bits</span><select v-model.number="draft.serial.dataBits"><option :value="8">8</option><option :value="7">7</option></select></label>
                  <label><span>Parite</span><select v-model="draft.serial.parity"><option value="none">Aucune</option><option value="even">Paire</option><option value="odd">Impaire</option></select></label>
                  <label><span>Bits d'arret</span><select v-model.number="draft.serial.stopBits"><option :value="1">1</option><option :value="2">2</option></select></label>
                  <label><span>Controle de flux</span><select v-model="draft.serial.flowControl"><option value="none">Aucun</option><option value="rtscts">RTS/CTS</option><option value="xon/xoff">XON/XOFF</option></select></label>
                </div>
              </details>
            </div>
          </div>
        </fieldset>

        <footer class="editor-actions">
          <button v-if="!isNewTerminal" class="button danger" type="button" :disabled="configurationLocked" @click="deleteTerminal">
            Supprimer
          </button>
          <span class="action-spacer"></span>
          <button class="button neutral" type="button" :disabled="configurationLocked" @click="resetDraft">Annuler</button>
          <button class="button primary" type="submit" :disabled="configurationLocked || saving">
            {{ saving ? "Enregistrement..." : "Enregistrer" }}
          </button>
        </footer>
      </form>
    </div>

    <div v-if="paymentOpen" class="dialog-backdrop" @click.self="closePayment">
      <section class="payment-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-title">
        <header>
          <div>
            <h2 id="payment-title">Paiement test</h2>
            <p>{{ paymentTerminal?.name }}</p>
          </div>
          <button class="close-button" type="button" aria-label="Fermer" :disabled="transactionActive" @click="closePayment">×</button>
        </header>

        <form v-if="!activeTransaction" class="payment-form" @submit.prevent="startPayment">
          <label>
            <span>Montant en euros</span>
            <input v-model="paymentAmount" required type="number" min="0.01" step="0.01" inputmode="decimal" autofocus />
          </label>
          <p>Le TPE lancera une vraie demande de paiement.</p>
          <div class="dialog-actions">
            <button class="button neutral" type="button" @click="closePayment">Fermer</button>
            <button class="button payment" type="submit">Envoyer au TPE</button>
          </div>
        </form>

        <div v-else class="transaction-state">
          <span class="transaction-badge" :class="activePresentation.tone">{{ activePresentation.label }}</span>
          <strong>{{ formatAmount(activeTransaction.amount) }}</strong>
          <p>{{ activeTransaction.message || transactionInstruction }}</p>
          <dl>
            <div><dt>Transaction</dt><dd>{{ activeTransaction.transactionId }}</dd></div>
            <div v-if="activeTransaction.authorizationReference"><dt>Autorisation</dt><dd>{{ activeTransaction.authorizationReference }}</dd></div>
          </dl>
          <div class="dialog-actions">
            <button
              v-if="activeTransaction.canCancel && transactionActive"
              class="button danger"
              type="button"
              :disabled="cancelling"
              @click="cancelPayment"
            >
              {{ cancelling ? "Annulation..." : "Annuler sur le TPE" }}
            </button>
            <button v-if="!transactionActive" class="button primary" type="button" @click="closePayment">Terminer</button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  newTerminalDraft,
  terminalStatusPresentation,
  visibleTerminalFields,
} from "../terminals/presentation.mjs";

const ipcRenderer = window.require?.("electron")?.ipcRenderer || {
  async invoke(channel) {
    if (channel === "terminals:list" || channel === "terminals:list-serial-ports") {
      return { ok: true, value: [] };
    }
    return {
      ok: false,
      error: {
        code: "desktop_required",
        message: "Cette action est disponible dans l'application de bureau.",
      },
    };
  },
};
const terminals = ref([]);
const draft = ref(newTerminalDraft());
const serialPorts = ref([]);
const connectionStatus = ref({});
const loading = ref(true);
const saving = ref(false);
const serialLoading = ref(false);
const testingId = ref("");
const pageMessage = ref("");
const messageTone = ref("success");
const paymentOpen = ref(false);
const paymentTerminal = ref(null);
const paymentAmount = ref("1.00");
const activeTransaction = ref(null);
const cancelling = ref(false);
let pollTimer = null;

const visibleFields = computed(() => visibleTerminalFields(draft.value));
const isNewTerminal = computed(() => !terminals.value.some((item) => item.id === draft.value.id));
const activePresentation = computed(() => terminalStatusPresentation(activeTransaction.value?.state));
const transactionActive = computed(() => Boolean(activeTransaction.value && !activePresentation.value.terminal));
const configurationLocked = computed(() => transactionActive.value);
const transactionInstruction = computed(() => activeTransaction.value?.state === "unknown"
  ? "Consultez le journal du TPE avant toute nouvelle tentative."
  : "Suivez les instructions affichees sur le terminal.");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function invoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result?.ok) {
    const error = new Error(result?.error?.message || "Operation TPE impossible");
    error.code = result?.error?.code;
    error.details = result?.error?.details;
    throw error;
  }
  return result.value;
}

function showMessage(message, tone = "success") {
  pageMessage.value = message;
  messageTone.value = tone;
}

function errorMessage(error) {
  return Array.isArray(error.details) ? error.details.join("\n") : error.message;
}

function createTerminal() {
  draft.value = newTerminalDraft();
  pageMessage.value = "";
}

function editTerminal(terminal) {
  draft.value = clone(terminal);
  pageMessage.value = "";
}

function resetDraft() {
  draft.value = terminals.value[0] ? clone(terminals.value[0]) : newTerminalDraft();
  pageMessage.value = "";
}

function protocolChanged() {
  draft.value.protocolVersion = draft.value.protocol === "nepting" ? "0320" : "0300";
}

function protocolLabel(protocol) {
  return protocol === "caisse-ap" ? "Caisse-AP" : "Nepting";
}

function transportLabel(transport) {
  return transport === "serial" ? "USB / COM" : "Reseau IP";
}

async function loadTerminals() {
  loading.value = true;
  try {
    terminals.value = await invoke("terminals:list");
    resetDraft();
  } catch (error) {
    showMessage(errorMessage(error), "error");
  } finally {
    loading.value = false;
  }
}

async function saveTerminal() {
  saving.value = true;
  try {
    if (!draft.value.id) draft.value.id = crypto.randomUUID();
    const saved = await invoke("terminals:save", clone(draft.value));
    const index = terminals.value.findIndex((item) => item.id === saved.id);
    if (index >= 0) terminals.value.splice(index, 1, saved);
    else terminals.value.push(saved);
    draft.value = clone(saved);
    showMessage("Configuration du TPE enregistree.");
  } catch (error) {
    showMessage(errorMessage(error), "error");
  } finally {
    saving.value = false;
  }
}

async function deleteTerminal() {
  if (!window.confirm(`Supprimer ${draft.value.name} ?`)) return;
  try {
    await invoke("terminals:delete", draft.value.id);
    terminals.value = terminals.value.filter((item) => item.id !== draft.value.id);
    resetDraft();
    showMessage("TPE supprime.");
  } catch (error) {
    showMessage(errorMessage(error), "error");
  }
}

async function loadSerialPorts() {
  if (draft.value.transport !== "serial") return;
  serialLoading.value = true;
  try {
    serialPorts.value = await invoke("terminals:list-serial-ports");
    if (draft.value.serial.path && !serialPorts.value.some((port) => port.path === draft.value.serial.path)) {
      serialPorts.value.unshift({ path: draft.value.serial.path, manufacturer: "Port enregistre" });
    }
  } catch (error) {
    showMessage(errorMessage(error), "error");
  } finally {
    serialLoading.value = false;
  }
}

async function testConnection(terminal) {
  testingId.value = terminal.id;
  connectionStatus.value = {
    ...connectionStatus.value,
    [terminal.id]: { label: "Verification...", tone: "progress" },
  };
  try {
    await invoke("terminals:test-connection", terminal.id);
    connectionStatus.value = {
      ...connectionStatus.value,
      [terminal.id]: { label: "TPE verifie", tone: "success" },
    };
  } catch (error) {
    connectionStatus.value = {
      ...connectionStatus.value,
      [terminal.id]: { label: errorMessage(error), tone: "danger" },
    };
  } finally {
    testingId.value = "";
  }
}

function openPayment(terminal) {
  paymentTerminal.value = terminal;
  paymentAmount.value = "1.00";
  activeTransaction.value = null;
  paymentOpen.value = true;
}

function closePayment() {
  if (transactionActive.value) return;
  clearTimeout(pollTimer);
  paymentOpen.value = false;
  activeTransaction.value = null;
}

async function startPayment() {
  const amount = Math.round(Number(paymentAmount.value) * 100);
  try {
    activeTransaction.value = await invoke("terminal-payments:start", {
      transactionId: crypto.randomUUID(),
      terminalId: paymentTerminal.value.id,
      amount,
      currency: "EUR",
    });
    schedulePoll();
  } catch (error) {
    showMessage(errorMessage(error), "error");
    paymentOpen.value = false;
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!transactionActive.value) return;
  pollTimer = setTimeout(pollPayment, 700);
}

async function pollPayment() {
  try {
    activeTransaction.value = await invoke("terminal-payments:get", activeTransaction.value.transactionId);
  } catch (error) {
    showMessage(errorMessage(error), "error");
  }
  schedulePoll();
}

async function cancelPayment() {
  cancelling.value = true;
  try {
    activeTransaction.value = await invoke("terminal-payments:cancel", activeTransaction.value.transactionId);
  } catch (error) {
    showMessage(errorMessage(error), "error");
  } finally {
    cancelling.value = false;
    schedulePoll();
  }
}

function formatAmount(cents) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
}

onMounted(loadTerminals);
onBeforeUnmount(() => clearTimeout(pollTimer));
</script>

<style scoped>
.terminals-page {
  width: min(1180px, 100%);
  margin: 0 auto;
  padding: 24px;
  color: #172033;
}

.terminals-page,
.terminals-page * { box-sizing: border-box; }

h1, h2, h3, p { margin: 0; }
h1 { font-size: 28px; line-height: 1.2; }
h2 { font-size: 19px; line-height: 1.3; }
h3 { margin-bottom: 12px; font-size: 14px; }

.page-header,
.editor-header,
.editor-actions,
.terminal-status,
.terminal-actions,
.serial-port-row,
.dialog-actions,
.payment-dialog > header {
  display: flex;
  align-items: center;
}

.page-header,
.editor-header,
.terminal-status,
.payment-dialog > header { justify-content: space-between; }
.page-header { gap: 24px; margin-bottom: 20px; }
.page-header p, .editor-header p, .payment-dialog header p { margin-top: 5px; color: #5d6779; }

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

.button:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.3);
  outline-offset: 2px;
}

button:disabled, fieldset:disabled { cursor: not-allowed; opacity: 0.55; }
.primary { background: #2563eb; }
.primary:hover:not(:disabled) { background: #1d4ed8; }
.neutral { background: #475569; }
.neutral:hover:not(:disabled) { background: #334155; }
.danger { background: #b83232; }
.danger:hover:not(:disabled) { background: #922626; }
.payment { background: #087f5b; }
.payment:hover:not(:disabled) { background: #066a4b; }

.page-message {
  margin-bottom: 16px;
  padding: 11px 13px;
  border-radius: 6px;
  background: #e8f5ef;
  color: #155e49;
  white-space: pre-line;
}
.page-message.error { background: #fff0f0; color: #8f2525; }

.workspace { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 22px; align-items: start; }
.terminal-column { display: grid; gap: 12px; }

.terminal-card {
  border: 1px solid #d5dde7;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 5px 16px rgba(25, 36, 54, 0.06);
  overflow: hidden;
}
.terminal-card.selected { border-color: #4c78b8; box-shadow: 0 6px 18px rgba(37, 99, 235, 0.14); }
.terminal-select { display: grid; width: 100%; border: 0; padding: 16px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.terminal-heading { display: flex; justify-content: space-between; gap: 14px; align-items: baseline; }
.terminal-heading strong { overflow-wrap: anywhere; font-size: 16px; }
.terminal-heading span, .terminal-route { color: #667286; font-size: 12px; }
.terminal-route { margin-top: 8px; }
.terminal-status { padding: 10px 16px; border-top: 1px solid #edf0f4; background: #f8fafc; font-size: 12px; }
.status-line { display: inline-flex; align-items: center; gap: 7px; min-width: 0; overflow-wrap: anywhere; font-weight: 700; }
.status-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: currentColor; }
.status-line.neutral { color: #667286; }
.status-line.progress { color: #245ea8; }
.status-line.success { color: #087f5b; }
.status-line.danger { color: #a12b2b; }
.disabled-label { color: #8a3b3b; font-weight: 700; }
.terminal-actions { border-top: 1px solid #e3e8ef; }
.text-action { flex: 1 1 50%; min-height: 40px; border: 0; background: #fff; color: #315984; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.text-action + .text-action { border-left: 1px solid #e3e8ef; }
.text-action:hover:not(:disabled) { background: #edf4fb; }
.text-action.payment { color: #087f5b; }

.terminal-editor { border: 1px solid #d5dde7; border-radius: 8px; background: #fff; box-shadow: 0 8px 24px rgba(25, 36, 54, 0.07); overflow: hidden; }
.editor-header { gap: 18px; padding: 18px 20px; border-bottom: 1px solid #e3e8ef; }
.editor-header p { max-width: 64ch; font-size: 13px; }
.enabled-control { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; }
.enabled-control input { width: 18px; height: 18px; accent-color: #087f5b; }
.editor-fields { margin: 0; padding: 20px; border: 0; }
.setting-block { margin-top: 24px; padding-top: 20px; border-top: 1px solid #e3e8ef; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.protocol-fields { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 14px; }
.transport-fields { grid-template-columns: minmax(0, 2fr) minmax(100px, 1fr); margin-top: 14px; }
.form-grid label, .serial-port-row label, .payment-form label { display: grid; gap: 6px; min-width: 0; }
.form-grid label > span, .serial-port-row label > span, .payment-form label > span { color: #465165; font-size: 13px; font-weight: 700; }
input, select { min-width: 0; border: 1px solid #b8c2cf; border-radius: 6px; padding: 9px 10px; background: #fff; color: #172033; font: inherit; }
input:disabled, select:disabled { background: #eef1f5; }
.segmented { display: inline-grid; grid-template-columns: repeat(2, minmax(110px, 1fr)); border: 1px solid #aeb9c8; border-radius: 7px; overflow: hidden; }
.segmented label { padding: 9px 14px; color: #4c586b; text-align: center; cursor: pointer; }
.segmented label + label { border-left: 1px solid #aeb9c8; }
.segmented label.active { background: #e6effb; color: #1f4f8f; font-weight: 800; }
.segmented input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.serial-settings { margin-top: 14px; }
.serial-port-row { gap: 10px; align-items: end; }
.serial-port-row label { flex: 1 1 auto; }
details { margin-top: 14px; }
summary { width: fit-content; color: #315984; font-size: 13px; font-weight: 700; cursor: pointer; }
.serial-grid { grid-template-columns: repeat(auto-fit, minmax(115px, 1fr)); margin-top: 12px; }
.editor-actions { gap: 10px; padding: 14px 20px; border-top: 1px solid #e3e8ef; background: #f7f9fb; }
.action-spacer { flex: 1 1 auto; }

.empty-state { display: grid; place-items: center; gap: 10px; min-height: 180px; border: 1px dashed #aeb8c5; border-radius: 8px; color: #5d6779; text-align: center; }
.empty-state.compact { min-height: 150px; padding: 18px; }
.spinner { width: 28px; height: 28px; border: 3px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin 800ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.dialog-backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: rgba(15, 23, 42, 0.58); }
.payment-dialog { width: min(480px, 100%); border-radius: 8px; background: #fff; box-shadow: 0 18px 45px rgba(5, 12, 24, 0.28); overflow: hidden; }
.payment-dialog > header { padding: 18px 20px; border-bottom: 1px solid #e3e8ef; }
.close-button { width: 36px; height: 36px; border: 0; border-radius: 50%; background: #eef1f5; color: #334155; font-size: 24px; line-height: 1; cursor: pointer; }
.payment-form, .transaction-state { display: grid; gap: 18px; padding: 22px 20px; }
.payment-form p, .transaction-state p { color: #5d6779; line-height: 1.5; }
.dialog-actions { justify-content: flex-end; gap: 10px; }
.transaction-state > strong { font-size: 32px; font-variant-numeric: tabular-nums; }
.transaction-badge { width: fit-content; border-radius: 6px; padding: 7px 10px; font-size: 13px; font-weight: 800; }
.transaction-badge.neutral { background: #edf1f5; color: #475569; }
.transaction-badge.progress { background: #e6effb; color: #1f4f8f; }
.transaction-badge.success { background: #e3f4ed; color: #087f5b; }
.transaction-badge.danger { background: #fff0f0; color: #9b2c2c; }
.transaction-badge.warning { background: #fff5db; color: #805b10; }
.transaction-state dl { display: grid; gap: 8px; margin: 0; }
.transaction-state dl div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px; }
.transaction-state dt { color: #697487; font-size: 12px; font-weight: 700; }
.transaction-state dd { margin: 0; overflow-wrap: anywhere; font-size: 12px; font-variant-numeric: tabular-nums; }

@media (max-width: 880px) {
  .workspace { grid-template-columns: 1fr; }
  .terminal-column { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
}

@media (max-width: 600px) {
  .terminals-page { padding: 16px; }
  .page-header { align-items: stretch; flex-direction: column; }
  .page-header .button { width: 100%; }
  .terminal-column { grid-template-columns: 1fr; }
  .editor-header { align-items: flex-start; }
  .form-grid, .protocol-fields, .transport-fields { grid-template-columns: 1fr; }
  .segmented { display: grid; width: 100%; }
  .serial-port-row { align-items: stretch; flex-direction: column; }
  .editor-actions { flex-wrap: wrap; }
  .action-spacer { display: none; }
  .editor-actions .button { flex: 1 1 120px; }
  .dialog-actions { align-items: stretch; flex-direction: column; }
  .dialog-actions .button { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
</style>
