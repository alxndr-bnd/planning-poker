import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLogger, defineConfig, type Logger, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { injectCrossPromo } from "./src/crosspromo.js";
import { analyticsFromEnv, renderAnalytics } from "./src/pageAnalytics.js";

// Optional analytics (SERBITO-513), read at build time: GA_MEASUREMENT_ID (GA4 + the cookie
// banner) and CF_BEACON_TOKEN (Cloudflare Web Analytics). Unset = the pages load neither.
// The live site gets both from deploy.yml through Docker build args.
const analytics = analyticsFromEnv(process.env);

// Renders per-page blocks into index.html (dev + build) and into the prerendered guide
// pages, which Vite copies from public/ untouched (build only): the "Other projects" block
// and the analytics blocks.
function renderPages(): Plugin {
  let outDir = "dist";
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith(".html")
          ? [join(dir, e.name)]
          : [],
    );
  const render = (html: string) => renderAnalytics(injectCrossPromo(html), analytics);
  return {
    name: "pp-render-pages",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml: render,
    writeBundle() {
      for (const file of walk(outDir)) {
        const html = readFileSync(file, "utf-8");
        const out = render(html);
        if (out !== html) writeFileSync(file, out);
      }
    },
  };
}

// Zero-warning builds (SERBITO-613): a warning from Vite (chunk size, a missing asset) or
// from the bundler (an unresolved import, an eval) fails `vite build`, so CI and the release
// gate stop on it. The dev server only prints them.
function failOnWarning(base: Logger): Logger {
  const fail = (msg: string): never => {
    throw new Error(`client build: warnings are errors (SERBITO-613):\n${msg}`);
  };
  return { ...base, warn: fail, warnOnce: fail };
}

// Dev server proxies the WebSocket to the local Node server on :8080,
// so the client talks to the same-origin `/ws` path in dev and in prod.
export default defineConfig(({ command }) => ({
  plugins: [react(), renderPages()],
  ...(command === "build" && { customLogger: failOnWarning(createLogger()) }),
  build: {
    rolldownOptions: {
      onwarn(warning) {
        throw new Error(`client build: warnings are errors (SERBITO-613): ${warning.message}`);
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Local dev server runs on 8090 (8080 may be taken by other local apps).
      "/ws": { target: "ws://localhost:8090", ws: true },
    },
    // allow importing the workspace `shared` package source from outside client/
    fs: { allow: [".."] },
  },
}));
