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
          @click="view = 'account'"
          :class="{ active: view === 'account' }"
          >Mon compte</a
        >
      </nav>
      <div class="app-version">Version {{ appVersion }}</div>
    </aside>

    <main class="main-content">
      <HomeView v-if="view === 'home'" />
      <PrintingView v-if="view === 'printing'" />
      <PrintersView v-if="view === 'printers'" />
      <AccountView v-if="view === 'account'" />
    </main>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import HomeView from "@/views/HomeView.vue";
import PrintingView from "@/views/PrintingView.vue";
import PrintersView from "@/views/PrintersView.vue";
import AccountView from "@/views/AccountView.vue";
import "./style.css";
const view = ref("home");
const appVersion = ref("");

onMounted(async () => {
  try {
    const { ipcRenderer } = window.require("electron");
    appVersion.value = await ipcRenderer.invoke("get-app-version");
  } catch (error) {
    appVersion.value = "dev";
  }
});
</script>

<style>
body {
  margin: 0;
  font-family: Arial, sans-serif;
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
  margin-left: 150px;
  padding: 20px;
}
</style>
