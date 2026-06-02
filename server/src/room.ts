import type {
  CardValue,
  ParticipantView,
  Phase,
  Summary,
} from "@pp/shared";

export interface Participant {
  id: string;
  name: string;
  isObserver: boolean;
  connected: boolean;
  vote: CardValue | null; // kept server-side; never sent to clients during "voting"
}

const NUMERIC = new Set(["1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "144", "233", "377", "610"]);
// Non-estimate "abstain" cards — shown immediately (they don't anchor estimates).
const ABSTAIN = new Set(["?", "☕"]);

/**
 * A single estimation room. Holds all state in memory. The state machine is:
 *   voting --reveal--> revealed --reset--> voting
 * Votes are hidden (server-side) until the room is revealed.
 */
export class Room {
  readonly id: string;
  phase: Phase = "voting";
  itemTitle: string | null = null;
  lastActivityAt = Date.now();
  readonly participants = new Map<string, Participant>();

  constructor(id: string) {
    this.id = id;
  }

  private touch() {
    this.lastActivityAt = Date.now();
  }

  addParticipant(id: string, name: string, isObserver: boolean): Participant {
    const p: Participant = { id, name, isObserver, connected: true, vote: null };
    this.participants.set(id, p);
    this.touch();
    return p;
  }

  removeParticipant(id: string) {
    this.participants.delete(id);
    this.touch();
  }

  vote(id: string, value: CardValue): boolean {
    const p = this.participants.get(id);
    if (!p || p.isObserver || this.phase !== "voting") return false;
    p.vote = value;
    this.touch();
    return true;
  }

  unvote(id: string): boolean {
    const p = this.participants.get(id);
    if (!p || p.isObserver || this.phase !== "voting") return false;
    p.vote = null;
    this.touch();
    return true;
  }

  setObserver(id: string, isObserver: boolean) {
    const p = this.participants.get(id);
    if (!p) return;
    p.isObserver = isObserver;
    if (isObserver) p.vote = null;
    this.touch();
  }

  reveal() {
    this.phase = "revealed";
    this.touch();
  }

  reset(itemTitle?: string) {
    this.phase = "voting";
    this.itemTitle = itemTitle ?? null;
    for (const p of this.participants.values()) p.vote = null;
    this.touch();
  }

  isEmpty(): boolean {
    return this.participants.size === 0;
  }

  hasConnected(): boolean {
    return [...this.participants.values()].some((p) => p.connected);
  }

  /**
   * Build the per-phase view. Numeric vote values are exposed only when revealed;
   * "abstain" cards (? and ☕) are shown immediately since they can't anchor estimates.
   */
  toViews(): ParticipantView[] {
    const revealed = this.phase === "revealed";
    return [...this.participants.values()].map((p) => {
      const showVote = revealed || (p.vote !== null && ABSTAIN.has(p.vote));
      return {
        id: p.id,
        name: p.name,
        isObserver: p.isObserver,
        connected: p.connected,
        hasVoted: p.vote !== null,
        ...(showVote ? { vote: p.vote } : {}),
      };
    });
  }

  summary(): Summary {
    const distribution: Record<string, number> = {};
    const numericValues: number[] = [];
    for (const p of this.participants.values()) {
      if (p.isObserver || p.vote === null) continue;
      distribution[p.vote] = (distribution[p.vote] ?? 0) + 1;
      if (NUMERIC.has(p.vote)) numericValues.push(Number(p.vote));
    }
    const average =
      numericValues.length > 0
        ? Math.round(
            (numericValues.reduce((a, b) => a + b, 0) / numericValues.length) * 10,
          ) / 10
        : null;
    const consensus =
      numericValues.length > 1 && new Set(numericValues).size === 1;
    return { distribution, average, consensus };
  }
}
