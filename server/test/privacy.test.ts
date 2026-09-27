import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { get as httpGetRaw } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createPokerServer } from "../src/server.js";

// SERBITO-307: /privacy says what poker stores and what analytics receive. It must be
// reachable, linked from every page's footer, in the sitemap — and keep naming what the
// code actually does (funnel events, browser storage keys), so it can't silently drift.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const clientDir = join(here, "../../client");
const PRIVACY_URL = "https://poker.serbito.rs/privacy";
const privacy = readFileSync(join(clientDir, "public/privacy/index.html"), "utf-8");

/** client/index.html + every client/public/**\/index.html (incl. /privacy itself). */
function allPages(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name === "index.html"
          ? [join(dir, e.name)]
          : [],
    );
  return [join(clientDir, "index.html"), ...walk(join(clientDir, "public")).sort()];
}

describe("/privacy page (SERBITO-307)", () => {
  let server: Server;
  let base: string;
  let dist: string;

  beforeAll(async () => {
    // A dist laid out the way `vite build` produces it.
    dist = mkdtempSync(join(tmpdir(), "pp-privacy-"));
    cpSync(join(clientDir, "public"), dist, { recursive: true });
    cpSync(join(clientDir, "index.html"), join(dist, "index.html"));
    server = createPokerServer(dist);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dist, { recursive: true, force: true });
  });

  it("is served with 200 by the real server", async () => {
    const res = await new Promise<{ status: number; type: string; body: string }>(
      (resolve, reject) => {
        httpGetRaw(`${base}/privacy`, (r) => {
          let body = "";
          r.on("data", (c) => (body += c));
          r.on("end", () =>
            resolve({ status: r.statusCode ?? 0, type: String(r.headers["content-type"]), body }),
          );
        }).on("error", reject);
      },
    );
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/html");
    expect(res.body).toContain("<h1>Privacy</h1>");
    expect(res.body).toContain(`<link rel="canonical" href="${PRIVACY_URL}" />`);
  });

  it("is linked from the footer of every page, in every language", () => {
    const pages = allPages();
    expect(pages.length).toBeGreaterThanOrEqual(38); // home + 36 guides + privacy
    const missing = pages.filter((p) => {
      const html = readFileSync(p, "utf-8");
      const footer = html.slice(html.lastIndexOf("<footer"), html.lastIndexOf("</footer>"));
      return !/<a href="\/privacy"[ >]/.test(footer);
    });
    expect(missing.map((p) => relative(clientDir, p))).toEqual([]);
  });

  it("is listed in sitemap.xml", () => {
    const xml = readFileSync(join(clientDir, "public/sitemap.xml"), "utf-8");
    expect(xml).toContain(`<loc>${PRIVACY_URL}</loc>`);
  });

  it("names every funnel event the app sends to GA4", () => {
    const app = readFileSync(join(clientDir, "src/App.tsx"), "utf-8");
    const events = [...new Set([...app.matchAll(/trackEvent\("([a-z_]+)"/g)].map((m) => m[1]))];
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const e of events) expect(privacy, e).toContain(`<code>${e}</code>`);
    expect(privacy).toContain("G-B5CQC4JJV0");
    expect(privacy).toContain("<code>/room</code>"); // rooms are one virtual page
  });

  it("names every browser storage key the app uses", () => {
    // The app's sources, plus the plain scripts every page loads from public/ (the
    // consent banner, SERBITO-320).
    const files = [
      ...readdirSync(join(clientDir, "src"))
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => join(clientDir, "src", f)),
      ...readdirSync(join(clientDir, "public"))
        .filter((f) => f.endsWith(".js"))
        .map((f) => join(clientDir, "public", f)),
    ];
    const src = files.map((f) => readFileSync(f, "utf-8")).join("\n");
    const keys = [...new Set([...src.matchAll(/["`](pp_[a-z0-9_]+)/g)].map((m) => m[1]))];
    expect(keys).toContain("pp_consent");
    expect(keys.length).toBeGreaterThanOrEqual(7);
    for (const k of keys) expect(privacy, k).toContain(`<code>${k}</code>`);
  });

  it("names the processors and a contact", () => {
    for (const s of ["Google Cloud Run", "Google Analytics", "Cloudflare", "Sentry", "shields.io"]) {
      expect(privacy).toContain(s);
    }
    expect(privacy).toContain('href="mailto:alexander.bondarchuk@gmail.com"');
  });
});
