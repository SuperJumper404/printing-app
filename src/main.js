import { createApp } from "vue";
import App from "./App.vue";
import { startDeviceBridge } from "./deviceBridge";

startDeviceBridge();
createApp(App).mount("#app");
