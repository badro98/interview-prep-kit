import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Paste mode (default) needs only Vite.
// API mode: the proxy below forwards /api -> the local Express server (server/index.js).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // 45-min recordings can take 15–30 min to transcribe + summarize.
        timeout: 60 * 60 * 1000,
        proxyTimeout: 60 * 60 * 1000,
      },
    },
  },
});
