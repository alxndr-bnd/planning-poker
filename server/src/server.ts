import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import {
  WS_PATH,
  IDLE_CLOSE_CODE,
  parseClientMessage,
  type ServerMessage,
} from "@pp/shared";
import {
  getIdleRooms,
  getOrCreateRoom,
  getRoom,
  purgeDisconnectedParticipants,
  roomCount,
  sweepIdleRooms,
} from "./rooms.js";
import { securityHeaders, serveStatic } from "./static.js";
import { clientIp, ipKey } from "./clientip.js";
import { reportError } from "./sentry.js";

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

// --- Slot-exhaustion limits (SERBITO-361: PKR-2, PKR-3). The instance takes 250
// concurrent requests (Cloud Run --concurrency) and 5,000 rooms; without these one
// client could hold every slot. Per-IP numbers leave room for an office behind one NAT.
export interface PokerServerLimits {
  /** A socket that hasn't joined a room by then is closed. */
  joinTimeoutMs: number;
  /** Open WebSockets per client IP (IPv6: per /64). */
  maxConnectionsPerIp: number;
  /** New rooms one client IP may create per window. */
  roomCreatesPerIp: number;
  roomCreateWindowMs: number;
}
const DEFAULT_LIMITS: PokerServerLimits = {
  joinTimeoutMs: 10 * 1000,
  maxConnectionsPerIp: 30,
  roomCreatesPerIp: 20,
  roomCreateWindowMs: 10 * 60 * 1000,
};
/** Close code for a socket that never joined (4000-4999: private range). */
export const JOIN_TIMEOUT_CLOSE_CODE = 4001;

/**
 * Allow the WS only from our own pages. Browsers always send Origin on a WebSocket, so a
 * missing one means a script, not our app; it is refused. localhost is for dev and tests
 * only, never in production (SERBITO-361: PKR-3, PKR-7).
 */
export function originAllowed(
  origin: string | undefined,
  production = process.env.NODE_ENV === "production",
): boolean {
  if (!origin) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (hostname === "poker.serbito.rs" && protocol === "https:") return true;
    if (!production && (hostname === "localhost" || hostname === "127.0.0.1")) return true;
    return false;
  } catch {
    return false;
  }
}

interface ConnState {
  /** Secret participant key (the client's clientId). Never sent to anyone else. */
  key: string;
  roomId: string | null;
}

/** Sockets are keyed by (room, participant): a clientId only means something in its room. */
const sockKey = (roomId: string, key: string) => `${roomId}\n${key}`;

/** Reject an upgrade on the raw socket with a plain HTTP status. */
function refuseUpgrade(socket: Duplex, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Build the HTTP+WebSocket server (serves the SPA and the /ws endpoint). Does NOT
 * listen — the caller does, which keeps it importable for tests.
 */
export function createPokerServer(
  staticDir: string = DEFAULT_STATIC_DIR,
  limitOverrides: Partial<PokerServerLimits> = {},
): Server {
  const limits: PokerServerLimits = { ...DEFAULT_LIMITS, ...limitOverrides };
  /** sockKey(room, participant key) -> socket, for broadcasting to a room's members. */
  const sockets = new Map<string, WebSocket>();
  /** client IP -> open WebSockets (PKR-3). */
  const connsPerIp = new Map<string, number>();
  /** client IP -> timestamps of the rooms it created in the current window (PKR-2). */
  const roomCreates = new Map<string, number[]>();

  /** Record a room creation for `ip` if it is under its window budget. */
  function allowRoomCreate(ip: string): boolean {
    const now = Date.now();
    const recent = (roomCreates.get(ip) ?? []).filter(
      (t) => now - t < limits.roomCreateWindowMs,
    );
    if (recent.length >= limits.roomCreatesPerIp) {
      roomCreates.set(ip, recent);
      return false;
    }
    recent.push(now);
    roomCreates.set(ip, recent);
    return true;
  }

  const headers = securityHeaders(staticDir);
  const httpServer = createServer((req, res) => {
    // (No /healthz handler: the Google Front End intercepts the literal path
    // "/healthz" on Cloud Run and returns its own 404, so the request never
    // reaches the container — the handler was dead code. Cloud Run's default
    // startup probe is a TCP port check, no HTTP path needed.)
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    try {
      if (serveStatic(staticDir, req, res)) return;
      res.writeHead(404).end("Not found");
    } catch (err) {
      reportError(err);
      console.error("http handler error:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  httpServer.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").split("?")[0] !== WS_PATH) {
      socket.destroy();
      return;
    }
    if (!originAllowed(req.headers.origin)) {
      socket.destroy(); // reject cross-site WebSocket hijacking and Origin-less scripts
      return;
    }
    const ip = ipKey(clientIp(req));
    if ((connsPerIp.get(ip) ?? 0) >= limits.maxConnectionsPerIp) {
      refuseUpgrade(socket, "429 Too Many Requests");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      connsPerIp.set(ip, (connsPerIp.get(ip) ?? 0) + 1);
      ws.once("close", () => {
        const n = (connsPerIp.get(ip) ?? 1) - 1;
        if (n > 0) connsPerIp.set(ip, n);
        else connsPerIp.delete(ip);
      });
      wss.emit("connection", ws, ip);
    });
  });

  function send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcastState(roomId: string) {
    const room = getRoom(roomId);
    if (!room) return;
    const base = room.toViews();
    const revealerId = room.publicRevealerId();
    for (const p of room.participants.values()) {
      const ws = sockets.get(sockKey(roomId, p.id));
      if (!ws) continue;
      // Each recipient always sees their OWN vote value (to see/change/cancel it);
      // other numeric votes stay hidden until reveal.
      const participants = base.map((v) =>
        v.id === p.publicId ? { ...v, vote: p.vote } : v,
      );
      send(ws, {
        type: "state",
        roomId: room.id,
        phase: room.phase,
        itemTitle: room.itemTitle,
        participants,
        revealerId,
        log: room.log,
      });
    }
    if (room.phase === "revealed") {
      const summary: ServerMessage = { type: "summary", summary: room.summary() };
      for (const p of room.participants.values()) {
        const ws = sockets.get(sockKey(roomId, p.id));
        if (ws) send(ws, summary);
      }
    }
  }

  wss.on("connection", (ws: WebSocket, ip: string) => {
    const conn: ConnState = { key: randomUUID(), roomId: null };
    // Per-connection sliding-window rate limiter (DoS guard).
    let msgTimes: number[] = [];
    // A socket that never joins only holds a slot: close it (PKR-3).
    const joinTimer = setTimeout(() => {
      if (!conn.roomId) ws.close(JOIN_TIMEOUT_CLOSE_CODE, "join timeout");
    }, limits.joinTimeoutMs);

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

      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", code: "bad_json", message: "Invalid message" });
        return;
      }
      // Every field type- and size-checked before use (PKR-4).
      const msg = parseClientMessage(data);
      if (!msg) {
        send(ws, { type: "error", code: "bad_message", message: "Invalid message" });
        return;
      }

      // Defensive: never let a crafted message crash the process.
      try {
        if (msg.type === "join") {
          // One join per connection (PKR-2): a second join used to move the socket to
          // another room and leave a phantom "connected" participant behind, which kept
          // that room alive forever — one socket could fill the room cap.
          if (conn.roomId) {
            send(ws, { type: "error", code: "already_joined", message: "Already in a room" });
            return;
          }
          const name = msg.name.trim().slice(0, 40);
          if (!ROOM_ID_RE.test(msg.roomId)) {
            send(ws, { type: "error", code: "bad_room", message: "Invalid room id" });
            return;
          }
          if (!name) {
            send(ws, { type: "error", code: "no_name", message: "Name is required" });
            return;
          }
          if (!getRoom(msg.roomId)) {
            // An invite link to a room that doesn't exist (mistyped, or expired) is
            // not a request to create one (SERBITO-355).
            if (msg.create === false) {
              send(ws, { type: "error", code: "room_not_found", message: "Room not found" });
              return;
            }
            // Cap total live rooms — don't create a new one past the limit.
            if (roomCount() >= MAX_ROOMS) {
              send(ws, {
                type: "error",
                code: "server_full",
                message: "Too many active rooms, try again later",
              });
              return;
            }
            // ...and how fast one client may create them (PKR-2).
            if (!allowRoomCreate(ip)) {
              send(ws, {
                type: "error",
                code: "too_many_rooms",
                message: "Too many new rooms, try again later",
              });
              return;
            }
          }
          const room = getOrCreateRoom(msg.roomId);
          // Stable per-tab id from the client → a reconnect re-attaches to the same
          // participant and KEEPS their vote. It is the participant's secret: the room
          // only ever sees the server-issued publicId (PKR-1). Falls back to the random
          // conn key for pre-v3 clients (a new participant each reconnect).
          const key =
            msg.clientId !== undefined && CLIENT_ID_RE.test(msg.clientId)
              ? msg.clientId
              : conn.key;
          // Reconnect: re-attach without resetting the vote. New participant: add (and
          // only then enforce the per-room cap — a returning member doesn't grow the room).
          let me = room.reattachParticipant(key, name);
          if (!me) {
            if (room.isFull()) {
              send(ws, { type: "error", code: "room_full", message: "This room is full" });
              return;
            }
            me = room.addParticipant(key, name, Boolean(msg.asObserver));
          }
          // A join the user started (not an auto-reconnect) is activity: without this,
          // pressing Reconnect after an idle disconnect got you kicked again within a
          // minute, since the room still looked idle (SERBITO-355).
          if (msg.manual) room.engage();
          conn.key = key;
          conn.roomId = room.id;
          clearTimeout(joinTimer);
          sockets.set(sockKey(room.id, key), ws);
          send(ws, { type: "joined", youId: me.publicId, roomId: room.id });
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
            room.vote(conn.key, msg.value);
            break;
          case "unvote":
            room.unvote(conn.key);
            break;
          case "reveal":
            room.reveal(conn.key); // ignored unless this conn holds the star
            break;
          case "reset":
            room.reset(msg.itemTitle?.trim().slice(0, 120));
            break;
          case "setObserver":
            room.setObserver(conn.key, msg.isObserver);
            break;
        }
        broadcastState(room.id);
      } catch (err) {
        reportError(err);
        send(ws, { type: "error", code: "internal", message: "Server error" });
      }
    });

    ws.on("close", () => {
      clearTimeout(joinTimer);
      if (!conn.roomId) return;
      // Stale-close guard: a fast reconnect can register the NEW socket before this old
      // one's close fires. If we're no longer the current socket for this participant,
      // do nothing — disturbing the live session would drop the just-restored vote.
      const k = sockKey(conn.roomId, conn.key);
      if (sockets.get(k) !== ws) return;
      sockets.delete(k);
      const room = getRoom(conn.roomId);
      if (room) {
        // Keep the participant + their vote through the reconnect grace; a returning
        // clientId re-attaches. purgeDisconnectedParticipants drops them if they never
        // come back, and sweepIdleRooms reaps a room once no one is connected.
        room.markDisconnected(conn.key);
        broadcastState(room.id);
      }
    });
  });

  const sweep = setInterval(() => {
    sweepIdleRooms(IDLE_SWEEP_MS);
    // Forget IPs whose room-creation window has passed (keeps the map bounded).
    const now = Date.now();
    for (const [ip, times] of roomCreates) {
      if (times.every((t) => now - t >= limits.roomCreateWindowMs)) roomCreates.delete(ip);
    }
  }, 60 * 1000);
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
        sockets.get(sockKey(room.id, p.id))?.close(IDLE_CLOSE_CODE, "idle");
      }
    }
  }, 60 * 1000);
  idleKick.unref();
  httpServer.on("close", () => clearInterval(idleKick));

  return httpServer;
}
