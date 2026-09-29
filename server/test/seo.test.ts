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

function httpGet(url: string): Promise<{ status: number; contentType: string }> {
  return new Promise((resolve, reject) => {
    httpGetRaw(url, (res) => {
      res.resume();
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          contentType: String(res.headers["content-type"] ?? ""),
        }),
      );
    }).on("error", reject);
  });
}

// --------------------------------------------------------------------------- #
// HTTP-level: robots.txt, sitemap.xml and og-image.jpg get the right MIME type
// (404s and clean URLs are covered in static.test.ts and sitemap.test.ts).
// --------------------------------------------------------------------------- #
describe("static file serving (SEO assets)", () => {
  let server: Server;
  let base: string;
  let dist: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "pp-seo-"));
    writeFileSync(
      join(dist, "robots.txt"),
      "User-agent: *\nAllow: /\nSitemap: https://poker.serbito.rs/sitemap.xml\n",
    );
    writeFileSync(
      join(dist, "sitemap.xml"),
      '<?xml version="1.0"?><urlset><url><loc>https://poker.serbito.rs/</loc></url></urlset>',
    );
    // The share image: its content-type is load-bearing, see the test below.
    writeFileSync(join(dist, "og-image.jpg"), Buffer.from("\xff\xd8\xff", "binary"));
    server = createPokerServer(dist);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dist, { recursive: true, force: true });
  });

  // og-image: Slack, Discord and the other unfurlers drop a share image whose
  // content-type isn't an image type (v0.42.0 shipped it as octet-stream).
  it.each([
    ["/robots.txt", "text/plain"],
    ["/sitemap.xml", "application/xml"],
    ["/og-image.jpg", "image/jpeg"],
  ])("serves %s as %s", async (path, type) => {
    const res = await httpGet(`${base}${path}`);
    expect(res.status).toBe(200);
    expect(res.contentType).toContain(type);
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

  it("guide pages carry BreadcrumbList JSON-LD; prose guides also carry Article", () => {
    const guides = [
      "what-is-planning-poker",
      "planning-poker-for-jira",
      "planning-poker-for-remote-teams",
      "glossary",
    ];
    for (const g of guides) {
      const html = readFileSync(join(clientDir, "public", g, "index.html"), "utf-8");
      expect(html).toContain('"BreadcrumbList"');
      // structured data must be valid JSON
      for (const m of html.matchAll(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      )) {
        expect(() => JSON.parse(m[1].trim())).not.toThrow();
      }
    }
    for (const g of [
      "what-is-planning-poker",
      "planning-poker-for-jira",
      "planning-poker-for-remote-teams",
    ]) {
      const html = readFileSync(join(clientDir, "public", g, "index.html"), "utf-8");
      expect(html).toContain('"@type":"Article"');
    }
  });

  it("every page's og:image is a single-line tag pointing at a file that exists", () => {
    // Single-line on purpose: Slack's and Discord's unfurlers are far less
    // forgiving than a real HTML parser about attributes split across lines.
    const pages = [
      join(clientDir, "index.html"),
      ...["", "ru/", "de/", "es/", "fr/", "ja/", "pt/", "sr/", "zh/"].flatMap((p) =>
        [
          "glossary",
          "what-is-planning-poker",
          "planning-poker-for-jira",
          "planning-poker-for-remote-teams",
        ].map((g) => join(clientDir, "public", p + g, "index.html")),
      ),
    ];
    for (const page of pages) {
      const html = readFileSync(page, "utf-8");
      const tag = html.match(/<meta property="og:image" content="([^"]+)" \/>/);
      expect(tag, `${page} has no single-line og:image`).not.toBeNull();
      const url = tag![1];
      expect(url.startsWith("https://poker.serbito.rs/")).toBe(true);
      const asset = url.replace("https://poker.serbito.rs/", "");
      expect(
        readFileSync(join(clientDir, "public", asset)).byteLength,
        `${asset} missing`,
      ).toBeGreaterThan(0);
      // Keep the card under the tightest platform budget (WhatsApp/iMessage ~300KB).
      expect(readFileSync(join(clientDir, "public", asset)).byteLength).toBeLessThan(
        300 * 1024,
      );
      for (const t of ["og:site_name", "og:image:type", "og:image:width"]) {
        expect(html, `${page} missing ${t}`).toContain(`property="${t}"`);
      }
    }
  });
});
