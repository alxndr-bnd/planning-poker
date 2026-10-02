import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { boxes, openPage, startApp, type App, type Net } from "./support/app.js";

// SERBITO-355 (P1, P2 of the SERBITO-331 review): on a 390 px phone the voting cards
// overlapped into ~23 px strips, so a tap on the visible "8" voted 13, the observer
// card covered 1 and 2, and the room header was 785 px wide. Measured in real Chromium
// on the real app.

let app: App;
beforeAll(async () => {
  app = await startApp();
}, 60_000);
afterAll(async () => {
  await app?.close();
});

type Box = { x: number; y: number; width: number; height: number; text: string };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** Create a room from the lobby and wait for the hand of cards. */
async function newRoom(width: number, touch?: boolean): Promise<{ page: Page; net: Net }> {
  const { page, net } = await openPage(app, { path: "/", width, touch });
  await page.getByRole("button", { name: "Create room" }).click();
  await page.waitForSelector(".fan .card");
  return { page, net };
}

const lastVote = (net: Net) =>
  [...net.sent].reverse().find((m) => m.type === "vote" || m.type === "unvote");

for (const width of [320, 390]) {
  describe(`room at ${width} px`, () => {
    it("deck: no two controls overlap, every one is a 44 px target inside the screen", async () => {
      const { page } = await newRoom(width);
      try {
        for (const expanded of [false, true]) {
          if (expanded) await page.locator(".fan .card.toggle").click();
          const hand = await boxes(page, ".hand button");
          expect(hand.length).toBeGreaterThanOrEqual(expanded ? 18 : 13);
          for (const b of hand) {
            expect(b.width, b.text).toBeGreaterThanOrEqual(44);
            expect(b.height, b.text).toBeGreaterThanOrEqual(44);
            expect(b.x, b.text).toBeGreaterThanOrEqual(0);
            expect(b.x + b.width, b.text).toBeLessThanOrEqual(width);
          }
          for (let i = 0; i < hand.length; i++)
            for (let j = i + 1; j < hand.length; j++)
              expect(overlap(hand[i], hand[j]), `${hand[i].text} / ${hand[j].text}`).toBe(false);
        }
      } finally {
        await page.context().close();
      }
    });

    it("a tap on a card's centre votes that card", async () => {
      const { page, net } = await newRoom(width);
      try {
        await page.locator(".fan .card.toggle").click();
        const cards = (await boxes(page, ".fan .card:not(.toggle)")).map((b) => b.text);
        expect(cards).toContain("610");
        for (const [i, value] of cards.entries()) {
          // Scrolled to mid-screen, clear of the fixed footer, as a thumb would.
          await page.evaluate(
            `document.querySelectorAll(".fan .card:not(.toggle)")[${i}].scrollIntoView({ block: "center" })`,
          );
          const b = (await boxes(page, ".fan .card:not(.toggle)"))[i];
          expect(b.text).toBe(value);
          await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
          await expect.poll(() => lastVote(net)).toEqual({ type: "vote", value });
          await page.waitForSelector(".fan .card.selected");
        }
      } finally {
        await page.context().close();
      }
    }, 30_000);

    it("the page and the room header fit the screen", async () => {
      const { page } = await newRoom(width);
      try {
        expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(width);
        const header = await page.evaluate<{ scroll: number; client: number }>(
          `(() => { const h = document.querySelector(".room-top"); return { scroll: h.scrollWidth, client: h.clientWidth }; })()`,
        );
        expect(header.scroll).toBeLessThanOrEqual(header.client);
        for (const b of await boxes(page, ".room-top a, .room-top button, .room-top select")) {
          if (b.width === 0) continue; // hidden on phones
          expect(b.x, b.text).toBeGreaterThanOrEqual(0);
          expect(b.x + b.width, b.text).toBeLessThanOrEqual(width);
        }
      } finally {
        await page.context().close();
      }
    });
  });
}

describe("room on a touch tablet (820 px)", () => {
  it("cards wrap into rows of whole cards: no overlap", async () => {
    const { page } = await newRoom(820, true);
    try {
      expect(await page.evaluate(`matchMedia("(pointer: coarse)").matches`)).toBe(true);
      await page.locator(".fan .card.toggle").click();
      const hand = await boxes(page, ".hand button");
      for (let i = 0; i < hand.length; i++)
        for (let j = i + 1; j < hand.length; j++)
          expect(overlap(hand[i], hand[j]), `${hand[i].text} / ${hand[j].text}`).toBe(false);
    } finally {
      await page.context().close();
    }
  });
});

describe("room on a desktop (1280 px)", () => {
  it("the observer card does not cover the first cards", async () => {
    const { page } = await newRoom(1280);
    try {
      const [mic] = await boxes(page, ".observer-card");
      for (const card of await boxes(page, ".fan .card")) expect(overlap(mic, card), card.text).toBe(false);
    } finally {
      await page.context().close();
    }
  });

  it("keeps the fanned single row of cards", async () => {
    const { page } = await newRoom(1280);
    try {
      const cards = await boxes(page, ".fan .card");
      expect(new Set(cards.map((c) => Math.round(c.y))).size).toBe(1);
      expect(cards[0].width).toBe(84);
    } finally {
      await page.context().close();
    }
  });
});
