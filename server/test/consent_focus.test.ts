import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type ElementHandle, type Page } from "playwright-core";

// SERBITO-374: the "focus never hidden" check (SERBITO-350) must not scroll the page
// when the browser window gets focus back. On a window refocus (another app, another
// tab) the browser fires focus/focusin again on document.activeElement: not a focus
// move, so the page stays put. Tab onto a link under the cover must still bring it into
// view (WCAG 2.4.11). The cover is the cookie bar while it is open, else the app shell's
// fixed footer.
//
// Real Chromium on the real app shell (client/index.html, the React bundle stubbed out),
// full Chromium headless (channel "chromium", not the headless shell) with focus
// emulation off: otherwise window blur/focus never fire and the test passes for
// nothing. No browser: fails with the install command, never skips.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const clientDir = join(here, "../../client");
const BASE = "https://poker.test";
const SHELL = readFileSync(join(clientDir, "index.html"));
const CONSENT_JS = readFileSync(join(clientDir, "public/consent.js"));
const CHOICE = JSON.stringify({ choice: "denied", date: new Date().toISOString() });

// Browser-side code below runs in the page, not in Node. The server's tsconfig has no
// DOM lib (and must not get one), so these are typed here, for this module only.
type Rect = { top: number; bottom: number; height: number };
type El = { getBoundingClientRect(): Rect; focus(): void };
declare const document: {
  querySelector(s: string): El | null;
  activeElement: unknown;
  hasFocus(): boolean;
  readyState: string;
  addEventListener(t: string, f: () => void): void;
};
declare const window: { focusins: number };
declare const scrollY: number;
declare function scrollBy(x: number, y: number): void;
declare function requestAnimationFrame(f: (t: number) => void): void;

// Put the element's middle at the cover's middle; is the element under the cover?
const under = (page: Page, el: ElementHandle, cover: string) =>
  page.evaluate(([e, sel]) => {
    const c = document.querySelector(sel)!.getBoundingClientRect();
    const r = e.getBoundingClientRect();
    scrollBy(0, r.top + r.height / 2 - (c.top + c.height / 2));
  }, [el as unknown as El, cover] as const);
const covered = (page: Page, el: ElementHandle, cover: string) =>
  page.evaluate(([e, sel]) => {
    const c = document.querySelector(sel)!.getBoundingClientRect();
    const r = e.getBoundingClientRect();
    return r.bottom > c.top && r.top < c.bottom;
  }, [el as unknown as El, cover] as const);

let browser: Browser;

beforeAll(async () => {
  try {
    browser = await chromium.launch({ channel: "chromium" });
  } catch (e) {
    if (/Executable doesn't exist|playwright install/.test(String(e))) {
      throw new Error("No Chromium for Playwright: npx playwright-core install chromium");
    }
    throw e;
  }
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

async function open(choice: boolean): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (choice) await ctx.addInitScript(`localStorage.setItem("pp_consent", ${JSON.stringify(CHOICE)})`);
  await ctx.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!route.request().url().startsWith(BASE + "/")) return route.abort(); // GA, Cloudflare
    if (path === "/") return route.fulfill({ body: SHELL, contentType: "text/html" });
    if (path === "/consent.js") return route.fulfill({ body: CONSENT_JS, contentType: "text/javascript" });
    return route.fulfill({ body: "", contentType: "text/javascript" }); // the React bundle
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/");
  await page.waitForFunction(() => document.readyState === "complete");
  expect(errors).toEqual([]);
  return page;
}

const settle = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

describe("window refocus (SERBITO-374)", () => {
  for (const { what, choice, cover } of [
    { what: "cookie bar open", choice: false, cover: ".ppc" },
    { what: "after the cookie choice: fixed footer", choice: true, cover: "[data-pp-fixed-bottom]" },
  ]) {
    it(`${what}: refocus does not scroll; Tab still clears the cover`, async () => {
      const page = await open(choice);
      try {
        expect(await page.isVisible(".ppc")).toBe(!choice);
        await page.context().newCDPSession(page).then((s) => s.send("Emulation.setFocusEmulationEnabled", { enabled: false }));
        await page.bringToFront();
        expect(await page.evaluate(() => document.hasFocus()), "the window has no focus").toBe(true);
        await page.evaluate(() => {
          window.focusins = 0;
          document.addEventListener("focusin", () => window.focusins++);
        });
        const links = page.locator(".pp-seo ul a");
        const first = (await links.nth(0).elementHandle())!;
        const second = (await links.nth(1).elementHandle())!;

        await first.evaluate((el) => (el as unknown as El).focus());
        await settle(page);
        await under(page, first, cover);
        await settle(page);
        expect(await covered(page, first, cover), "the link is not under the cover").toBe(true);
        const y = await page.evaluate(() => scrollY);
        const seen = await page.evaluate(() => window.focusins);
        const other = await page.context().newPage(); // the tab loses focus, then gets it back
        await other.bringToFront();
        await page.bringToFront();
        await other.close();
        await page.waitForFunction((n) => window.focusins > n, seen);
        await settle(page);
        expect(await first.evaluate((el) => el === document.activeElement)).toBe(true);
        expect(await page.evaluate(() => scrollY), "getting the window focus back scrolled the page").toBe(y);

        await under(page, second, cover);
        await settle(page);
        expect(await covered(page, second, cover), "the second link is not under the cover").toBe(true);
        await page.keyboard.press("Tab");
        await settle(page);
        expect(await second.evaluate((el) => el === document.activeElement), "Tab went elsewhere").toBe(true);
        expect(await covered(page, second, cover), "Tab left focus under the cover").toBe(false);
      } finally {
        await page.context().close();
      }
    }, 30_000);
  }
});
