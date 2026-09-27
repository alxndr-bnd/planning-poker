import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { get as httpGetRaw } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createPokerServer } from "../src/server.js";
import {
  ORIGIN,
  generateSitemap,
  gitHistoryAvailable,
  listPages,
} from "../../scripts/sitemap.js";

// SERBITO-305: sitemap.xml is generated from the real pages (scripts/sitemap.ts) and
// committed, because the Docker build has no git history to date them. These tests keep
// it complete, served and fresh. Stale? Run `npm run sitemap` and commit the result.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const repoRoot = join(here, "../..");
const clientDir = join(repoRoot, "client");
const sitemapXml = readFileSync(join(clientDir, "public/sitemap.xml"), "utf-8");

interface Url {
  loc: string;
  lastmod: string;
  alternates: { hreflang: string; href: string }[];
}
const urls: Url[] = [...sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
  loc: body.match(/<loc>([^<]+)<\/loc>/)![1],
  lastmod: body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "",
  alternates: [
    ...body.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g),
  ].map(([, hreflang, href]) => ({ hreflang, href })),
}));
const locs = urls.map((u) => u.loc);

/** Source file behind a sitemap URL: / -> client/index.html, /x -> public/x/index.html. */
const fileFor = (loc: string) =>
  loc === `${ORIGIN}/`
    ? join(clientDir, "index.html")
    : join(clientDir, "public", loc.slice(ORIGIN.length + 1), "index.html");

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim();
}

describe("sitemap.xml (generated from the pages)", () => {
  it("lists the home page and every client/public/**/index.html, each once", () => {
    const pages = (readdirSync(join(clientDir, "public"), { recursive: true }) as string[])
      .filter((p) => p === "index.html" || p.endsWith("/index.html"))
      .map((p) => `${ORIGIN}/${dirname(p)}`);
    expect(pages.length).toBeGreaterThanOrEqual(36); // 4 topics x 9 languages today
    expect(new Set(locs).size).toBe(locs.length);
    expect([...locs].sort()).toEqual([`${ORIGIN}/`, ...pages].sort());
  });

  it("each <loc> is its page's own canonical URL", () => {
    for (const loc of locs) {
      const html = readFileSync(fileFor(loc), "utf-8");
      expect(html, loc).toContain(`<link rel="canonical" href="${loc}" />`);
    }
  });

  it("hreflang alternates match the page's own tags (incl. pt-BR) and point at listed URLs", () => {
    for (const u of urls) {
      const html = readFileSync(fileFor(u.loc), "utf-8");
      const own = [
        ...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g),
      ].map(([, hreflang, href]) => ({ hreflang, href }));
      expect(u.alternates, u.loc).toEqual(own);
      for (const a of u.alternates) expect(locs, `${u.loc} -> ${a.href}`).toContain(a.href);
    }
    const guide = urls.find((u) => u.loc === `${ORIGIN}/pt/glossary`)!;
    expect(guide.alternates).toContainEqual({
      hreflang: "pt-BR",
      href: `${ORIGIN}/pt/glossary`,
    });
  });

  it("lastmod is each page's last git commit date (today if uncommitted), not a constant", () => {
    expect(gitHistoryAvailable(), "needs a full (non-shallow) git checkout").toBe(true);
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    for (const u of urls) {
      const rel = relative(repoRoot, fileFor(u.loc));
      const dirty = git(["status", "--porcelain", "--", rel]) !== "";
      const expected = dirty ? today : git(["log", "-1", "--format=%cs", "--", rel]);
      expect(u.lastmod, `${u.loc}: stale — run \`npm run sitemap\``).toBe(expected);
    }
  });

  it("the committed file is exactly what `npm run sitemap` generates", () => {
    expect(gitHistoryAvailable(), "needs a full (non-shallow) git checkout").toBe(true);
    expect(sitemapXml, "sitemap.xml is stale — run `npm run sitemap`").toBe(
      generateSitemap(clientDir),
    );
    expect(listPages(clientDir).map((pg) => pg.loc)).toEqual(locs);
  });
});

// Serve a dist laid out the way `vite build` produces it (public/ copied as-is,
// index.html at the root) and hit every sitemap URL through the real server.
describe("every sitemap URL is served", () => {
  let server: Server;
  let base: string;
  let dist: string;

  function status(path: string): Promise<{ status: number; type: string; body: string }> {
    return new Promise((resolve, reject) => {
      httpGetRaw(`${base}${path}`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers["content-type"]),
            body,
          }),
        );
      }).on("error", reject);
    });
  }

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "pp-sitemap-"));
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

  it("with 200 and the page itself", async () => {
    for (const loc of locs) {
      const res = await status(loc.slice(ORIGIN.length));
      expect(res.status, loc).toBe(200);
      expect(res.type, loc).toContain("text/html");
      expect(res.body, loc).toContain(`<link rel="canonical" href="${loc}" />`);
    }
  });

  it("serves /sitemap.xml itself, and /nonexistent is a 404", async () => {
    expect((await status("/sitemap.xml")).status).toBe(200);
    expect((await status("/nonexistent")).status).toBe(404);
    expect((await status("/ru")).status).toBe(404); // no language home pages
  });
});
