import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { IDLE_CLOSE_CODE } from "@pp/shared";
import { openPage, roomId, startApp, type App } from "./support/app.js";
import { getRoom } from "../src/rooms.js";

// SERBITO-355: room lifecycle and people, in Chromium against the real server.

let app: App;
beforeAll(async () => {
  app = await startApp();
}, 60_000);
afterAll(async () => {
  await app?.close();
});

async function newRoom(name = "Ann"): Promise<{ page: Page; id: string }> {
  const { page } = await openPage(app, { path: "/", storage: { pp_name: name, pp_lang: "en" } });
  await page.getByRole("button", { name: "Create room" }).click();
  await page.waitForSelector(".fan .card");
  return { page, id: new URL(page.url()).hash.slice("#/r/".length) };
}

async function join(id: string, name: string, width = 390): Promise<Page> {
  const { page } = await openPage(app, { path: `/#/r/${id}`, width, storage: { pp_name: name, pp_lang: "en" } });
  await page.waitForSelector(".participants li");
  return page;
}

describe("P6: room not found, lone host", () => {
  it("a mistyped link says the room is not found instead of creating it", async () => {
    const id = roomId("typo");
    const { page } = await openPage(app, { path: `/#/r/${id}` });
    try {
      await page.getByRole("heading", { name: "Room not found" }).waitFor();
      expect(getRoom(id)).toBeUndefined();
      await page.getByRole("button", { name: "Create a new room" }).click();
      await page.waitForSelector(".fan .card");
      const created = new URL(page.url()).hash.slice("#/r/".length);
      expect(created).not.toBe(id);
      // Poll: the cards render before the server has handled the join frame. Under parallel
      // test files the server can lag by a few ms (SERBITO-551).
      await expect.poll(() => getRoom(created)).toBeDefined();
    } finally {
      await page.context().close();
    }
  });

  it("an invite link to a live room joins it", async () => {
    const { page: host, id } = await newRoom("Host");
    const guest = await join(id, "Guest");
    try {
      await expect.poll(() => guest.locator(".participants li").count()).toBe(2);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  it("a lone host is asked to invite the team; the hint goes once someone joins", async () => {
    const { page: host, id } = await newRoom("Host");
    try {
      await host.getByText("You're the only one here.", { exact: false }).waitFor();
      const guest = await join(id, "Guest");
      await expect.poll(() => host.locator(".empty-room").count()).toBe(0);
      await guest.context().close();
    } finally {
      await host.context().close();
    }
  });
});

describe("P8: rejoin after an idle disconnect", () => {
  it("Reconnect sends a manual join; an automatic reconnect does not", async () => {
    const { page, net } = await openPage(app, { path: "/" });
    try {
      await page.getByRole("button", { name: "Create room" }).click();
      await page.waitForSelector(".fan .card");
      const joins = () => net.sent.filter((m) => m.type === "join").map((m) => m.manual);
      // Poll: the cards can render before the join frame is recorded (flaky on a busy machine).
      await expect.poll(joins).toEqual([true]);

      net.down(); // a network blip: the app reconnects by itself
      net.up();
      await expect.poll(joins, { timeout: 10_000 }).toEqual([true, false]);

      net.kick(IDLE_CLOSE_CODE); // the server's idle disconnect
      await page.getByRole("button", { name: "Reconnect" }).click();
      await expect.poll(joins).toEqual([true, false, true]);
    } finally {
      await page.context().close();
    }
  }, 30_000);
});

describe("P9a: Copied only when the link was copied", () => {
  const BROKEN_CLIPBOARD = `Object.defineProperty(navigator, "clipboard", {
    value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
  })`;

  it("clipboard refused: no 'copied' toast on create, and Invite offers the link to copy by hand", async () => {
    const { page } = await openPage(app, { path: "/", init: BROKEN_CLIPBOARD });
    try {
      await page.getByRole("button", { name: "Create room" }).click();
      await page.waitForSelector(".fan .card");
      await page.waitForTimeout(300);
      expect(await page.getByText("Invite link copied to clipboard").count()).toBe(0);

      await page.locator(".room-top").getByRole("button", { name: "Invite teammates" }).click();
      const field = page.getByRole("textbox", { name: "Couldn't copy the link. Copy it from here:" });
      await field.waitFor();
      expect(await field.inputValue()).toBe(page.url());
      expect(await page.getByText("Copied!").count()).toBe(0);
    } finally {
      await page.context().close();
    }
  });

  it("clipboard works: the toast on create, and Copied! on Invite", async () => {
    const { page } = await openPage(app, { path: "/" });
    try {
      await page.getByRole("button", { name: "Create room" }).click();
      await page.getByText("Invite link copied to clipboard").waitFor();
      await page.locator(".room-top").getByRole("button", { name: "Invite teammates" }).click();
      await page.locator(".room-top").getByRole("button", { name: "Copied!" }).waitFor();
      expect(await page.evaluate("navigator.clipboard.readText()")).toBe(page.url());
      expect(await page.locator(".copy-fallback").count()).toBe(0);
    } finally {
      await page.context().close();
    }
  });
});

describe("P9b, P9c: who's in the room", () => {
  it("observers are listed for everyone; a second Ann gets a suffix", async () => {
    const { page: host, id } = await newRoom("Ann");
    const guest = await join(id, "Ann");
    const names = async () =>
      (await host.locator(".participants .pname").allTextContents()).map((n) => n.replace("⭐", "")).sort();
    try {
      await expect.poll(names).toEqual(["Ann (2)", "Ann (you)"]);
      await guest.getByRole("button", { name: "Observe (don't vote)" }).click();
      await expect.poll(() => host.locator(".observers").textContent()).toBe("🎤 Observing: Ann (2)");
      await expect.poll(() => guest.locator(".observers").textContent()).toBe("🎤 Observing: Ann (2) (you)");
      expect(await host.locator(".participants li").count()).toBe(1);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });
});
