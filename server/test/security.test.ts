import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import { createPokerServer } from "../src/server.js";

// docs/SECURITY-REVIEW-2026-06-21.md — DoS / input-validation hardening of the WS server.

let server: Server;
let wsUrl: string;

beforeEach(async () => {
  // Empty static dir → just the WS server.
  server = createPokerServer("/nonexistent");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/** Resolve the first lifecycle event of a socket. */
function firstEvent(ws: WebSocket): Promise<"open" | "error" | "close"> {
  return new Promise((resolve) => {
    ws.once("open", () => resolve("open"));
    ws.once("error", () => resolve("error"));
    ws.once("close", () => resolve("close"));
  });
}

describe("WS security hardening", () => {
  it("rejects a WS upgrade from a disallowed Origin (CSWSH)", async () => {
    const ws = new WebSocket(wsUrl, { headers: { Origin: "https://evil.example" } });
    expect(await firstEvent(ws)).not.toBe("open");
    ws.terminate();
  });

  it("accepts a WS with no Origin (native / non-browser client)", async () => {
    const ws = new WebSocket(wsUrl); // ws client sends no Origin by default
    expect(await firstEvent(ws)).toBe("open");
    ws.close();
  });

  it("closes the connection when a message exceeds the payload cap", async () => {
    const ws = new WebSocket(wsUrl);
    const code = await new Promise<number>((resolve, reject) => {
      ws.on("open", () => ws.send("x".repeat(64 * 1024))); // 64KB > 16KB cap
      ws.on("close", (c) => resolve(c));
      ws.on("error", () => {}); // close carries the 1009 code
      setTimeout(() => reject(new Error("timeout")), 4000);
    });
    expect(code).toBe(1009); // "message too big"
  });

  it("rate-limits a flood of messages from one connection", async () => {
    const ws = new WebSocket(wsUrl);
    const rateLimited = await new Promise<boolean>((resolve) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "join", roomId: "room123", name: "Flo" }));
        for (let i = 0; i < 60; i++) {
          ws.send(JSON.stringify({ type: "vote", value: "5" }));
        }
      });
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === "error" && m.code === "rate_limited") resolve(true);
      });
      setTimeout(() => resolve(false), 2500);
    });
    expect(rateLimited).toBe(true);
    ws.terminate();
  });

  it("survives a malformed message and stays responsive", async () => {
    const ws = new WebSocket(wsUrl);
    const joined = await new Promise<boolean>((resolve, reject) => {
      ws.on("open", () => {
        ws.send("not json at all"); // bad_json
        ws.send(JSON.stringify({ type: "vote", value: 5 })); // weird/not-joined
        ws.send(JSON.stringify({ type: "join", roomId: "room999", name: "Ok" }));
      });
      ws.on("message", (raw) => {
        if (JSON.parse(raw.toString()).type === "joined") resolve(true);
      });
      setTimeout(() => reject(new Error("server did not stay responsive")), 3000);
    });
    expect(joined).toBe(true);
    ws.close();
  });
});
