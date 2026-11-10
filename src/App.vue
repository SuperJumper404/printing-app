<template>
  <div id="app">
    <aside class="sidebar">
      <h2>🖨️ SmartPrint</h2>
      <nav>
        <a href="#" @click="view = 'home'" :class="{ active: view === 'home' }"
          >Accueil</a
        >
        <a
          href="#"
          @click="view = 'printing'"
          :class="{ active: view === 'printing' }"
          >Mes impressions</a
        >
        <a
          href="#"
          @click="view = 'printers'"
          :class="{ active: view === 'printers' }"
          >Mes imprimantes</a
        >
        <a
          href="#"
          @click="view = 'terminals'"
          :class="{ active: view === 'terminals' }"
          >Mes TPE</a
        >
        <a
          href="#"
          @click="view = 'account'"
          :class="{ active: view === 'account' }"
          >Mon compte</a
        >
      </nav>
      <div class="service-health" role="status" aria-live="polite">
        <span class="service-indicator" :class="{ online: serviceStatus?.online }"></span>
        {{ serviceStatus === null ? "Connexion au service…" : serviceStatus.online ? "Service Windows actif" : "Service indisponible" }}
        <small v-if="serviceStatus?.online">{{ serviceStatus.companionOnline ? "Compagnon matériel connecté" : "Connexion du compagnon…" }}</small>
      </div>
      <div class="app-version">Version {{ appVersion }}</div>
    </aside>

    <main class="main-content">
      <section v-if="serviceStatus && !serviceStatus.online" class="service-banner" role="alert">
        <div>
          <strong>Le service Windows SmartEat est indisponible.</strong>
          <p>{{ serviceError || "Démarrez le service pour reprendre les impressions. Si le service n’est pas installé, relancez l’installateur SmartEat." }}</p>
        </div>
        <button type="button" :disabled="startingService" @click="startService">{{ startingService ? "Démarrage…" : "Démarrer le service" }}</button>
      </section>
      <HomeView v-if="view === 'home'" />
      <PrintingView v-if="view === 'printing'" />
      <PrintersView v-if="view === 'printers'" />
      <TerminalsView v-if="view === 'terminals'" />
      <AccountView v-if="view === 'account'" />
    </main>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import HomeView from "@/views/HomeView.vue";
import PrintingView from "@/views/PrintingView.vue";
import PrintersView from "@/views/PrintersView.vue";
import TerminalsView from "@/views/TerminalsView.vue";
import AccountView from "@/views/AccountView.vue";
import "./style.css";
const view = ref("home");
const appVersion = ref("");
const serviceStatus = ref(null);
const serviceError = ref("");
const startingService = ref(false);
const { ipcRenderer } = window.require("electron");
const updateServiceStatus = (_event, status) => { serviceStatus.value = status; };

async function startService() {
  startingService.value = true;
  serviceError.value = "";
  try {
    await ipcRenderer.invoke("restart-service");
    serviceStatus.value = await ipcRenderer.invoke("get-service-status");
  } catch { serviceError.value = "Le service ne peut pas démarrer. Vérifiez son installation et les droits de votre compte Windows."; }
  finally { startingService.value = false; }
}

onMounted(async () => {
  try {
    ipcRenderer.on("service-status-updated", updateServiceStatus);
    appVersion.value = await ipcRenderer.invoke("get-app-version");
    serviceStatus.value = await ipcRenderer.invoke("get-service-status");
  } catch (error) {
    appVersion.value = "dev";
  }
});
onBeforeUnmount(() => ipcRenderer.removeListener("service-status-updated", updateServiceStatus));
</script>

<style>
.service-health { margin-top: auto; padding-top: 20px; color: #dbe8f3; font-size: 13px; }
.service-health small { display: block; margin-top: 5px; color: #dbe8f3; }
.service-health + .app-version { margin-top: 12px; }
.service-indicator { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: #ffd68d; }
.service-indicator.online { background: #88e2b8; }
.service-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin: 16px; padding: 16px; border: 1px solid #b76b11; border-radius: 8px; background: #fff8e8; color: #653800; }
.service-banner p { margin: 5px 0 0; }
.service-banner button { flex-shrink: 0; padding: 10px 14px; border: 1px solid #8b5005; border-radius: 6px; background: #8b5005; color: #fff; font-weight: 600; cursor: pointer; }
.service-banner button:disabled { opacity: .65; cursor: wait; }
.service-banner button:focus-visible { outline: 3px solid #2563eb; outline-offset: 3px; }
body {
  margin: 0;
  font-family: "Segoe UI", Tahoma, sans-serif;
}
.sidebar {
  width: 230px;
  background: #2c3e50;
  color: #ecf0f1;
  height: 100vh; /* 👉 prend 100% de la hauteur visible */
  position: fixed; /* 👉 reste collée à gauche */
  top: 0; /* 👉 depuis le haut */
  left: 0;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow-y: auto; /* 👉 scroll interne si trop d’éléments */
}

.sidebar h2 {
  margin-top: 0;
}
.sidebar a {
  display: block;
  color: white;
  text-decoration: none;
  padding: 10px 0;
  transition: background 0.2s;
}
.sidebar a.active,
.sidebar a:hover {
  background: #34495e;
}
.app-version {
  margin-top: auto;
  padding-top: 18px;
  color: #cbd5e1;
  font-size: 12px;
  opacity: 0.9;
}
.main-content {
  margin-left: 230px;
  padding: 20px;
}

@media (max-width: 760px) {
  .sidebar {
    position: static;
    width: 100%;
    height: auto;
    padding: 12px 16px;
    overflow: visible;
  }

  .sidebar h2 {
    margin-bottom: 8px;
    font-size: 18px;
  }

  .sidebar nav {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .sidebar a {
    flex: 0 0 auto;
    padding: 8px 10px;
    border-radius: 6px;
    white-space: nowrap;
  }

  .app-version {
    display: none;
  }

  .main-content {
    margin-left: 0;
    padding: 0;
  }
}
</style>
