import { describe, it, expect } from "vitest";
import { Room } from "../src/room.js";

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

  it("reattach on an unknown id returns null (genuinely new participant)", () => {
    const room = new Room("abcdef");
    expect(room.reattachParticipant("ghost", "x")).toBeNull();
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
