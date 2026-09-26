import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { injectCrossPromo } from "./src/crosspromo.js";

// Renders the "Other projects" block into index.html (dev + build) and into the
// prerendered guide pages, which Vite copies from public/ untouched (build only).
function crossPromo(): Plugin {
  let outDir = "dist";
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith(".html")
          ? [join(dir, e.name)]
          : [],
    );
  return {
    name: "pp-crosspromo",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml: (html) => injectCrossPromo(html),
    writeBundle() {
      for (const file of walk(outDir)) {
        const html = readFileSync(file, "utf-8");
        const out = injectCrossPromo(html);
        if (out !== html) writeFileSync(file, out);
      }
    },
  };
}

// Dev server proxies the WebSocket to the local Node server on :8080,
// so the client talks to the same-origin `/ws` path in dev and in prod.
export default defineConfig({
  plugins: [react(), crossPromo()],
  server: {
    port: 5173,
    proxy: {
      // Local dev server runs on 8090 (8080 may be taken by other local apps).
      "/ws": { target: "ws://localhost:8090", ws: true },
    },
    // allow importing the workspace `shared` package source from outside client/
    fs: { allow: [".."] },
  },
});
