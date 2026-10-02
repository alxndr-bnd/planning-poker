// Single source of truth for the WebSocket protocol, shared by client and server.

export const FIBONACCI_DECK = [
  "1",
  "2",
  "3",
  "5",
  "8",
  "13",
  "21",
  "34",
  "55",
  "89",
  "144",
  "233",
  "377",
  "610",
  "?",
  "☕", // coffee / break
] as const;

export type CardValue = (typeof FIBONACCI_DECK)[number];

export type Phase = "voting" | "revealed";

/** A participant as seen by clients. `vote` is only present when phase === "revealed". */
export interface ParticipantView {
  /** Public id, issued by the server. Never the secret `clientId` a participant rejoins
   *  with — that one only ever travels from its owner to the server (SERBITO-361). */
  id: string;
  name: string;
  isObserver: boolean;
  connected: boolean;
  hasVoted: boolean;
  vote?: CardValue | null;
}

export interface Summary {
  /** card value -> how many people picked it (numeric cards only) */
  distribution: Record<string, number>;
  /** true when all numeric voters picked the same card */
  consensus: boolean;
}

/** One finished (revealed) round, recorded in the room's estimate log. Results
 *  only — no per-person votes. The most recent entry is "the votes before the
 *  last reset". */
export interface RoundLog {
  /** the item title at reveal time, if any */
  itemTitle: string | null;
  summary: Summary;
}

// ---- Client -> Server ----
export type ClientMessage =
  | {
      type: "join";
      roomId: string;
      name: string;
      asObserver?: boolean;
      /** Stable per-tab id so a reconnect re-attaches to the same participant (keeps the
       *  vote) instead of spawning a new one. Optional: pre-v3 clients omit it. */
      clientId?: string;
      /** false: join only an existing room; a missing one answers `room_not_found`
       *  instead of being created (a mistyped or expired link, SERBITO-355). Absent
       *  (older clients) or true: create the room if it doesn't exist. */
      create?: boolean;
      /** true when the user started this join (opened the room, pressed Reconnect),
       *  not an automatic reconnect. Counts as activity for the idle disconnect, so a
       *  user who rejoins isn't kicked again at the next sweep (SERBITO-355). */
      manual?: boolean;
    }
  | { type: "vote"; value: CardValue }
  | { type: "unvote" }
  | { type: "reveal" }
  | { type: "reset"; itemTitle?: string }
  | { type: "setObserver"; isObserver: boolean };

/** Longest raw `name` / `itemTitle` a client may send (the server then trims to 40 / 120
 *  for display). Generous on purpose: the lobby input caps names at 40, but a limit
 *  bigger than any real value never locks a legitimate user out. */
export const MAX_NAME_INPUT = 100;
export const MAX_ITEM_TITLE_INPUT = 200;
const MAX_ROOM_ID = 32;
const MAX_CLIENT_ID = 64;

const DECK: ReadonlySet<string> = new Set(FIBONACCI_DECK);

type Fields = Record<string, unknown>;
const isStr = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
const optStr = (v: unknown, max: number) => v === undefined || isStr(v, max);
const optBool = (v: unknown) => v === undefined || typeof v === "boolean";

/**
 * Schema check for an incoming WebSocket message (SERBITO-361 / PKR-4). JSON.parse hands
 * the server `unknown`; the TypeScript type alone proves nothing. Returns the message
 * only when every field has the right type and size, else null — so an array roomId,
 * a numeric vote or a megabyte name never reaches the room logic. Only the fields each
 * message type defines are copied through.
 */
export function parseClientMessage(data: unknown): ClientMessage | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const m = data as Fields;
  switch (m.type) {
    case "join":
      if (
        !isStr(m.roomId, MAX_ROOM_ID) ||
        !isStr(m.name, MAX_NAME_INPUT) ||
        !optBool(m.asObserver) ||
        !optStr(m.clientId, MAX_CLIENT_ID) ||
        !optBool(m.create) ||
        !optBool(m.manual)
      )
        return null;
      return {
        type: "join",
        roomId: m.roomId,
        name: m.name,
        ...(m.asObserver !== undefined ? { asObserver: m.asObserver as boolean } : {}),
        ...(m.clientId !== undefined ? { clientId: m.clientId as string } : {}),
        ...(m.create !== undefined ? { create: m.create as boolean } : {}),
        ...(m.manual !== undefined ? { manual: m.manual as boolean } : {}),
      };
    case "vote":
      if (typeof m.value !== "string" || !DECK.has(m.value)) return null;
      return { type: "vote", value: m.value as CardValue };
    case "unvote":
      return { type: "unvote" };
    case "reveal":
      return { type: "reveal" };
    case "reset":
      if (!optStr(m.itemTitle, MAX_ITEM_TITLE_INPUT)) return null;
      return m.itemTitle === undefined
        ? { type: "reset" }
        : { type: "reset", itemTitle: m.itemTitle as string };
    case "setObserver":
      if (typeof m.isObserver !== "boolean") return null;
      return { type: "setObserver", isObserver: m.isObserver };
    default:
      return null;
  }
}

// ---- Server -> Client ----
export type ServerMessage =
  /** `youId` is the recipient's public id (as in `participants`), not their clientId. */
  | { type: "joined"; youId: string; roomId: string }
  | {
      type: "state";
      roomId: string;
      phase: Phase;
      itemTitle: string | null;
      participants: ParticipantView[];
      /** participant who currently holds the reveal "star"; only they may reveal */
      revealerId: string | null;
      /** results of every revealed round so far, oldest first */
      log: RoundLog[];
    }
  | { type: "summary"; summary: Summary }
  | { type: "error"; code: string; message: string };

export const WS_PATH = "/ws";

/**
 * Private WS close code (4000-4999 range) the server uses when it disconnects an
 * idle room so the single Cloud Run instance can scale to zero. The client treats
 * this code specially: it shows an "inactive" notice and does NOT auto-reconnect.
 */
export const IDLE_CLOSE_CODE = 4000;
