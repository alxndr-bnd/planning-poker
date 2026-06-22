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
  /** average of numeric votes, rounded to 1 decimal, or null if none */
  average: number | null;
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
  | { type: "join"; roomId: string; name: string; asObserver?: boolean }
  | { type: "vote"; value: CardValue }
  | { type: "unvote" }
  | { type: "reveal" }
  | { type: "reset"; itemTitle?: string }
  | { type: "setObserver"; isObserver: boolean };

// ---- Server -> Client ----
export type ServerMessage =
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
