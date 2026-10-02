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
      expect(getRoom(created)).toBeDefined();
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
      expect(joins()).toEqual([true]);

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
