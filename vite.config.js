import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import tailwindcss from "@tailwindcss/vite";

// Configuration Vite pour ton projet Electron + Vue
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  root: "./src", // ton code Vue est dans /src
  base: "", // pour que tout fonctionne en build local
  build: {
    outDir: "../frontend/dist", // la sortie (build Vue) ira ici
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"), // raccourci @/ vers /src
    },
  },
});
