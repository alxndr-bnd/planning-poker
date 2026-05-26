// Single source of truth for the WebSocket protocol, shared by client and server.

export const FIBONACCI_DECK = [
  "1",
  "2",
  "3",
  "5",
  "8",
  "13",
  "21",
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

// ---- Client -> Server ----
export type ClientMessage =
  | { type: "join"; roomId: string; name: string; asObserver?: boolean }
  | { type: "vote"; value: CardValue }
  | { type: "unvote" }
  | { type: "reveal" }
  | { type: "reset"; itemTitle?: string }
  | { type: "setObserver"; isObserver: boolean }
  | { type: "rename"; name: string }
  | { type: "ping" };

// ---- Server -> Client ----
export type ServerMessage =
  | { type: "joined"; youId: string; roomId: string }
  | {
      type: "state";
      roomId: string;
      phase: Phase;
      itemTitle: string | null;
      hostId: string;
      participants: ParticipantView[];
    }
  | { type: "summary"; summary: Summary }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

export const WS_PATH = "/ws";
