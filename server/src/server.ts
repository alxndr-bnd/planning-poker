import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  WS_PATH,
  IDLE_CLOSE_CODE,
  type ClientMessage,
  type ServerMessage,
} from "@pp/shared";
import {
  deleteRoom,
  getIdleRooms,
  getOrCreateRoom,
  getRoom,
  purgeDisconnectedParticipants,
  roomCount,
  sweepIdleRooms,
} from "./rooms.js";
import { serveStatic } from "./static.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC_DIR =
  process.env.STATIC_DIR ?? join(__dirname, "../../client/dist");
const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,32}$/;
// Stable per-tab client id (from the client) so a reconnect re-attaches to the same
// participant and keeps their vote (fixes "my vote disappears" on the flaky WS).
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
// Keep a disconnected participant (and their vote) this long so a reconnect restores
// them; purged after, so people who actually leave drop out.
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;
// Ping every connected socket on this cadence so Cloudflare's ~100s WS idle timeout
// doesn't keep tearing active sessions down (each teardown was a reconnect).
const KEEPALIVE_MS = 30 * 1000;
const IDLE_SWEEP_MS = 5 * 60 * 1000;
// Billing fix (2026-06-22): forgotten tabs hold a WebSocket open + auto-reconnect,
// pinning the single Cloud Run instance 24/7. After this long with no real engagement
// (vote/reveal/reset — NOT reconnects) we close the room's sockets with a private close
// code; the client sees it and stops reconnecting, so the instance can scale to zero.
const IDLE_DISCONNECT_MS = 30 * 60 * 1000;

// --- Security / DoS hardening (docs/SECURITY-REVIEW-2026-06-21.md) ---
const MAX_PAYLOAD = 16 * 1024; // WS frame cap (messages are tiny; ws default is 100MB)
const MAX_ROOMS = 5000; // cap total live rooms (single-instance memory bound)
const RATE_LIMIT_MSGS = 30; // max messages per connection...
const RATE_LIMIT_WINDOW_MS = 5000; // ...per 5s sliding window

/** Allow browser WS only from our own origins; non-browser clients send no Origin. */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // native / server-to-server clients send no Origin
  try {
    const { hostname, protocol } = new URL(origin);
    if (hostname === "poker.serbito.rs" && protocol === "https:") return true;
    if (hostname === "localhost" || hostname === "127.0.0.1") return true; // dev
    return false;
  } catch {
    return false;
  }
}

interface ConnState {
  id: string;
  roomId: string | null;
}

/**
 * Build the HTTP+WebSocket server (serves the SPA and the /ws endpoint). Does NOT
 * listen — the caller does, which keeps it importable for tests.
 */
export function createPokerServer(staticDir: string = DEFAULT_STATIC_DIR): Server {
  /** participantId -> socket, for broadcasting to a room's members. */
  const sockets = new Map<string, WebSocket>();

  const httpServer = createServer((req, res) => {
    // (No /healthz handler: the Google Front End intercepts the literal path
    // "/healthz" on Cloud Run and returns its own 404, so the request never
    // reaches the container — the handler was dead code. Cloud Run's default
    // startup probe is a TCP port check, no HTTP path needed.)
    if (serveStatic(staticDir, req, res)) return;
    res.writeHead(404).end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  httpServer.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").split("?")[0] !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (!originAllowed(req.headers.origin)) {
      socket.destroy(); // reject cross-site WebSocket hijacking attempts
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  function send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcastState(roomId: string) {
    const room = getRoom(roomId);
    if (!room) return;
    const base = room.toViews();
    for (const p of room.participants.values()) {
      const ws = sockets.get(p.id);
      if (!ws) continue;
      // Each recipient always sees their OWN vote value (to see/change/cancel it);
      // other numeric votes stay hidden until reveal.
      const participants = base.map((v) =>
        v.id === p.id ? { ...v, vote: p.vote } : v,
      );
      send(ws, {
        type: "state",
        roomId: room.id,
        phase: room.phase,
        itemTitle: room.itemTitle,
        participants,
        revealerId: room.revealerId,
        log: room.log,
      });
    }
    if (room.phase === "revealed") {
      const summary: ServerMessage = { type: "summary", summary: room.summary() };
      for (const p of room.participants.values()) {
        const ws = sockets.get(p.id);
        if (ws) send(ws, summary);
      }
    }
  }

  wss.on("connection", (ws: WebSocket) => {
    const conn: ConnState = { id: randomUUID(), roomId: null };
    // Per-connection sliding-window rate limiter (DoS guard).
    let msgTimes: number[] = [];

    // Without an 'error' listener a socket error throws and can crash the process.
    ws.on("error", () => {});

    ws.on("message", (raw) => {
      // Rate limit before doing any work.
      const now = Date.now();
      msgTimes = msgTimes.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (msgTimes.length >= RATE_LIMIT_MSGS) {
        send(ws, { type: "error", code: "rate_limited", message: "Too many messages" });
        return;
      }
      msgTimes.push(now);

      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", code: "bad_json", message: "Invalid message" });
        return;
      }

      // Defensive: never let a crafted message crash the process.
      try {
        if (msg.type === "join") {
          const name = (msg.name ?? "").trim().slice(0, 40);
          if (!ROOM_ID_RE.test(msg.roomId)) {
            send(ws, { type: "error", code: "bad_room", message: "Invalid room id" });
            return;
          }
          if (!name) {
            send(ws, { type: "error", code: "no_name", message: "Name is required" });
            return;
          }
          // Cap total live rooms — don't create a new one past the limit.
          if (!getRoom(msg.roomId) && roomCount() >= MAX_ROOMS) {
            send(ws, {
              type: "error",
              code: "server_full",
              message: "Too many active rooms, try again later",
            });
            return;
          }
          const room = getOrCreateRoom(msg.roomId);
          // Stable per-tab id from the client → a reconnect re-attaches to the same
          // participant and KEEPS their vote. Falls back to the random conn id for
          // pre-v3 clients (they keep the old new-participant-each-reconnect behaviour).
          const stableId =
            typeof msg.clientId === "string" && CLIENT_ID_RE.test(msg.clientId)
              ? msg.clientId
              : conn.id;
          conn.id = stableId;
          conn.roomId = msg.roomId;
          // Reconnect: re-attach without resetting the vote. New participant: add (and
          // only then enforce the per-room cap — a returning member doesn't grow the room).
          if (!room.reattachParticipant(stableId, name)) {
            if (room.isFull()) {
              send(ws, { type: "error", code: "room_full", message: "This room is full" });
              return;
            }
            room.addParticipant(stableId, name, Boolean(msg.asObserver));
          }
          sockets.set(stableId, ws);
          send(ws, { type: "joined", youId: stableId, roomId: room.id });
          broadcastState(room.id);
          return;
        }

        if (!conn.roomId) {
          send(ws, { type: "error", code: "not_joined", message: "Join a room first" });
          return;
        }
        const room = getRoom(conn.roomId);
        if (!room) return;

        switch (msg.type) {
          case "vote":
            room.vote(conn.id, msg.value);
            break;
          case "unvote":
            room.unvote(conn.id);
            break;
          case "reveal":
            room.reveal(conn.id); // ignored unless this conn holds the star
            break;
          case "reset":
            room.reset(msg.itemTitle?.trim().slice(0, 120));
            break;
          case "setObserver":
            room.setObserver(conn.id, msg.isObserver);
            break;
        }
        broadcastState(room.id);
      } catch {
        send(ws, { type: "error", code: "internal", message: "Server error" });
      }
    });

    ws.on("close", () => {
      // Stale-close guard: a fast reconnect can register the NEW socket before this old
      // one's close fires. If we're no longer the current socket for this participant,
      // do nothing — disturbing the live session would drop the just-restored vote.
      if (sockets.get(conn.id) !== ws) return;
      sockets.delete(conn.id);
      if (conn.roomId) {
        const room = getRoom(conn.roomId);
        if (room) {
          // Keep the participant + their vote through the reconnect grace; a returning
          // clientId re-attaches. purgeDisconnectedParticipants drops them if they never
          // come back, and sweepIdleRooms reaps a room once no one is connected.
          room.markDisconnected(conn.id);
          broadcastState(room.id);
        }
      }
    });
  });

  const sweep = setInterval(() => sweepIdleRooms(IDLE_SWEEP_MS), 60 * 1000);
  sweep.unref();
  httpServer.on("close", () => clearInterval(sweep));

  // Drop participants who disconnected and never came back (vote grace expired).
  const purge = setInterval(
    () => purgeDisconnectedParticipants(DISCONNECT_GRACE_MS),
    30 * 1000,
  );
  purge.unref();
  httpServer.on("close", () => clearInterval(purge));

  // Keepalive: ping every live socket so Cloudflare's ~100s WS idle timeout stops
  // tearing active sessions down (each teardown forced a reconnect → vote churn).
  const keepalive = setInterval(() => {
    for (const ws of sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {
          /* a socket mid-close — ignore */
        }
      }
    }
  }, KEEPALIVE_MS);
  keepalive.unref();
  httpServer.on("close", () => clearInterval(keepalive));

  // Disconnect idle rooms so the instance can scale to zero. Closing each socket
  // fires its 'close' handler (removeParticipant → deleteRoom when empty); the
  // client honours IDLE_CLOSE_CODE and does NOT auto-reconnect.
  const idleKick = setInterval(() => {
    for (const room of getIdleRooms(IDLE_DISCONNECT_MS)) {
      for (const p of room.participants.values()) {
        sockets.get(p.id)?.close(IDLE_CLOSE_CODE, "idle");
      }
    }
  }, 60 * 1000);
  idleKick.unref();
  httpServer.on("close", () => clearInterval(idleKick));

  return httpServer;
}
