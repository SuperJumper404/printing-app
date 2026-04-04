<template>
  <div class="main-content">
    <div class="card">
      <h1 class="text-3xl font-bold">Liste des impressions en cours</h1>
      <br />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
const { ipcRenderer } = window.require("electron");
import axios from "axios";
import config from "../config.json";

const configVars = config[import.meta.env.VITE_USER_NODE_ENV];
console.log("configVars", configVars);

const userSession = ref(null);

onMounted(async () => {
  userSession.value = await ipcRenderer.invoke("get-user-session");
  console.log("userSession", userSession);
});

setInterval(async () => {
  const printingJobs = await axios.post(configVars.pullPrintingJobUrl, {
    ID: userSession.shopid,
  });
  if (printingJobs.data && printingJobs.data.data) {
    printingJobs.data.data.forEach(async (job) => {
      // Envoie le job d'impression à l'imprimante via Electron
      await ipcRenderer.invoke("print-job", job);
    });
  }
  console.log("printingJobs", printingJobs);
}, 30000); // toutes les 30 secondesé
</script>

<style scoped>
.home {
  max-width: 720px;
  margin: 2rem auto;
  padding: 1.25rem;
  text-align: center;
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    Roboto,
    "Helvetica Neue",
    Arial;
}

.counter {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}

h4 {
  font-weight: 300;
}

button {
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  border: 1px solid #cfcfd0;
  background: #fff;
  border-radius: 6px;
  cursor: pointer;
}

.value {
  min-width: 2rem;
  text-align: center;
  font-weight: 600;
}
</style>
