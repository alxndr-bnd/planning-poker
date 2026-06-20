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
    room.reveal(room.revealerId!);
    const revealed = room.toViews();
    expect(revealed.find((p) => p.id === "a")!.vote).toBe("5");
    expect(revealed.find((p) => p.id === "b")!.vote).toBe("8");
  });

  it("observers cannot vote and are excluded from summary", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "Alice", false);
    room.addParticipant("o", "Obs", true);
    expect(room.vote("o", "5")).toBe(false);
    room.vote("a", "3");
    room.reveal(room.revealerId!);
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
    room.reveal(room.revealerId!);
    const s = room.summary();
    expect(s.average).toBe(5); // (2+8)/2
    expect(s.consensus).toBe(false);
  });

  it("shows abstain cards (?, coffee) during voting but hides numeric votes", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    room.addParticipant("b", "B", false);
    room.addParticipant("c", "C", false);
    room.vote("a", "5"); // numeric -> hidden during voting
    room.vote("b", "?"); // abstain -> shown immediately
    room.vote("c", "☕"); // abstain -> shown immediately

    const v = room.toViews();
    expect(v.find((p) => p.id === "a")!.vote).toBeUndefined();
    expect(v.find((p) => p.id === "a")!.hasVoted).toBe(true);
    expect(v.find((p) => p.id === "b")!.vote).toBe("?");
    expect(v.find((p) => p.id === "c")!.vote).toBe("☕");
  });

  it("reset clears votes and returns to voting", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    room.vote("a", "13");
    room.reveal(room.revealerId!);
    room.reset("next item");
    expect(room.phase).toBe("voting");
    expect(room.itemTitle).toBe("next item");
    expect(room.toViews()[0].hasVoted).toBe(false);
  });

  it("only the star holder may reveal", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    room.addParticipant("b", "B", false);
    const nonHolder = room.revealerId === "a" ? "b" : "a";
    expect(room.reveal(nonHolder)).toBe(false);
    expect(room.phase).toBe("voting");
    expect(room.reveal(room.revealerId!)).toBe(true);
    expect(room.phase).toBe("revealed");
  });

  it("assigns a star holder and hands it off when the holder leaves", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    expect(room.revealerId).toBe("a"); // sole participant holds it
    room.addParticipant("b", "B", false);
    room.removeParticipant(room.revealerId!); // holder leaves
    expect(room.revealerId).not.toBeNull();
    expect(room.participants.has(room.revealerId!)).toBe(true);
  });

  it("records each revealed round in the log (results only)", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    room.addParticipant("b", "B", false);
    room.reset("Story A"); // sets itemTitle, picks a fresh holder
    room.vote("a", "8");
    room.vote("b", "8");
    room.reveal(room.revealerId!);
    expect(room.log).toHaveLength(1);
    expect(room.log[0].itemTitle).toBe("Story A");
    expect(room.log[0].summary.average).toBe(8);
    expect(room.log[0].summary.consensus).toBe(true);
  });

  // --- Security hardening (docs/SECURITY-REVIEW-2026-06-21.md) ---
  it("rejects a vote value that is not in the deck", () => {
    const room = new Room("abcdef");
    room.addParticipant("a", "A", false);
    // arbitrary client-supplied values must not be stored
    expect(room.vote("a", "999" as never)).toBe(false);
    expect(room.vote("a", "<script>" as never)).toBe(false);
    expect(room.vote("a", "5")).toBe(true); // valid card still works
    room.reveal(room.revealerId!);
    expect(room.summary().distribution).toEqual({ "5": 1 });
  });

  it("caps participants at MAX_PARTICIPANTS (isFull)", () => {
    const room = new Room("abcdef");
    expect(room.isFull()).toBe(false);
    for (let i = 0; i < Room.MAX_PARTICIPANTS; i++) {
      room.addParticipant("p" + i, "P", false);
    }
    expect(room.participants.size).toBe(Room.MAX_PARTICIPANTS);
    expect(room.isFull()).toBe(true);
  });
});
