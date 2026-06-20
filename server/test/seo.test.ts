import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { get as httpGetRaw } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createPokerServer } from "../src/server.js";

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const clientDir = join(here, "../../client"); // planning-poker/client

function httpGet(
  url: string,
): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    httpGetRaw(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          contentType: String(res.headers["content-type"] ?? ""),
          body,
        }),
      );
    }).on("error", reject);
  });
}

// --------------------------------------------------------------------------- #
// HTTP-level: robots.txt / sitemap.xml are served with the right MIME, and the
// SPA fallback still returns index.html for unknown routes (docs: poker SEO).
// --------------------------------------------------------------------------- #
describe("static file serving (SEO assets + SPA fallback)", () => {
  let server: Server;
  let base: string;
  let dist: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "pp-seo-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><h1>app shell</h1>");
    writeFileSync(
      join(dist, "robots.txt"),
      "User-agent: *\nAllow: /\nSitemap: https://poker.serbito.rs/sitemap.xml\n",
    );
    writeFileSync(
      join(dist, "sitemap.xml"),
      '<?xml version="1.0"?><urlset><url><loc>https://poker.serbito.rs/</loc></url></urlset>',
    );
    server = createPokerServer(dist);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dist, { recursive: true, force: true });
  });

  it("serves robots.txt as text/plain", async () => {
    const res = await httpGet(`${base}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/plain");
    expect(res.body).toContain("Sitemap: https://poker.serbito.rs/sitemap.xml");
  });

  it("serves sitemap.xml as application/xml", async () => {
    const res = await httpGet(`${base}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("xml");
    expect(res.body).toContain("<loc>https://poker.serbito.rs/</loc>");
  });

  it("falls back to index.html for unknown SPA routes", async () => {
    const res = await httpGet(`${base}/room/abc123`);
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain("app shell");
  });
});

// --------------------------------------------------------------------------- #
// Artifact guards: the real source files carry the SEO content/structure that
// makes poker.serbito.rs indexable. Guard against regressions.
// --------------------------------------------------------------------------- #
describe("SEO artifacts (real source files)", () => {
  it("index.html has crawlable content: H1, key terms, FAQ structured data", () => {
    const html = readFileSync(join(clientDir, "index.html"), "utf-8");
    expect(html).toMatch(/<h1[^>]*>/i); // a real H1 in the static shell
    expect(html).toContain('"@type": "FAQPage"'); // FAQ JSON-LD
    expect(html).toContain('rel="canonical"');
    expect(html).toMatch(/name="robots"\s+content="index, follow"/);
    for (const term of [
      "Planning Poker",
      "Scrum",
      "agile",
      "story points",
      "Fibonacci",
      "sprint planning",
    ]) {
      expect(html.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("robots.txt allows crawling and points at the sitemap", () => {
    const robots = readFileSync(join(clientDir, "public/robots.txt"), "utf-8");
    expect(robots).toMatch(/Allow:\s*\//);
    expect(robots).toContain("Sitemap: https://poker.serbito.rs/sitemap.xml");
  });

  it("sitemap.xml is valid and lists the homepage", () => {
    const xml = readFileSync(join(clientDir, "public/sitemap.xml"), "utf-8");
    expect(xml).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
    expect(xml).toContain("<loc>https://poker.serbito.rs/</loc>");
  });
});
