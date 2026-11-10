import { createApp } from "vue";
import App from "./App.vue";
import { startDeviceBridge } from "./deviceBridge";
import config from "./config.json";

startDeviceBridge();
const { ipcRenderer } = window.require("electron");
const configVars = config[import.meta.env.VITE_USER_NODE_ENV];
if (configVars?.pullPrintingJobUrl) {
  ipcRenderer.invoke("configure-print-polling", { endpoint: configVars.pullPrintingJobUrl })
    .catch(error => console.error("Récupération automatique indisponible :", error.message));
}
createApp(App).mount("#app");
