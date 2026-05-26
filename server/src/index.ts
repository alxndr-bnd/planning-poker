import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  WS_PATH,
  type ClientMessage,
  type ServerMessage,
} from "@pp/shared";
import { deleteRoom, getOrCreateRoom, getRoom, sweepIdleRooms } from "./rooms.js";
import { serveStatic } from "./static.js";

const PORT = Number(process.env.PORT ?? 8080);
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR ?? join(__dirname, "../../client/dist");
const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,32}$/;
const IDLE_SWEEP_MS = 5 * 60 * 1000;

interface ConnState {
  id: string;
  roomId: string | null;
}

/** participantId -> socket, for broadcasting to a room's members. */
const sockets = new Map<string, WebSocket>();

const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (serveStatic(STATIC_DIR, req, res)) return;
  res.writeHead(404).end("Not found");
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const path = (req.url ?? "").split("?")[0];
  if (path !== WS_PATH) {
    socket.destroy();
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
    // Each recipient always sees their OWN vote value (so they can see/change/
    // cancel their pick); other people's votes stay hidden until reveal.
    const participants = base.map((v) =>
      v.id === p.id ? { ...v, vote: p.vote } : v,
    );
    const state: ServerMessage = {
      type: "state",
      roomId: room.id,
      phase: room.phase,
      itemTitle: room.itemTitle,
      hostId: room.hostId ?? "",
      participants,
    };
    send(ws, state);
  }
  if (room.phase === "revealed") {
    const summary: ServerMessage = { type: "summary", summary: room.summary() };
    for (const p of room.participants.values()) {
      const ws = sockets.get(p.id);
      if (ws) send(ws, summary);
    }
  }
}

wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
  const conn: ConnState = { id: randomUUID(), roomId: null };

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "Invalid message" });
      return;
    }

    if (msg.type === "ping") {
      send(ws, { type: "pong" });
      return;
    }

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
      conn.roomId = msg.roomId;
      const room = getOrCreateRoom(msg.roomId);
      room.addParticipant(conn.id, name, Boolean(msg.asObserver));
      sockets.set(conn.id, ws);
      send(ws, { type: "joined", youId: conn.id, roomId: room.id });
      broadcastState(room.id);
      return;
    }

    // All other messages require an active room membership.
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
        room.reveal();
        break;
      case "reset":
        room.reset(msg.itemTitle?.trim().slice(0, 120));
        break;
      case "setObserver":
        room.setObserver(conn.id, msg.isObserver);
        break;
      case "rename":
        room.rename(conn.id, msg.name.trim().slice(0, 40));
        break;
    }
    broadcastState(room.id);
  });

  ws.on("close", () => {
    sockets.delete(conn.id);
    if (conn.roomId) {
      const room = getRoom(conn.roomId);
      if (room) {
        room.removeParticipant(conn.id);
        if (room.isEmpty()) deleteRoom(room.id);
        else broadcastState(room.id);
      }
    }
  });
});

setInterval(() => sweepIdleRooms(IDLE_SWEEP_MS), 60 * 1000).unref();

httpServer.listen(PORT, () => {
  console.log(`planning-poker server listening on :${PORT} (static: ${STATIC_DIR})`);
});
