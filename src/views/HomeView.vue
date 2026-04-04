<template>
  <div class="main-content">
    <div class="card">
      <h1 class="text-3xl font-bold">
        Bienvenue sur l'outil de gestion des imprimantes de SmartEat
      </h1>
      <br />
      <h2 class="text-xl font-semibold">Etape 1: Installation</h2>

      <h4 class="font-light">
        Voici l'ip d'écoute, veuillez la saisir dans l'onglet réglage de
        <a href="http://app.smarteat.fr">app.smarteat.fr</a>
      </h4>

      <div
        class="mt-4"
        style="
          border-radius: 10px;
          background-color: antiquewhite;
          padding: 5px;
        "
      >
        <h3 class="font-bold">IP: {{ targetConfig.targetIp }}</h3>
        <h3 class="font-bold">Port: {{ targetConfig.targetPort }}</h3>
        <h3 class="font-bold">
          Lien Complet : {{ targetConfig.targetBaseUrl }}
        </h3>
      </div>

      <h2 class="text-xl font-semibold">Etape 2: Configuration</h2>

      <h4 class="font-light">
        La détection des imprimantes est automatique. Ne lancer une recherche
        qu'au bout de 3 minutes sans résulat et assurez vous que vous
        imprimantes sont bien allumées et connectées à internet
      </h4>
      <br />
      <h4 class="font-light">
        1. Pour chaque imprimantes vous devez choisir au minimum un types de
        ticket et activer au moins un protocole d'impression en fonction de
        votre type d'imprimante
      </h4>
      <h4 class="font-light">
        2. Les imprimantes EPSON sont recommandées. Sélectionnez HTTP (80)
      </h4>
      <h4 class="font-light">
        3. Pour les imprimantes thermiques normales -> ESC/POS 9100
      </h4>
      <h4 class="font-light">
        Important: Il faut au minimum activer un type de ticket et un protocol
        pour utiliser le button d'impression test.
      </h4>

      <h2 class="text-xl font-semibold">Aide & Contact</h2>
      <h4 class="font-light">En cas</h4>
    </div>
    <pre type="json">{{ targetConfig }}</pre>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
const { ipcRenderer } = window.require("electron");

let targetConfig = ref("");

onMounted(async () => {
  targetConfig.value = await ipcRenderer.invoke("get-target-config");
  console.log("targetConfig", targetConfig);
});
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
