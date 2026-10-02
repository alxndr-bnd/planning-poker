// The real app in real Chromium, against the real server (SERBITO-355).
//
// buildApp() bundles client/src/main.tsx with esbuild into a throwaway dist (the app
// shell is client/index.html with the cross-promo filled in, as the Vite build does),
// startApp() serves it with createPokerServer, and openRoom() opens a page on it with
// the outside world (GA, Cloudflare, shields.io) cut off. WebSocket traffic runs
// through page.routeWebSocket, so a test can drop the connection and keep it down.
//
// The server's tsconfig has no DOM lib (and must not get one): browser-side code is
// passed to page.evaluate as strings.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from "playwright-core";
import { createPokerServer, type PokerServerLimits } from "../../src/server.js";
import { injectCrossPromo } from "../../../client/src/crosspromo.js";

const here = dirname(fileURLToPath(import.meta.url)); // server/test/support
const clientDir = join(here, "../../../client");

/** Bundle the client into a fresh dist directory. */
export async function buildApp(): Promise<string> {
  const dist = mkdtempSync(join(tmpdir(), "pp-app-"));
  await build({
    entryPoints: [join(clientDir, "src/main.tsx")],
    bundle: true,
    format: "esm",
    outdir: join(dist, "assets"),
    entryNames: "app",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    external: ["/table-felt.jpg"],
    logLevel: "silent",
  });
  const shell = injectCrossPromo(readFileSync(join(clientDir, "index.html"), "utf-8")).replace(
    '<script type="module" src="/src/main.tsx"></script>',
    '<link rel="stylesheet" href="/assets/app.css" /><script type="module" src="/assets/app.js"></script>',
  );
  writeFileSync(join(dist, "index.html"), shell);
  copyFileSync(join(clientDir, "public/consent.js"), join(dist, "consent.js"));
  for (const lang of ["ru", "de"]) {
    mkdirSync(join(dist, lang, "glossary"), { recursive: true });
    writeFileSync(join(dist, lang, "glossary/index.html"), "<!doctype html><title>guide</title>");
  }
  return dist;
}

export interface App {
  browser: Browser;
  server: Server;
  origin: string;
  dist: string;
  close(): Promise<void>;
}

export async function startApp(limits: Partial<PokerServerLimits> = {}): Promise<App> {
  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    if (/Executable doesn't exist|playwright install/.test(String(e))) {
      throw new Error("No Chromium for Playwright: npx playwright-core install chromium");
    }
    throw e;
  }
  const dist = await buildApp();
  const server = createPokerServer(dist, limits);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://localhost:${port}`;
  return {
    browser,
    server,
    origin,
    dist,
    async close() {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dist, { recursive: true, force: true });
    },
  };
}

/** Switch for a page's WebSocket: `down()` drops it and refuses reconnects until `up()`. */
export interface Net {
  /** Client -> server messages, parsed, in order (also those sent while down). */
  sent: Record<string, unknown>[];
  down(): void;
  up(): void;
  /** Close the page's socket with `code`, as the server does (e.g. 4000: idle). */
  kick(code: number): void;
}

export interface OpenOptions {
  /** Page viewport width (height 844). */
  width?: number;
  /** localStorage before the first script runs. Default: a name and a cookie choice. */
  storage?: Record<string, string>;
  /** Browser UI language (navigator.language). */
  locale?: string;
  /** Path + query + hash to open, e.g. `/#/r/<id>`. */
  path: string;
  /** sessionStorage before the first script runs. */
  session?: Record<string, string>;
  /** A touch device (coarse pointer). Default: below 600 px. */
  touch?: boolean;
  /** Grant clipboard access (default true). */
  clipboard?: boolean;
}

export interface Opened {
  page: Page;
  context: BrowserContext;
  net: Net;
}

const CONSENT = JSON.stringify({ choice: "denied", date: new Date().toISOString() });

export async function openPage(app: App, opts: OpenOptions): Promise<Opened> {
  const context = await app.browser.newContext({
    viewport: { width: opts.width ?? 390, height: 844 },
    locale: opts.locale ?? "en-US",
    hasTouch: opts.touch ?? (opts.width ?? 390) < 600,
    isMobile: opts.touch ?? (opts.width ?? 390) < 600,
  });
  if (opts.clipboard !== false) {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.origin });
  }
  const storage = opts.storage ?? { pp_name: "Ann", pp_lang: "en" };
  const local = { pp_consent: CONSENT, ...storage };
  await context.addInitScript(
    `(() => { const l = ${JSON.stringify(local)}, s = ${JSON.stringify(opts.session ?? {})};
      if (sessionStorage.getItem("__pp_init")) return; sessionStorage.setItem("__pp_init", "1");
      for (const k in l) localStorage.setItem(k, l[k]);
      for (const k in s) sessionStorage.setItem(k, s[k]); })()`,
  );
  await context.route("**/*", (route) =>
    route.request().url().startsWith(app.origin + "/") ? route.continue() : route.abort(),
  );
  const net = await routeNet(context);
  const page = await context.newPage();
  await page.goto(app.origin + opts.path);
  return { page, context, net };
}

async function routeNet(context: BrowserContext): Promise<Net> {
  let online = true;
  const live = new Set<WebSocketRoute>();
  const net: Net = {
    sent: [],
    down() {
      online = false;
      for (const ws of live) ws.close({ code: 4999, reason: "test: network down" });
      live.clear();
    },
    up() {
      online = true;
    },
    kick(code: number) {
      for (const ws of live) ws.close({ code, reason: "test: kicked" });
      live.clear();
    },
  };
  await context.routeWebSocket(/\/ws/, (ws) => {
    if (!online) {
      ws.close({ code: 4999, reason: "test: network down" });
      return;
    }
    live.add(ws);
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      try {
        net.sent.push(JSON.parse(String(m)));
      } catch {
        /* not JSON */
      }
      server.send(m);
    });
    ws.onClose(() => live.delete(ws));
  });
  return net;
}

/** Bounding boxes of every element matching `selector`, in document order. */
export function boxes(
  page: Page,
  selector: string,
): Promise<{ x: number; y: number; width: number; height: number; text: string }[]> {
  return page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, text: e.textContent.trim() };
  })`);
}

/** A fresh, valid room id. */
export const roomId = (tag: string) => `t${tag}${Math.random().toString(36).slice(2, 10)}`.slice(0, 32);
