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

// 2026-06-28: "if I'm an observer (the mic/observer card), the role periodically drops
// and I'm back among the voting cards". Same root cause as the vote loss: a reconnect
// whose participant the server no longer has (grace expired, OR a deploy reset the
// in-memory rooms) re-adds the user fresh. The server keeps the role only when it can
// re-attach; otherwise it relies on the client carrying `asObserver`. The old client
// didn't send it on reconnect, so observers silently became voters.
describe("reconnect keeps the observer role", () => {
  // Mirror the server's join branch (server.ts): re-attach if the participant is still
  // around, otherwise add fresh with whatever role the client carried in `asObserver`.
  function joinOrReattach(room: Room, id: string, name: string, asObserver: boolean) {
    return (
      room.reattachParticipant(id, name) ?? room.addParticipant(id, name, asObserver)
    );
  }

  function purge(room: Room, id: string) {
    room.markDisconnected(id);
    room.participants.get(id)!.disconnectedAt = Date.now() - 5 * 60 * 1000; // 5m ago
    room.purgeDisconnected(2 * 60 * 1000);
  }

  it("re-attach within grace keeps observer even if the client omits the role", () => {
    const room = new Room("abcdef");
    room.addParticipant("o", "Obs", true);
    room.markDisconnected("o"); // socket dropped, still within grace
    const p = joinOrReattach(room, "o", "Obs", false); // asObserver ignored on re-attach
    expect(p.isObserver).toBe(true);
  });

  it("after purge, rejoining WITHOUT carrying the role drops observer (the bug)", () => {
    const room = new Room("abcdef");
    room.addParticipant("o", "Obs", true);
    purge(room, "o");
    expect(room.participants.has("o")).toBe(false);
    const p = joinOrReattach(room, "o", "Obs", false); // pre-fix client: no asObserver
    expect(p.isObserver).toBe(false); // regressed to a voter
  });

  it("after purge, rejoining WITH the carried role restores observer (the fix)", () => {
    const room = new Room("abcdef");
    room.addParticipant("o", "Obs", true);
    purge(room, "o");
    const p = joinOrReattach(room, "o", "Obs", true); // fixed client carries asObserver
    expect(p.isObserver).toBe(true);
  });
});
