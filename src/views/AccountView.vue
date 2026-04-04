<template>
  <div class="main-content">
    <div class="card">
      <div v-if="isConnected === false">
        <h1 class="text-2xl font-bold">
          Connectez-vous avec vos identifiants SmartEat.
        </h1>
        <br />
        <h4 class="font-light">
          Connectez-vous avec vos identifiants pour synchroniser les imprimantes
          avec l'application SmartEat.
        </h4>

        <div
          class="w-full items-center justify-center rounded-2xl bg-white p-6 ring-slate-200"
        >
          <form class="mt-6 space-y-4" @submit.prevent="onSubmit">
            <div>
              <label
                for="email"
                class="block text-sm font-medium text-slate-800"
                >Email</label
              >
              <input
                v-model.trim="email"
                id="email"
                name="email"
                type="email"
                autocomplete="email"
                required
                placeholder="nom@domaine.com"
                class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200"
              />
            </div>

            <div>
              <div class="flex items-center justify-between">
                <label
                  for="password"
                  class="block text-sm font-medium text-slate-800"
                  >Mot de passe</label
                >
                <button
                  type="button"
                  class="text-xs font-medium text-slate-600 hover:text-slate-900"
                  @click="showPassword = !showPassword"
                >
                  {{ showPassword ? "Masquer" : "Afficher" }}
                </button>
              </div>

              <input
                v-model="password"
                id="password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                required
                placeholder="••••••••"
                class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200"
              />
            </div>

            <button
              type="submit"
              class="w-full rounded-xl flex items-center justify-center p-0 m-0 text-sm font-semibold !bg-purple-100 hover:!bg-purple-600 hover:!text-white"
            >
              Se connecter
            </button>

            <!-- <p v-if="error" class="text-sm text-red-600">{{ error }}</p> -->
          </form>
        </div>
        Email: {{ email }} - Password :{{ password }}
      </div>
      <div v-if="isConnected === true">
        <h1 class="text-2xl font-bold">Mon compte SmartEat</h1>
        <br />
        <h4 class="font-light">
          Vous êtes connecté en tant que <b>{{ email }}</b>
        </h4>
        <h3>Restaurant {{ shop_name }}</h3>
        <h3>Shop ID: {{ shopid }}</h3>
        <div class="flex justify-center">
          <button
            @click="disconnectUser"
            class="w-40 rounded-xl mt-5 p-0 m-0 text-sm font-semibold !bg-red-100 hover:!bg-red-600 hover:!text-white"
          >
            Se deconnecter
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import axios from "axios";
import config from "../config.json";
console.log("config ENV", import.meta.env);
console.log("ENV:", import.meta.env.VITE_USER_NODE_ENV);
const configVars = config[import.meta.env.VITE_USER_NODE_ENV];
console.log("configVars", configVars);

const { ipcRenderer } = window.require("electron");

const email = ref("");
const password = ref("");
const shopid = ref("");
const shop_name = ref("");
const showPassword = ref(false);
const isConnected = ref(false);
async function onSubmit() {
  try {
    const loginResult = await axios.post(configVars.loginUrl, {
      email: email.value,
      password: password.value,
    });
    const shopInfo = await axios.get(configVars.shopInfoUrl, {
      headers: {
        Authorization: `Bearer ${loginResult.data.data[0].token}`,
      },
    });
    console.log("shopInfo", shopInfo);
    if (loginResult.data.data[0]) {
      // Sauvegarde la session utilisateur
      const currentSession = loginResult.data.data[0];
      shopid.value = currentSession.id;
      shop_name.value = shopInfo.data.data[0].shop_name;
      await ipcRenderer.invoke("set-user-session", {
        email: currentSession.email,
        shopid: currentSession.id,
        token: currentSession.token,
        shop_name: shopInfo.data.data[0].shop_name,
      });
      isConnected.value = true;
    }

    console.log("loginResult", loginResult);
  } catch (e) {
    console.error("Login error", e);
    // error.value = "Email ou mot de passe incorrect.";
  } finally {
  }
}
onMounted(async () => {
  const session = await ipcRenderer.invoke("get-user-session");
  console.log("session", session);

  if (session && session.email) {
    isConnected.value = true;
    email.value = session.email;
    shopid.value = session.shopid;
    shop_name.value = session.shop_name;
  } else {
    isConnected.value = false;
  }
});
async function disconnectUser() {
  try {
    console.log("Déconnexion utilisateur...");
    await ipcRenderer.invoke("set-user-session", null);
    isConnected.value = false;
    email.value = null;
    password.value = null;
    shop_name.value = null;
    shopid.value = null;
  } catch (e) {
    console.error("Erreur lors de la déconnexion :", e);
  }
}
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
