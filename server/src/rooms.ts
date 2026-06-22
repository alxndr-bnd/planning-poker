import { Room } from "./room.js";

/** In-memory registry of all active rooms (single instance, max-instances=1). */
const rooms = new Map<string, Room>();

export function getOrCreateRoom(id: string): Room {
  let room = rooms.get(id);
  if (!room) {
    room = new Room(id);
    rooms.set(id, room);
  }
  return room;
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

export function deleteRoom(id: string) {
  rooms.delete(id);
}

export function roomCount(): number {
  return rooms.size;
}

/**
 * Rooms whose last *engagement* (real user action) is older than `idleMs`. The
 * caller closes their sockets so the single instance can scale to zero — see the
 * idle-disconnect sweep in server.ts. Connection churn (reconnects) does NOT count
 * as engagement, so a forgotten auto-reconnecting tab is correctly seen as idle.
 */
export function getIdleRooms(idleMs: number): Room[] {
  const now = Date.now();
  return [...rooms.values()].filter((r) => now - r.lastEngagementAt > idleMs);
}

/**
 * Sweep rooms that are empty, or that have had no connected participants for
 * longer than `idleMs`. Returns the number of rooms removed.
 */
export function sweepIdleRooms(idleMs: number): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, room] of rooms) {
    const idle = !room.hasConnected() && now - room.lastActivityAt > idleMs;
    if (room.isEmpty() || idle) {
      rooms.delete(id);
      removed++;
    }
  }
  return removed;
}
