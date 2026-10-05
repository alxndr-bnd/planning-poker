import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import type { Page } from "playwright-core";
import {
  MAX_ITEM_TITLE,
  MAX_ITEM_TITLE_INPUT,
  normalizeItemTitle,
  type ServerMessage,
} from "@pp/shared";
import { createPokerServer } from "../src/server.js";
import { EN, LANGS, t } from "../../client/src/i18n.js";
import { openPage, startApp, type App } from "./support/app.js";

// SERBITO-464: the server took `reset.itemTitle`, but the client never sent it, so the
// estimate log showed "—" for every round. Now a field next to Reset / New vote names the
// next round; everybody sees the title on the table and in the log.

describe("normalizeItemTitle (server-side cleaning)", () => {
  it("trims, collapses whitespace and line breaks into one space", () => {
    expect(normalizeItemTitle("  SHOP-142 \n\t add  SSO  ")).toBe("SHOP-142 add SSO");
  });

  it("blank or missing is no title", () => {
    expect(normalizeItemTitle(undefined)).toBeNull();
    expect(normalizeItemTitle("")).toBeNull();
    expect(normalizeItemTitle(" \n\t ")).toBeNull();
  });

  it("drops control and bidi-override characters", () => {
    expect(normalizeItemTitle("a\u0000b\u0007c\u001b[31m")).toBe("a b c [31m");
    expect(normalizeItemTitle("pay‮gnp.exe⁦x⁩")).toBe("paygnp.exex");
  });

  it(`cuts at ${MAX_ITEM_TITLE} characters without splitting an emoji`, () => {
    expect(MAX_ITEM_TITLE).toBe(120);
    expect(normalizeItemTitle("x".repeat(MAX_ITEM_TITLE_INPUT))).toBe("x".repeat(MAX_ITEM_TITLE));
    const out = normalizeItemTitle("a" + "😀".repeat(MAX_ITEM_TITLE))!;
    expect([...out]).toHaveLength(MAX_ITEM_TITLE);
    expect(out.endsWith("😀")).toBe(true); // no lone surrogate at the end
  });

  it("keeps HTML as plain text (the client renders it as text)", () => {
    expect(normalizeItemTitle("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });
});

// ---- WebSocket: one reset with a title reaches every participant and the log ----

const ORIGIN = "http://localhost:5173";
let server: Server;
let wsUrl: string;

beforeAll(async () => {
  server = createPokerServer("/nonexistent");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type State = Extract<ServerMessage, { type: "state" }>;

/** A test client: joins, records every message, waits for a matching state. */
async function client(roomId: string, name: string) {
  const ws = new WebSocket(wsUrl, { origin: ORIGIN });
  const msgs: ServerMessage[] = [];
  ws.on("message", (raw) => msgs.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  const waitState = async (pred: (s: State) => boolean): Promise<State> => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const hit = [...msgs].reverse().find((m): m is State => m.type === "state" && pred(m));
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`no matching state for ${name}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  send({ type: "join", roomId, name });
  await waitState((s) => s.participants.some((p) => p.name === name));
  return { ws, send, waitState };
}

describe("reset with an item title over the WebSocket", () => {
  it("every participant sees the title, and the revealed round logs it", async () => {
    const a = await client("t464room01", "Ann");
    const b = await client("t464room01", "Bob");
    try {
      a.send({ type: "reset", itemTitle: "  SHOP-142\nadd SSO <b>now</b> " });
      const title = "SHOP-142 add SSO <b>now</b>";
      for (const c of [a, b]) {
        const s = await c.waitState((s) => s.itemTitle === title);
        expect(s.phase).toBe("voting");
      }
      // Whoever holds the star reveals; both see the round in the log under its title.
      const s = await a.waitState((s) => s.itemTitle === title);
      const holder = s.revealerId === s.participants.find((p) => p.name === "Ann")!.id ? a : b;
      a.send({ type: "vote", value: "8" });
      b.send({ type: "vote", value: "8" });
      await a.waitState((s) => s.participants.every((p) => p.hasVoted));
      holder.send({ type: "reveal" });
      for (const c of [a, b]) {
        const done = await c.waitState((s) => s.phase === "revealed");
        expect(done.log.at(-1)!.itemTitle).toBe(title);
      }
    } finally {
      a.ws.close();
      b.ws.close();
    }
  });

  it("cuts a long title, and a blank one means no title", async () => {
    const a = await client("t464room02", "Ann");
    try {
      a.send({ type: "reset", itemTitle: "y".repeat(150) });
      await a.waitState((s) => s.itemTitle === "y".repeat(MAX_ITEM_TITLE));
      a.send({ type: "reset", itemTitle: "   " });
      const s = await a.waitState((s) => s.itemTitle === null);
      expect(s.itemTitle).toBeNull();
    } finally {
      a.ws.close();
    }
  });
});

// ---- Browser: the field, as people use it ----

describe("item title field in the room (Chromium)", () => {
  let app: App;
  beforeAll(async () => {
    app = await startApp();
  }, 60_000);
  afterAll(async () => {
    await app?.close();
  });

  async function newRoom(name: string, width = 1280): Promise<{ page: Page; id: string }> {
    const { page } = await openPage(app, { path: "/", width, storage: { pp_name: name, pp_lang: "en" } });
    await page.getByRole("button", { name: "Create room" }).click();
    await page.waitForSelector(".fan .card");
    return { page, id: new URL(page.url()).hash.slice("#/r/".length) };
  }
  async function join(id: string, name: string): Promise<Page> {
    const { page } = await openPage(app, { path: `/#/r/${id}`, width: 1280, storage: { pp_name: name, pp_lang: "en" } });
    await page.waitForSelector(".participants li");
    return page;
  }
  const field = (p: Page) => p.getByRole("textbox", { name: EN["room.itemLabel"] });

  it("a title typed before Reset is on everybody's table and in the log, as text", async () => {
    const { page: host, id } = await newRoom("Host");
    const guest = await join(id, "Guest");
    try {
      const evil = '<img src=x onerror="window.__pwned=1">';
      expect(await field(host).getAttribute("maxlength")).toBe(String(MAX_ITEM_TITLE));
      await field(host).fill(`SHOP-142 ${evil}`);
      await host.getByRole("button", { name: "Reset" }).click();
      for (const p of [host, guest]) {
        await expect.poll(() => p.locator(".table .item").textContent()).toBe(`SHOP-142 ${evil}`);
        expect(await p.locator(".table .item img").count()).toBe(0);
        expect(await p.evaluate("window.__pwned")).toBeUndefined();
        // The field shows the current round's title, so New vote keeps it for a re-vote.
        await expect.poll(() => field(p).inputValue()).toBe(`SHOP-142 ${evil}`);
      }

      // Guest votes alone-ish: everyone votes, the star holder reveals.
      for (const p of [host, guest]) await p.locator(".fan .card", { hasText: /^5$/ }).click();
      const revealer = (await host.getByRole("button", { name: "Reveal" }).count()) ? host : guest;
      await revealer.getByRole("button", { name: "Reveal" }).click();
      for (const p of [host, guest]) {
        await p.locator(".estimate-log summary").click();
        await expect.poll(() => p.locator(".log-title").first().textContent()).toBe(`SHOP-142 ${evil}`);
      }

      // Next issue: the guest types a new key and presses Enter (same as New vote).
      await field(guest).fill("SHOP-143");
      await field(guest).press("Enter");
      for (const p of [host, guest]) {
        await expect.poll(() => p.locator(".table .item").textContent()).toBe("SHOP-143");
        await expect.poll(() => field(p).inputValue()).toBe("SHOP-143");
      }

      // Cleared field + Reset: the round has no title.
      await field(host).fill("");
      await host.getByRole("button", { name: "Reset" }).click();
      for (const p of [host, guest]) await expect.poll(() => p.locator(".table .item").count()).toBe(0);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  }, 30_000);

  it("someone else's reset does not wipe what I am typing", async () => {
    const { page: host, id } = await newRoom("Host");
    const guest = await join(id, "Guest");
    try {
      await field(guest).fill("SHOP-200 half-typ");
      await field(host).fill("SHOP-199");
      await field(host).press("Enter");
      await expect.poll(() => guest.locator(".table .item").textContent()).toBe("SHOP-199");
      expect(await field(guest).inputValue()).toBe("SHOP-200 half-typ");
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  });

  it("fits a 320 px phone: the field is a full-size target inside the screen", async () => {
    const { page } = await newRoom("Phone", 320);
    try {
      const box = (await field(page).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(320);
    } finally {
      await page.context().close();
    }
  });
});

describe("item title strings in all 9 languages", () => {
  const KEYS = ["room.itemLabel", "room.itemPlaceholder"] as const;
  it.each(LANGS.map((l) => l.code))("%s", (lang) => {
    for (const key of KEYS) {
      const s = t(lang, key);
      expect(s.length, key).toBeGreaterThan(0);
      if (lang !== "en") expect(s, `${lang} ${key} is still English`).not.toBe(EN[key]);
    }
  });
});
