<template>
  <div class="printing-page">
    <div class="card">
      <div class="history-header">
        <div>
          <h1 class="text-3xl font-bold">Historique des impressions</h1>
          <p class="subtitle">Les 100 dernières demandes d’impression de cet agent.</p>
        </div>
        <button class="btn-refresh" @click="loadHistory">Rafraîchir</button>
      </div>

      <div v-if="loading" class="empty-state">Chargement de l'historique...</div>
      <div v-else-if="history.length === 0" class="empty-state">
        Aucune impression pour le moment.
      </div>

      <div v-else class="history-list">
        <article
          v-for="ticket in history"
          :key="ticket.id"
          class="ticket-card"
          :class="ticket.status === 'success' ? 'success' : 'error'"
        >
          <div class="ticket-main">
            <div>
              <div class="ticket-title">
                {{ getTicketTitle(ticket) }}
              </div>
              <div class="ticket-meta">
                {{ formatDate(ticket.printedAt) }} - {{ ticket.ticketType }}
              </div>
            </div>
            <span class="status-pill">
              {{ statusLabel(ticket.status) }}
            </span>
          </div>

          <div class="ticket-details">
            <span>{{ ticket.printerCount || 0 }} imprimante(s)</span>
            <span>{{ ticket.protocolCount || 0 }} protocole(s)</span>
            <span v-if="ticket.error" class="error-text">{{ ticket.error }}</span>
          </div>

          <details class="payload-details">
            <summary>Voir le ticket</summary>
            <pre>{{ ticket.printableText || "Aperçu indisponible" }}</pre>
          </details>

          <details class="payload-details">
            <summary>Voir les données</summary>
            <pre>{{ formatPayload(ticket.payload) }}</pre>
          </details>

          <div class="ticket-actions">
            <button
              class="btn-pdf"
              :disabled="openingPdfId === ticket.id"
              @click="openPdf(ticket)"
            >
              {{ openingPdfId === ticket.id ? "Ouverture..." : "Voir PDF" }}
            </button>
            <button
              class="btn-reprint"
              :disabled="reprintingId === ticket.id"
              @click="reprint(ticket)"
            >
              {{ reprintingId === ticket.id ? "Réimpression…" : "Réimprimer" }}
            </button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
const { ipcRenderer } = window.require("electron");
const history = ref([]);
const loading = ref(true);
const reprintingId = ref(null);
const openingPdfId = ref(null);
function statusLabel(status) {
  return ({ success: "Transmis", partial: "Transmission partielle", unknown: "Résultat incertain", error: "Erreur" })[status] || "Erreur";
}

async function loadHistory() {
  loading.value = true;
  try {
    history.value = await ipcRenderer.invoke("get-print-history");
  } catch (error) {
    console.error("Erreur chargement historique:", error);
  } finally {
    loading.value = false;
  }
}

async function reprint(ticket) {
  reprintingId.value = ticket.id;
  try {
    await ipcRenderer.invoke("reprint-ticket", ticket.id);
    await loadHistory();
  } catch (error) {
    console.error("Erreur reimpression:", error);
  } finally {
    reprintingId.value = null;
  }
}

async function openPdf(ticket) {
  openingPdfId.value = ticket.id;
  try {
    await ipcRenderer.invoke("open-ticket-pdf", ticket.id);
  } catch (error) {
    console.error("Erreur ouverture PDF:", error);
  } finally {
    openingPdfId.value = null;
  }
}

function getTicketTitle(ticket) {
  const payload = ticket.payload || {};
  return (
    payload.title ||
    payload.orderNumber ||
    payload.ticketNumber ||
    payload.reference ||
    `Ticket ${ticket.id.slice(0, 8)}`
  );
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatPayload(payload) {
  return JSON.stringify(payload || {}, null, 2);
}

onMounted(async () => {
  ipcRenderer.on("print-history-updated", loadHistory);
  await loadHistory();
});

onBeforeUnmount(() => {
  ipcRenderer.removeListener("print-history-updated", loadHistory);
});
</script>

<style scoped>
.printing-page {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding: 24px;
}

.history-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

@media (max-width: 760px) {
  .printing-page { padding: 16px; }
}

.subtitle {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 14px;
}

.btn-refresh,
.btn-reprint,
.btn-pdf {
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.btn-refresh {
  background: #3498db;
  color: #fff;
  padding: 10px 16px;
}

.btn-reprint {
  background: #16a085;
  color: #fff;
  padding: 8px 14px;
}

.btn-pdf {
  background: #334155;
  color: #fff;
  padding: 8px 14px;
}

.btn-reprint:disabled,
.btn-pdf:disabled {
  cursor: wait;
  opacity: 0.7;
}

.empty-state {
  margin-top: 24px;
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  padding: 18px;
  color: #64748b;
  text-align: center;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 24px;
}

.ticket-card {
  border: 1px solid #e2e8f0;
  border-left: 5px solid #22c55e;
  border-radius: 10px;
  padding: 16px;
  background: #fff;
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.06);
}

.ticket-card.error {
  border-left-color: #ef4444;
}

.ticket-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.ticket-title {
  color: #0f172a;
  font-size: 17px;
  font-weight: 700;
}

.ticket-meta {
  margin-top: 4px;
  color: #64748b;
  font-size: 13px;
}

.status-pill {
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  font-size: 12px;
  font-weight: 700;
  padding: 5px 10px;
}

.ticket-card.error .status-pill {
  background: #fee2e2;
  color: #991b1b;
}

.ticket-details {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  color: #475569;
  font-size: 13px;
}

.error-text {
  color: #b91c1c;
}

.payload-details {
  margin-top: 12px;
}

.payload-details summary {
  cursor: pointer;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.payload-details pre {
  max-height: 240px;
  overflow: auto;
  margin: 10px 0 0;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px;
  font-size: 12px;
}

.ticket-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
