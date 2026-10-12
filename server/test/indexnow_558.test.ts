import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- plain JS script (the deploy runner's Node cannot run .ts), no type declarations
import { indexNowKey, main, payload, sitemapUrls } from "../../scripts/indexnow.mjs";

// SERBITO-558: IndexNow tells Bing and Yandex about the sitemap URLs after a release. The key
// file is public by design; the ping must never fail a deploy. The remote-teams guide also links
// to the GTD weekly review checklist in its text, not only the footer home-page link.

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = join(root, "client/public");

describe("IndexNow (SERBITO-558)", () => {
  it("has one key file whose content is its own name", () => {
    const key: string = indexNowKey();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(readFileSync(join(publicDir, `${key}.txt`), "utf-8")).toBe(key);
  });

  it("sends only the site's own sitemap URLs, with the key location", () => {
    const xml = "<urlset><url><loc>https://poker.serbito.rs/</loc></url><url><loc>https://evil.example/x</loc></url></urlset>";
    const urls = sitemapUrls(xml, "poker.serbito.rs");
    expect(urls).toEqual(["https://poker.serbito.rs/"]);
    expect(payload("https://poker.serbito.rs", "k", urls)).toEqual({
      host: "poker.serbito.rs",
      key: "k",
      keyLocation: "https://poker.serbito.rs/k.txt",
      urlList: urls,
    });
  });

  it("exits 0 with a warning on a network error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    const log = { log: vi.fn(), warn: vi.fn() };
    try {
      expect(await main(["--base", "https://poker.serbito.rs"], log)).toBe(0);
    } finally {
      fetchSpy.mockRestore();
    }
    expect(log.warn.mock.calls[0][0]).toContain("not fatal");
  });

  it("runs after the smoke check, on tag deploys only, and cannot fail the deploy", () => {
    const yml = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf-8");
    const at = yml.indexOf("      - name: IndexNow ping");
    expect(at).toBeGreaterThan(yml.indexOf("      - name: Smoke check"));
    const step = yml.slice(at, yml.indexOf("\n\n", at));
    expect(step).toContain("if: github.event_name == 'push'");
    expect(step).toContain("continue-on-error: true");
    expect(step).toContain("node scripts/indexnow.mjs");
  });
});

describe("remote-teams guide links to the GTD weekly review in its text", () => {
  it("has a descriptive in-body link to gtd.serbito.rs/en/weekly-review", () => {
    const html = readFileSync(join(publicDir, "planning-poker-for-remote-teams/index.html"), "utf-8");
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).toContain('<a href="https://gtd.serbito.rs/en/weekly-review">GTD weekly review checklist</a>');
  });
});
