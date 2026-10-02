import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { openPage, startApp, type App, type Net } from "./support/app.js";

// SERBITO-355 (P3 of the SERBITO-331 review): server errors (room full, rate limited)
// were ignored, there was no connecting/offline state, and a vote made while the
// socket was down was dropped without a word.

let app: App;
beforeAll(async () => {
  app = await startApp();
}, 60_000);
afterAll(async () => {
  await app?.close();
});

async function newRoom(a: App = app): Promise<{ page: Page; net: Net }> {
  const { page, net } = await openPage(a, { path: "/", width: 390 });
  await page.getByRole("button", { name: "Create room" }).click();
  await page.waitForSelector(".fan .card");
  return { page, net };
}

const card = (page: Page, value: string) => page.locator(".fan .card", { hasText: new RegExp(`^${value.replace("?", "\\?")}$`) });

describe("server errors are shown", () => {
  it("rate limited: the server's refusal is explained", async () => {
    const { page } = await newRoom();
    try {
      await expect.poll(() => page.locator(".conn-pill").count()).toBe(0);
      for (let i = 0; i < 40; i++) await card(page, i % 2 ? "3" : "5").click();
      await expect
        .poll(() => page.getByRole("alert").textContent())
        .toBe("Too many actions at once. Wait a moment and try again.");
    } finally {
      await page.context().close();
    }
  }, 30_000);

  it("a refused join (too many new rooms) says why and offers to try again", async () => {
    const strict = await startApp({ roomCreatesPerIp: 0 });
    try {
      const { page } = await newRoom(strict);
      await expect
        .poll(() => page.getByRole("alert").textContent())
        .toContain("Too many new rooms from your network.");
      expect(await page.getByRole("button", { name: "Try again" }).isVisible()).toBe(true);
      await page.context().close();
    } finally {
      await strict.close();
    }
  }, 60_000);
});

describe("connection state", () => {
  it("shows Reconnecting while the socket is down, and clears it when back", async () => {
    const { page, net } = await newRoom();
    try {
      await expect.poll(() => page.locator(".conn-pill").count()).toBe(0);
      net.down();
      await expect.poll(() => page.locator(".conn-pill").textContent()).toBe("Connection lost. Reconnecting…");
      expect(await page.getByRole("button", { name: "Reveal" }).isDisabled()).toBe(true);
      net.up();
      await expect.poll(() => page.locator(".conn-pill").count(), { timeout: 10_000 }).toBe(0);
    } finally {
      await page.context().close();
    }
  }, 30_000);

  it("a vote made while offline is kept and sent on reconnect", async () => {
    const { page, net } = await newRoom();
    try {
      await expect.poll(() => page.locator(".conn-pill").count()).toBe(0);
      net.down();
      await expect.poll(() => page.locator(".conn-pill").count()).toBe(1);
      await card(page, "8").click();
      expect(await card(page, "8").getAttribute("class")).toContain("selected");
      expect(await page.locator(".conn-pill").textContent()).toBe(
        "Connection lost. Your vote will be sent when it's back.",
      );
      const before = net.sent.length;
      net.up();
      await expect
        .poll(() => net.sent.slice(before).map((m) => m.type), { timeout: 10_000 })
        .toEqual(["join", "vote"]);
      expect(net.sent.at(-1)).toEqual({ type: "vote", value: "8" });
      // The server has it: our seat shows a cast vote, and the card stays picked.
      await expect.poll(() => page.locator(".participants .card-slot").textContent()).toBe("✓");
      expect(await card(page, "8").getAttribute("class")).toContain("selected");
    } finally {
      await page.context().close();
    }
  }, 30_000);
});
