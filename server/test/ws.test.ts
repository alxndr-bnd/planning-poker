import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import type { ServerMessage } from "@pp/shared";
import { createPokerServer } from "../src/server.js";
import { getRoom } from "../src/rooms.js";

/** Browsers always send Origin on a WebSocket; the server refuses one without it. */
const ORIGIN = "http://localhost:5173";

let server: Server;
let wsUrl: string;

beforeAll(async () => {
  // Empty static dir so it just runs the WS server (no SPA needed in tests).
  server = createPokerServer("/nonexistent");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Drive a socket through handlers until `done` returns a value, then resolve it. */
function drive<T>(
  ws: WebSocket,
  onOpen: () => void,
  onMessage: (m: ServerMessage, ws: WebSocket) => T | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws test timeout")), 5000);
    ws.on("open", onOpen);
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      const out = onMessage(m, ws);
      if (out !== undefined) {
        clearTimeout(timer);
        resolve(out);
      }
    });
  });
}

describe("WebSocket server", () => {
  it("join → vote → reveal → summary happy path", async () => {
    const ws = new WebSocket(wsUrl, { origin: ORIGIN });
    const summary = await drive<{ distribution: Record<string, number>; consensus: boolean }>(
      ws,
      () => ws.send(JSON.stringify({ type: "join", roomId: "wsroom0001", name: "Tester" })),
      (m, sock) => {
        if (m.type === "joined") sock.send(JSON.stringify({ type: "vote", value: "8" }));
        if (
          m.type === "state" &&
          m.phase === "voting" &&
          m.participants.some((p) => p.hasVoted)
        ) {
          sock.send(JSON.stringify({ type: "reveal" }));
        }
        if (m.type === "summary") return m.summary;
        return undefined;
      },
    );
    ws.close();
    expect(summary.distribution).toEqual({ "8": 1 });
  });

  it("hides other players' numeric votes until reveal", async () => {
    // Player A joins and votes a number; player B must not see A's value while voting.
    const a = new WebSocket(wsUrl, { origin: ORIGIN });
    await drive<boolean>(
      a,
      () => a.send(JSON.stringify({ type: "join", roomId: "wsroom0002", name: "A" })),
      (m, sock) => {
        if (m.type === "joined") {
          sock.send(JSON.stringify({ type: "vote", value: "13" }));
          return true; // A is set up
        }
        return undefined;
      },
    );

    const b = new WebSocket(wsUrl, { origin: ORIGIN });
    const aSeenByB = await drive<{ hasVoted: boolean; vote: unknown }>(
      b,
      () => b.send(JSON.stringify({ type: "join", roomId: "wsroom0002", name: "B" })),
      (m) => {
        if (m.type === "state") {
          const av = m.participants.find((p) => p.name === "A");
          if (av) return { hasVoted: av.hasVoted, vote: av.vote };
        }
        return undefined;
      },
    );
    a.close();
    b.close();
    expect(aSeenByB.hasVoted).toBe(true); // B knows A voted
    expect(aSeenByB.vote).toBeUndefined(); // ...but not the value (hidden)
  });

  // SERBITO-355 (P6): a mistyped or expired invite link silently created an empty room.
  it("create: false joins only an existing room; a missing one is room_not_found", async () => {
    const join = (roomId: string, name: string, create?: boolean) => {
      const ws = new WebSocket(wsUrl, { origin: ORIGIN });
      return drive<{ ws: WebSocket; first: ServerMessage }>(
        ws,
        () => ws.send(JSON.stringify({ type: "join", roomId, name, ...(create === undefined ? {} : { create }) })),
        (m) => (m.type === "joined" || m.type === "error" ? { ws, first: m } : undefined),
      );
    };
    const typo = await join("wsnotfound1", "Ann", false);
    expect(typo.first).toEqual({ type: "error", code: "room_not_found", message: "Room not found" });
    expect(getRoom("wsnotfound1")).toBeUndefined();

    const host = await join("wsnotfound2", "Host", true);
    expect(host.first.type).toBe("joined");
    const guest = await join("wsnotfound2", "Guest", false);
    expect(guest.first.type).toBe("joined");

    const legacy = await join("wsnotfound3", "Old client"); // no flag: created, as before
    expect(legacy.first.type).toBe("joined");
    for (const c of [typo, host, guest, legacy]) c.ws.close();
  });
});
