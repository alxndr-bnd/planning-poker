import { describe, it, expect } from "vitest";
import { Room } from "../src/room.js";

describe("Room", () => {
  it("hides votes during voting and reveals them after reveal", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "Alice", false);
    room.addParticipant("b", "Bob", false);
    room.vote("a", "5");
    room.vote("b", "8");

    // voting: values hidden, only hasVoted exposed
    const voting = room.toViews();
    expect(voting.every((p) => p.vote === undefined)).toBe(true);
    expect(voting.find((p) => p.id === "a")!.hasVoted).toBe(true);

    // revealed: values exposed
    room.reveal();
    const revealed = room.toViews();
    expect(revealed.find((p) => p.id === "a")!.vote).toBe("5");
    expect(revealed.find((p) => p.id === "b")!.vote).toBe("8");
  });

  it("first joiner is host; host transfers when host leaves", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "Alice", false);
    room.addParticipant("b", "Bob", false);
    expect(room.hostId).toBe("a");
    room.removeParticipant("a");
    expect(room.hostId).toBe("b");
  });

  it("observers cannot vote and are excluded from summary", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "Alice", false);
    room.addParticipant("o", "Obs", true);
    expect(room.vote("o", "5")).toBe(false);
    room.vote("a", "3");
    room.reveal();
    expect(room.summary().distribution).toEqual({ "3": 1 });
  });

  it("computes average and consensus over numeric votes only", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    room.addParticipant("b", "B", false);
    room.addParticipant("c", "C", false);
    room.vote("a", "2");
    room.vote("b", "8");
    room.vote("c", "?"); // non-numeric ignored in average
    room.reveal();
    const s = room.summary();
    expect(s.average).toBe(5); // (2+8)/2
    expect(s.consensus).toBe(false);
  });

  it("reset clears votes and returns to voting", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    room.vote("a", "13");
    room.reveal();
    room.reset("next item");
    expect(room.phase).toBe("voting");
    expect(room.itemTitle).toBe("next item");
    expect(room.toViews()[0].hasVoted).toBe(false);
  });
});
