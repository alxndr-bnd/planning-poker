import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { boxes, openPage, startApp, type App } from "./support/app.js";

// SERBITO-569: on a 375x812 phone the shell's fixed footer (85-102 px, it wraps) covered
// the vote cards at the bottom of the room; in ru no number card was fully visible.
// SERBITO-570: white text on the primary blue was 3.22:1, and a vote faded the other
// cards (opacity 0.5) to 2.4:1; number cards had no aria-pressed. Real app, real Chromium.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const CSS = readFileSync(join(here, "../../client/src/styles.css"), "utf-8");

/** WCAG 2.x relative luminance of an "rgb(...)" / "rgba(...)" / "#rrggbb" colour. */
function luminance(color: string): number {
  let hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (hex?.length === 3) hex = [...hex].map((c) => c + c).join("");
  const rgb = hex
    ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    : (/rgba?\(([^)]+)\)/.exec(color)?.[1].split(/[\s,]+/).slice(0, 3).map(Number) ?? []);
  if (rgb.length !== 3 || rgb.some(Number.isNaN)) throw new Error(`not a colour: ${color}`);
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const token = (name: string) => {
  const v = new RegExp(`--${name}:\\s*(#(?:[0-9a-f]{6}|[0-9a-f]{3}))\\b`, "i").exec(CSS)?.[1];
  if (!v) throw new Error(`no --${name} in styles.css`);
  return v;
};

describe("contrast helper", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#4f8cff", "#ffffff")).toBeCloseTo(3.22, 2); // the old primary
  });
});

describe("primary colours (SERBITO-570)", () => {
  it("white text on the primary and its hover state is at least 4.5:1", () => {
    expect(contrast(token("primary"), token("accent-ink"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("primary-hover"), token("accent-ink"))).toBeGreaterThanOrEqual(4.5);
  });
  it("no filled surface with white text uses the low-contrast --accent", () => {
    expect(CSS).not.toMatch(/background:\s*var\(--accent\)/);
  });
});

let app: App;
beforeAll(async () => {
  app = await startApp();
}, 60_000);
afterAll(async () => {
  await app?.close();
});

const W = 375;
const H = 812;

async function newRoom(lang: string, width = W, height = H): Promise<Page> {
  const { page } = await openPage(app, {
    path: "/",
    width,
    height,
    storage: { pp_name: "Ann", pp_lang: lang },
  });
  await page.locator(".lobby > button").click();
  await page.waitForSelector(".fan .card");
  await page.waitForSelector(".empty-room button.primary"); // the room state arrived
  return page;
}

/**
 * Every card of the hand whose centre is on screen: is the card itself the element
 * there (not the footer)? And does no card box touch the footer box?
 */
async function checkHand(page: Page, where: string) {
  const res = await page.evaluate<{ text: string; hit: boolean; overlap: boolean }[]>(`(() => {
    const foot = document.querySelector(".pp-foot").getBoundingClientRect();
    return [...document.querySelectorAll(".hand .card")].flatMap((c) => {
      const r = c.getBoundingClientRect();
      const overlap = r.bottom > foot.top + 0.5 && r.top < foot.bottom - 0.5;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (y < 0 || y > innerHeight) return overlap ? [{ text: c.textContent.trim(), hit: true, overlap }] : [];
      const e = document.elementFromPoint(x, y);
      return [{ text: c.textContent.trim(), hit: !!e && c.contains(e), overlap }];
    });
  })()`);
  for (const c of res) {
    expect(c.overlap, `${where}: card "${c.text}" overlaps the footer`).toBe(false);
    expect(c.hit, `${where}: the centre of card "${c.text}" is covered`).toBe(true);
  }
  return res.length;
}

describe(`room at ${W}x${H} (SERBITO-569)`, () => {
  for (const lang of ["en", "ru", "sr"]) {
    it(`${lang}: no card under the footer, right after room creation and at every scroll`, async () => {
      const page = await newRoom(lang);
      try {
        // Right after creation: the first row of number cards is fully on screen.
        const first = (await boxes(page, ".fan .card"))[0];
        expect(first.y + first.height, "first number card below the fold").toBeLessThanOrEqual(H);
        expect(await checkHand(page, "scroll 0")).toBeGreaterThan(1);
        // Every card, put at the bottom edge of the screen (ignoring scroll padding).
        const n = (await boxes(page, ".hand .card")).length;
        for (let i = 0; i < n; i++) {
          await page.evaluate(`(() => {
            const r = document.querySelectorAll(".hand .card")[${i}].getBoundingClientRect();
            scrollBy(0, r.bottom - innerHeight);
          })()`);
          await checkHand(page, `card ${i} at the bottom edge`);
        }
      } finally {
        await page.context().close();
      }
    }, 30_000);
  }

  it("the header takes at most two rows and shows one Invite button", async () => {
    const page = await newRoom("ru");
    try {
      const [header] = await boxes(page, ".room-top");
      expect(header.height).toBeLessThan(100); // three rows were 126 px
      const invites = (await boxes(page, ".room button.primary")).filter(
        (b) => b.width > 0 && /Пригласить/.test(b.text),
      );
      expect(invites).toHaveLength(1);
    } finally {
      await page.context().close();
    }
  });

  it("the lobby keeps the fixed footer", async () => {
    const { page } = await openPage(app, { path: "/", width: W, height: H });
    try {
      expect(await page.evaluate(`getComputedStyle(document.querySelector(".pp-foot")).position`)).toBe("fixed");
    } finally {
      await page.context().close();
    }
  });
});

const style = (page: Page, selector: string) =>
  page.evaluate<{ color: string; background: string; opacity: string }>(`(() => {
    const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
    return { color: s.color, background: s.backgroundColor, opacity: s.opacity };
  })()`);

describe("contrast in the room (SERBITO-570)", () => {
  for (const width of [W, 1280]) {
    it(`${width} px: Reveal and Invite, normal and hover, are at least 4.5:1`, async () => {
      const page = await newRoom("en", width, width === W ? H : 800);
      try {
        for (const sel of [".reveal-bar button.primary", ".empty-room button.primary"]) {
          const s = await style(page, sel);
          expect(contrast(s.color, s.background), sel).toBeGreaterThanOrEqual(4.5);
          if (width === W) continue; // no hover on touch
          await page.locator(sel).hover();
          const h = await style(page, sel);
          expect(contrast(h.color, h.background), `${sel}:hover`).toBeGreaterThanOrEqual(4.5);
        }
      } finally {
        await page.context().close();
      }
    });
  }

  it("after a vote, the other cards keep full opacity and at least 4.5:1", async () => {
    const page = await newRoom("en", 1280, 800);
    try {
      await page.locator(".fan .card", { hasText: /^5$/ }).click();
      await page.waitForSelector(".fan .card.selected");
      const dim = await page.evaluate<{ text: string; color: string; background: string; opacity: string }[]>(
        `[...document.querySelectorAll(".fan .card.dim")].map((e) => { const s = getComputedStyle(e);
          return { text: e.textContent.trim(), color: s.color, background: s.backgroundColor, opacity: s.opacity }; })`,
      );
      expect(dim.length).toBe(10);
      for (const s of dim) {
        expect(s.opacity, s.text).toBe("1");
        expect(contrast(s.color, s.background), s.text).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      await page.context().close();
    }
  });
});

describe("aria-pressed on the cards (SERBITO-570)", () => {
  it("every value card says whether it is your vote; it toggles with the vote", async () => {
    const page = await newRoom("en", 1280, 800);
    const pressed = () =>
      page.evaluate<Record<string, string | null>>(`Object.fromEntries(
        [...document.querySelectorAll(".fan .card:not(.toggle)")].map((c) => [c.textContent.trim(), c.getAttribute("aria-pressed")]))`);
    try {
      const before = await pressed();
      expect(Object.keys(before).length).toBe(11); // 1-55, ?, ☕
      expect(new Set(Object.values(before))).toEqual(new Set(["false"]));

      await page.locator(".fan .card", { hasText: /^8$/ }).click();
      await expect.poll(async () => (await pressed())["8"]).toBe("true");
      const voted = await pressed();
      expect(Object.entries(voted).filter(([, v]) => v === "true").map(([k]) => k)).toEqual(["8"]);

      await page.locator(".fan .card", { hasText: /^8$/ }).click(); // un-vote
      await expect.poll(async () => (await pressed())["8"]).toBe("false");

      const toggle = page.locator(".fan .card.toggle");
      expect(await toggle.getAttribute("aria-expanded")).toBe("false");
      await toggle.click();
      expect(await toggle.getAttribute("aria-expanded")).toBe("true");
      expect(await page.locator(".observer-card").getAttribute("aria-pressed")).toBe("false");
    } finally {
      await page.context().close();
    }
  });
});
