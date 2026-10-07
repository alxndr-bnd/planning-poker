import { afterAll, beforeAll, describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import type { ParticipantView, ServerMessage } from "@pp/shared";
import { Room } from "../src/room.js";
import { createPokerServer } from "../src/server.js";
import { getRoom } from "../src/rooms.js";

// 2026-06-26: "my vote disappears". The WS reconnects every ~30-100s (Cloudflare idle
// timeout); each reconnect used to come back as a brand-new participant with no vote.
// Fix: a stable clientId re-attaches the SAME participant and keeps their vote.

describe("reconnect keeps the vote", () => {
  it("reattachParticipant preserves vote + observer + flips connected back on", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "Alice", false);
    room.vote("a", "8");
    expect(room.participants.get("a")!.vote).toBe("8");

    // socket drops
    room.markDisconnected("a");
    const p = room.participants.get("a")!;
    expect(p.connected).toBe(false);
    expect(p.disconnectedAt).not.toBeNull();
    expect(p.vote).toBe("8"); // still here through the grace

    // same clientId comes back
    const re = room.reattachParticipant("a", "Alice");
    expect(re).not.toBeNull();
    expect(re!.vote).toBe("8"); // THE FIX: vote survived the reconnect
    expect(re!.connected).toBe(true);
    expect(re!.disconnectedAt).toBeNull();
  });

  it("reattach updates the display name but never the vote", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "Alice", false);
    room.vote("a", "5");
    room.markDisconnected("a");
    room.reattachParticipant("a", "Alice (laptop)");
    const p = room.participants.get("a")!;
    expect(p.name).toBe("Alice (laptop)");
    expect(p.vote).toBe("5");
  });

  it("purgeDisconnected drops only those past the grace, keeps connected + recent", () => {
    const room = new Room("abcdef");
    room.addParticipant("live", "Live", false);
    room.addParticipant("gone", "Gone", false);
    room.addParticipant("recent", "Recent", false);

    room.markDisconnected("gone");
    room.participants.get("gone")!.disconnectedAt = Date.now() - 5 * 60 * 1000; // 5m ago
    room.markDisconnected("recent"); // just now

    const removed = room.purgeDisconnected(2 * 60 * 1000); // 2m grace
    expect(removed).toBe(1);
    expect(room.participants.has("gone")).toBe(false);
    expect(room.participants.has("recent")).toBe(true); // within grace
    expect(room.participants.has("live")).toBe(true);
  });
});

// 2026-06-28: "if I'm an observer (the mic/observer card), the role periodically drops
// and I'm back among the voting cards". Same root cause as the vote loss: a reconnect
// whose participant the server no longer has (grace expired, OR a deploy reset the
// in-memory rooms) re-adds the user fresh. The server keeps the role only when it can
// re-attach; otherwise it relies on the client carrying `asObserver`. The old client
// didn't send it on reconnect, so observers silently became voters.
// These cases run through real sockets against the real join branch in server.ts
// (SERBITO-484; they used to test a local copy of that branch).
describe("reconnect keeps the observer role", () => {
  /** Browsers always send Origin on a WebSocket; the server refuses one without it. */
  const ORIGIN = "http://localhost:5173";
  const CLIENT = "observer-client-01";
  let server: Server;
  let wsUrl: string;

  beforeAll(async () => {
    server = createPokerServer("/nonexistent");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Join `roomId` and resolve with the open socket and this participant as the room sees it. */
  function join(
    roomId: string,
    clientId: string,
    asObserver?: boolean,
  ): Promise<{ ws: WebSocket; me: ParticipantView }> {
    const ws = new WebSocket(wsUrl, { origin: ORIGIN });
    let youId: string | undefined;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ws test timeout")), 5000);
      ws.on("error", reject);
      ws.on("open", () =>
        ws.send(JSON.stringify({ type: "join", roomId, name: "Obs", clientId, asObserver })),
      );
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString()) as ServerMessage;
        if (m.type === "joined") youId = m.youId;
        const me = m.type === "state" ? m.participants.find((p) => p.id === youId) : undefined;
        if (me) {
          clearTimeout(timer);
          resolve({ ws, me });
        }
      });
    });
  }

  /** Close the socket and wait until the server has marked the participant as disconnected. */
  async function drop(ws: WebSocket, roomId: string, clientId: string): Promise<void> {
    ws.close();
    for (let i = 0; i < 100; i++) {
      if (getRoom(roomId)?.participants.get(clientId)?.connected === false) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("server never marked the participant disconnected");
  }

  /** The grace runs out: the server forgets the participant, as after 2 minutes or a deploy. */
  function expire(roomId: string, clientId: string): void {
    const room = getRoom(roomId)!;
    room.participants.get(clientId)!.disconnectedAt = Date.now() - 5 * 60 * 1000;
    room.purgeDisconnected(2 * 60 * 1000);
    expect(room.participants.has(clientId)).toBe(false);
  }

  it("re-attach within grace keeps observer even if the client omits the role", async () => {
    const roomId = "reconobs01";
    const anchor = await join(roomId, "anchor-client-01", false); // keeps the room alive
    const first = await join(roomId, CLIENT, true);
    expect(first.me.isObserver).toBe(true);
    await drop(first.ws, roomId, CLIENT);
    const again = await join(roomId, CLIENT); // no asObserver: re-attach ignores it
    expect(again.me.isObserver).toBe(true);
    expect(again.me.id).toBe(first.me.id); // the same participant, not a new one
    again.ws.close();
    anchor.ws.close();
  });

  it("after the grace, the role comes from what the client carries", async () => {
    const roomId = "reconobs02";
    const anchor = await join(roomId, "anchor-client-02", false);
    const first = await join(roomId, CLIENT, true);
    await drop(first.ws, roomId, CLIENT);
    expire(roomId, CLIENT);
    // The fixed client carries asObserver on every reconnect: the role comes back.
    const fixed = await join(roomId, CLIENT, true);
    expect(fixed.me.isObserver).toBe(true);
    await drop(fixed.ws, roomId, CLIENT);
    expire(roomId, CLIENT);
    // The pre-fix client sent no role: the server adds a voter (the bug the client fix closes).
    const old = await join(roomId, CLIENT);
    expect(old.me.isObserver).toBe(false);
    old.ws.close();
    anchor.ws.close();
  });
});
