import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EN, LANGS, t } from "../../client/src/i18n.js";
import { securityHeaders } from "../src/static.js";
import { openPage, startApp, type App } from "./support/app.js";

// SERBITO-484 (PROGRESS.md Gap 2): the GitHub star badge was an image from shields.io,
// so every visit told shields.io the visitor's IP. Now it is a plain text link to the
// repository: no third-party request, nothing to disclose on /privacy.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const REPO = "https://github.com/alxndr-bnd/planning-poker";

let app: App;
beforeAll(async () => {
  app = await startApp();
}, 60_000);
afterAll(async () => {
  await app?.close();
});

describe("GitHub link without shields.io", () => {
  it("the lobby links the repo as text and the page asks nothing of shields.io", async () => {
    const { page } = await openPage(app, { path: "/", width: 1280 });
    const external: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith(app.origin + "/")) external.push(r.url());
    });
    try {
      await page.reload();
      const link = page.getByRole("link", { name: EN["github.star"] });
      await link.waitFor();
      expect(await link.getAttribute("href")).toBe(REPO);
      expect(await page.locator('img[src*="shields.io"]').count()).toBe(0);
      expect(external.filter((u) => u.includes("shields.io"))).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  it("the link text exists in every UI language", () => {
    for (const { code } of LANGS) expect(t(code, "github.star"), code).toMatch(/GitHub/);
  });

  it("no client source, CSP or privacy page refers to shields.io", () => {
    const app = readFileSync(join(here, "../../client/src/App.tsx"), "utf-8");
    const privacy = readFileSync(join(here, "../../client/public/privacy/index.html"), "utf-8");
    const csp = securityHeaders(join(here, "no-dist"))["content-security-policy-report-only"];
    for (const [name, text] of [["App.tsx", app], ["privacy", privacy], ["CSP", csp]]) {
      expect(text, name).not.toContain("shields.io");
    }
  });
});
