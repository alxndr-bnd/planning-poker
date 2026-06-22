import { describe, it, expect, beforeEach } from "vitest";
import { Room } from "../src/room.js";
import {
  getOrCreateRoom,
  getIdleRooms,
  getRoom,
  deleteRoom,
  roomCount,
} from "../src/rooms.js";

// Billing fix (2026-06-22): forgotten browser tabs hold a WebSocket open and
// auto-reconnect, pinning the single Cloud Run instance 24/7 (no scale-to-zero).
// "Engagement" (vote/reveal/reset/...) must be tracked SEPARATELY from connection
// churn (join/leave) so an idle-but-connected room can be detected and its sockets
// closed. Reconnects must NOT reset the idle timer, or zombie tabs are never idle.

describe("Room.lastEngagementAt (idle tracking)", () => {
  it("advances on real engagement (vote/reveal/reset/unvote/setObserver)", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    room.addParticipant("b", "B", false);

    room.lastEngagementAt = 0;
    room.vote("a", "5");
    expect(room.lastEngagementAt).toBeGreaterThan(0);

    room.lastEngagementAt = 0;
    room.unvote("a");
    expect(room.lastEngagementAt).toBeGreaterThan(0);

    room.lastEngagementAt = 0;
    room.reveal(room.revealerId!);
    expect(room.lastEngagementAt).toBeGreaterThan(0);

    room.lastEngagementAt = 0;
    room.reset("next");
    expect(room.lastEngagementAt).toBeGreaterThan(0);

    room.lastEngagementAt = 0;
    room.setObserver("b", true);
    expect(room.lastEngagementAt).toBeGreaterThan(0);
  });

  it("does NOT advance on connection churn (join / leave)", () => {
    // A reconnecting zombie tab re-joins constantly; that must not look like activity.
    const room = new Room("abcdef");
    room.lastEngagementAt = 12345;
    room.addParticipant("a", "A", false);
    expect(room.lastEngagementAt).toBe(12345);
    room.removeParticipant("a");
    expect(room.lastEngagementAt).toBe(12345);
  });
});

describe("getIdleRooms", () => {
  beforeEach(() => {
    // clean the shared registry between tests
    for (let i = 0; i < 100; i++) deleteRoom(`idle-${i}`);
  });

  it("returns rooms whose last engagement is older than idleMs, and only those", () => {
    const idleMs = 30 * 60 * 1000;
    const fresh = getOrCreateRoom("idle-1");
    const stale = getOrCreateRoom("idle-2");
    fresh.lastEngagementAt = Date.now();
    stale.lastEngagementAt = Date.now() - (idleMs + 60_000);

    const idle = getIdleRooms(idleMs);
    const ids = idle.map((r) => r.id);
    expect(ids).toContain("idle-2");
    expect(ids).not.toContain("idle-1");
  });

  it("a vote on a stale room clears it from the idle set", () => {
    const idleMs = 30 * 60 * 1000;
    const room = getOrCreateRoom("idle-3");
    room.addParticipant("a", "A", false);
    room.lastEngagementAt = Date.now() - (idleMs + 60_000);
    expect(getIdleRooms(idleMs).map((r) => r.id)).toContain("idle-3");

    room.vote("a", "8");
    expect(getIdleRooms(idleMs).map((r) => r.id)).not.toContain("idle-3");
  });

  // keep the registry tidy for other suites
  it("cleanup", () => {
    for (let i = 0; i < 100; i++) deleteRoom(`idle-${i}`);
    expect(getRoom("idle-1")).toBeUndefined();
    expect(roomCount()).toBeGreaterThanOrEqual(0);
  });
});
