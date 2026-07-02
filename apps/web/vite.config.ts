import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Pre-bundlear todo lo que usa la app evita el "reload storm" del
    // optimizador de Vite en el primer arranque (dejaba la página en blanco).
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router-dom",
      "three",
      "three/examples/jsm/loaders/GLTFLoader.js",
      "three/examples/jsm/controls/OrbitControls.js",
    ],
  },
  server: {
    port: 5199,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
