import { describe, expect, it } from "vitest";
import { MAX_ITEM_TITLE_INPUT, MAX_NAME_INPUT, parseClientMessage } from "@pp/shared";

// SERBITO-361 / PKR-4: every WebSocket field is type- and size-checked in
// shared/protocol.ts before the server touches it.

describe("parseClientMessage", () => {
  it("accepts every well-formed message and copies only known fields", () => {
    expect(
      parseClientMessage({
        type: "join",
        roomId: "abcdef123",
        name: "Ann",
        clientId: "k".repeat(20),
        asObserver: true,
        extra: { big: "x".repeat(1000) },
      }),
    ).toEqual({
      type: "join",
      roomId: "abcdef123",
      name: "Ann",
      clientId: "k".repeat(20),
      asObserver: true,
    });
    expect(parseClientMessage({ type: "join", roomId: "abcdef", name: "A" })).toEqual({
      type: "join",
      roomId: "abcdef",
      name: "A",
    });
    expect(parseClientMessage({ type: "vote", value: "☕" })).toEqual({ type: "vote", value: "☕" });
    expect(parseClientMessage({ type: "unvote" })).toEqual({ type: "unvote" });
    expect(parseClientMessage({ type: "reveal" })).toEqual({ type: "reveal" });
    expect(parseClientMessage({ type: "reset" })).toEqual({ type: "reset" });
    expect(parseClientMessage({ type: "reset", itemTitle: "Story 1" })).toEqual({
      type: "reset",
      itemTitle: "Story 1",
    });
    expect(parseClientMessage({ type: "setObserver", isObserver: false })).toEqual({
      type: "setObserver",
      isObserver: false,
    });
  });

  it.each([
    ["not an object", "join"],
    ["null", null],
    ["an array", [{ type: "reveal" }]],
    ["unknown type", { type: "kick", who: "x" }],
    ["missing type", { roomId: "abcdef" }],
    ["array roomId", { type: "join", roomId: ["abcdef"], name: "A" }],
    ["oversized roomId", { type: "join", roomId: "r".repeat(33), name: "A" }],
    ["numeric name", { type: "join", roomId: "abcdef", name: 42 }],
    ["missing name", { type: "join", roomId: "abcdef" }],
    ["oversized name", { type: "join", roomId: "abcdef", name: "n".repeat(MAX_NAME_INPUT + 1) }],
    ["object clientId", { type: "join", roomId: "abcdef", name: "A", clientId: {} }],
    ["oversized clientId", { type: "join", roomId: "abcdef", name: "A", clientId: "c".repeat(65) }],
    ["string asObserver", { type: "join", roomId: "abcdef", name: "A", asObserver: "true" }],
    ["numeric vote", { type: "vote", value: 5 }],
    ["vote not in deck", { type: "vote", value: "4" }],
    ["inherited vote key", { type: "vote", value: "toString" }],
    ["array itemTitle", { type: "reset", itemTitle: ["x"] }],
    ["oversized itemTitle", { type: "reset", itemTitle: "t".repeat(MAX_ITEM_TITLE_INPUT + 1) }],
    ["string isObserver", { type: "setObserver", isObserver: "yes" }],
    ["missing isObserver", { type: "setObserver" }],
  ])("rejects %s", (_label, data) => {
    expect(parseClientMessage(data)).toBeNull();
  });
});
