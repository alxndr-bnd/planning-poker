import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies the WebSocket to the local Node server on :8080,
// so the client talks to the same-origin `/ws` path in dev and in prod.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
    // allow importing the workspace `shared` package source from outside client/
    fs: { allow: [".."] },
  },
});
