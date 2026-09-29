import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket } from "ws";
import type { ServerMessage } from "@pp/shared";
import {
  createPokerServer,
  JOIN_TIMEOUT_CLOSE_CODE,
  originAllowed,
  type PokerServerLimits,
} from "../src/server.js";
import { roomCount } from "../src/rooms.js";

// SERBITO-361 (security review SERBITO-332 §4): PKR-1 impersonation, PKR-2 room-cap
// exhaustion, PKR-3 idle/Origin-less sockets, PKR-4 message schema — end to end.

const ORIGIN = "http://localhost:5173";
let server: Server | null = null;
let wsUrl = "";

async function start(limits: Partial<PokerServerLimits> = {}) {
  server = createPokerServer("/nonexistent", limits);
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
}

/** Every client a test opened, so a failing test can't leave the server hanging. */
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const ws of clients.splice(0)) ws.terminate();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

/** A test client: records every raw frame and parsed message it receives. */
class Client {
  readonly ws: WebSocket;
  readonly raw: string[] = [];
  readonly msgs: ServerMessage[] = [];
  private waiters: Array<() => void> = [];
  readonly opened: Promise<void>;

  constructor(headers: Record<string, string> = {}) {
    this.ws = new WebSocket(wsUrl, { origin: ORIGIN, headers });
    clients.push(this.ws);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
    this.ws.on("message", (data) => {
      this.raw.push(data.toString());
      this.msgs.push(JSON.parse(data.toString()));
      for (const w of this.waiters) w();
    });
  }

  send(m: unknown) {
    this.ws.send(typeof m === "string" ? m : JSON.stringify(m));
  }

  /** Resolve with the first message (already received or future, from index `from`)
   *  matching `pred`. */
  waitFor<T extends ServerMessage>(pred: (m: ServerMessage) => m is T, from?: number): Promise<T>;
  waitFor(pred: (m: ServerMessage) => boolean, from?: number): Promise<ServerMessage>;
  waitFor(pred: (m: ServerMessage) => boolean, from = 0): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("waitFor timeout")), 3000);
      const check = () => {
        const hit = this.msgs.slice(from).find(pred);
        if (hit) {
          clearTimeout(timer);
          this.waiters = this.waiters.filter((w) => w !== check);
          resolve(hit);
        }
      };
      this.waiters.push(check);
      check();
    });
  }

  async join(roomId: string, name: string, clientId?: string) {
    await this.opened;
    const from = this.msgs.length;
    this.send({ type: "join", roomId, name, ...(clientId ? { clientId } : {}) });
    const j = await this.waitFor((m) => m.type === "joined" || m.type === "error", from);
    if (j.type !== "joined") throw new Error(`join failed: ${JSON.stringify(j)}`);
    return j.youId;
  }

  /** Latest state message received so far. */
  lastState() {
    const s = [...this.msgs].reverse().find((m) => m.type === "state");
    if (!s || s.type !== "state") throw new Error("no state yet");
    return s;
  }

  close() {
    this.ws.close();
  }
}

const isState = (m: ServerMessage): m is Extract<ServerMessage, { type: "state" }> =>
  m.type === "state";

describe("PKR-1: the rejoin key stays secret, impersonation fails", () => {
  it("no other participant ever receives someone's clientId", async () => {
    await start();
    const alice = new Client();
    const aliceId = await alice.join("pkr1room01", "Alice", "alice-secret-key-0001");
    const bob = new Client();
    await bob.join("pkr1room01", "Bob", "bob-secret-key-00001");
    alice.send({ type: "vote", value: "8" });
    await bob.waitFor((m) => isState(m) && m.participants.some((p) => p.hasVoted));

    expect(aliceId).not.toBe("alice-secret-key-0001"); // youId is the public id
    expect(bob.raw.join("\n")).not.toContain("alice-secret-key-0001");
    expect(alice.raw.join("\n")).not.toContain("bob-secret-key-00001");
    const st = bob.lastState();
    expect(st.participants.map((p) => p.id)).toContain(aliceId);
    expect([...st.participants.map((p) => p.id), st.revealerId]).not.toContain(
      "alice-secret-key-0001",
    );
    alice.close();
    bob.close();
  });

  it("joining with another participant's public id does not take over their seat", async () => {
    await start();
    const alice = new Client();
    const aliceId = await alice.join("pkr1room02", "Alice", "alice-secret-key-0002");
    alice.send({ type: "vote", value: "13" });
    await alice.waitFor((m) => isState(m) && m.participants.some((p) => p.hasVoted));

    // Mallory knows everything the room sees — including Alice's id — and tries it.
    const mallory = new Client();
    const malloryId = await mallory.join("pkr1room02", "Mallory", aliceId);
    expect(malloryId).not.toBe(aliceId);

    const st = await alice.waitFor(
      (m) => isState(m) && m.participants.some((p) => p.name === "Mallory"),
    );
    if (st.type !== "state") throw new Error("unreachable");
    const a = st.participants.find((p) => p.id === aliceId)!;
    expect(a.name).toBe("Alice"); // not renamed
    expect(a.connected).toBe(true); // Alice not cut off
    expect(a.vote).toBe("13"); // her own view still holds her vote
    expect(st.participants).toHaveLength(2); // Mallory is a separate participant

    // Mallory's vote lands on Mallory, not Alice.
    mallory.send({ type: "vote", value: "1" });
    const after = await alice.waitFor(
      (m) =>
        isState(m) && m.participants.find((p) => p.name === "Mallory")?.hasVoted === true,
    );
    if (after.type !== "state") throw new Error("unreachable");
    expect(after.participants.find((p) => p.id === aliceId)!.vote).toBe("13");
    alice.close();
    mallory.close();
  });

  it("a clientId reused in another room can't steal the socket of the first room", async () => {
    await start();
    const alice = new Client();
    await alice.join("pkr1room03", "Alice", "shared-key-00000001");
    const other = new Client();
    await other.join("pkr1room04", "Other", "shared-key-00000001");
    // Activity in Alice's room must still reach Alice.
    const bob = new Client();
    await bob.join("pkr1room03", "Bob", "bob-key-000000003");
    const st = await alice.waitFor(
      (m) => isState(m) && m.participants.some((p) => p.name === "Bob"),
    );
    expect(st).toBeTruthy();
    expect(other.raw.join("\n")).not.toContain("Bob");
    alice.close();
    other.close();
    bob.close();
  });

  it("the owner's own reconnect still restores the seat, vote and public id", async () => {
    await start();
    const first = new Client();
    const id1 = await first.join("pkr1room05", "Alice", "alice-secret-key-0005");
    first.send({ type: "vote", value: "5" });
    await first.waitFor((m) => isState(m) && m.participants.some((p) => p.hasVoted));
    first.close();

    const again = new Client();
    const id2 = await again.join("pkr1room05", "Alice", "alice-secret-key-0005");
    expect(id2).toBe(id1);
    const st = await again.waitFor(isState);
    expect(st.participants.find((p) => p.id === id2)!.vote).toBe("5");
    again.close();
  });
});

describe("PKR-2: one client can't fill the room cap", () => {
  it("a second join on the same connection is refused and creates no room", async () => {
    await start();
    const c = new Client();
    await c.join("pkr2room01", "A");
    const before = roomCount();
    c.send({ type: "join", roomId: "pkr2room02", name: "A" });
    const err = await c.waitFor((m) => m.type === "error" && m.code === "already_joined");
    expect(err).toBeTruthy();
    expect(roomCount()).toBe(before);
    c.close();
  });

  it("limits how many new rooms one IP may create per window", async () => {
    await start({ roomCreatesPerIp: 2 });
    const a = new Client();
    await a.join("pkr2room03", "A");
    const b = new Client();
    await b.join("pkr2room04", "B");
    const c = new Client();
    await c.opened;
    c.send({ type: "join", roomId: "pkr2room05", name: "C" });
    await c.waitFor((m) => m.type === "error" && m.code === "too_many_rooms");
    // Joining an EXISTING room is never limited.
    const d = new Client();
    await d.join("pkr2room03", "D");
    for (const x of [a, b, c, d]) x.close();
  });
});

describe("PKR-3: idle sockets, per-IP connections, Origin", () => {
  it("closes a socket that doesn't join in time; a joined one stays", async () => {
    await start({ joinTimeoutMs: 150 });
    const idle = new Client();
    const joined = new Client();
    await joined.join("pkr3room01", "J");
    const code = await new Promise<number>((resolve) => idle.ws.once("close", resolve));
    expect(code).toBe(JOIN_TIMEOUT_CLOSE_CODE);
    await new Promise((r) => setTimeout(r, 100));
    expect(joined.ws.readyState).toBe(WebSocket.OPEN);
    joined.close();
  });

  it("caps open WebSockets per IP and frees the slot on close", async () => {
    await start({ maxConnectionsPerIp: 2 });
    const a = new Client();
    const b = new Client();
    await Promise.all([a.opened, b.opened]);
    const refused = new WebSocket(wsUrl, { origin: ORIGIN });
    clients.push(refused);
    const status = await new Promise<number>((resolve) => {
      refused.once("unexpected-response", (_req, res: IncomingMessage) =>
        resolve(res.statusCode ?? 0),
      );
      refused.once("error", () => resolve(-1));
    });
    expect(status).toBe(429);

    a.close();
    await new Promise((r) => a.ws.once("close", r));
    await new Promise((r) => setTimeout(r, 50)); // server-side close bookkeeping
    const c = new Client();
    await c.opened;
    b.close();
    c.close();
  });

  it("Origin: our site only; localhost only outside production", () => {
    expect(originAllowed(undefined, true)).toBe(false);
    expect(originAllowed(undefined, false)).toBe(false);
    expect(originAllowed("https://poker.serbito.rs", true)).toBe(true);
    expect(originAllowed("http://poker.serbito.rs", true)).toBe(false);
    expect(originAllowed("https://evil.example", true)).toBe(false);
    expect(originAllowed("http://localhost:5173", true)).toBe(false);
    expect(originAllowed("http://127.0.0.1:8090", true)).toBe(false);
    expect(originAllowed("http://localhost:5173", false)).toBe(true);
  });
});

describe("PKR-4: malformed fields are rejected, the server stays up", () => {
  it("answers bad_message to wrong-typed fields and still serves the client", async () => {
    await start();
    const c = new Client();
    await c.opened;
    c.send("not json at all"); // bad_json, not counted below
    c.send({ type: "join", roomId: ["pkr4room01"], name: "A" });
    c.send({ type: "join", roomId: "pkr4room01", name: { toString: 1 } });
    c.send({ type: "join", roomId: "pkr4room01", name: "x".repeat(5000) });
    await c.waitFor(
      () => c.msgs.filter((m) => m.type === "error" && m.code === "bad_message").length >= 3,
    );
    expect(c.msgs.filter((m) => m.type === "error" && m.code === "bad_message")).toHaveLength(3);
    const id = await c.join("pkr4room01", "A");
    c.send({ type: "vote", value: 5 });
    c.send({ type: "setObserver", isObserver: "yes" });
    c.send({ type: "reset", itemTitle: ["x"] });
    await c.waitFor(
      () => c.msgs.filter((m) => m.type === "error" && m.code === "bad_message").length >= 6,
    );
    const st = c.lastState();
    const me = st.participants.find((p) => p.id === id)!;
    expect(me.hasVoted).toBe(false);
    expect(me.isObserver).toBe(false);
    c.close();
  });
});
