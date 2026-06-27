import type {
  CardValue,
  ParticipantView,
  Phase,
  RoundLog,
  Summary,
} from "@pp/shared";

export interface Participant {
  id: string;
  name: string;
  isObserver: boolean;
  connected: boolean;
  vote: CardValue | null; // kept server-side; never sent to clients during "voting"
  /** ms timestamp of the last disconnect (for the reconnect grace), or null while connected. */
  disconnectedAt: number | null;
}

const NUMERIC = new Set(["1", "2", "3", "5", "8", "13", "21", "34", "55", "89", "144", "233", "377", "610"]);
// Non-estimate "abstain" cards — shown immediately (they don't anchor estimates).
const ABSTAIN = new Set(["?", "☕"]);
// Every legal card a client may submit. Votes outside this set are rejected so a
// malicious client can't pollute the distribution/stats (docs/SECURITY-REVIEW-2026-06-21).
const ALLOWED_VOTES = new Set<string>([...NUMERIC, ...ABSTAIN]);

/**
 * A single estimation room. Holds all state in memory. The state machine is:
 *   voting --reveal--> revealed --reset--> voting
 * Votes are hidden (server-side) until the room is revealed.
 */
export class Room {
  /** Hard cap on participants per room (DoS / memory bound). */
  static readonly MAX_PARTICIPANTS = 100;
  readonly id: string;
  phase: Phase = "voting";
  itemTitle: string | null = null;
  lastActivityAt = Date.now();
  /**
   * Last *engagement* — a real user action (vote/reveal/reset/...), NOT connection
   * churn. Used to detect abandoned rooms so their sockets can be closed and the
   * single Cloud Run instance can scale to zero. Reconnects (join/leave) must NOT
   * bump this, or a forgotten tab's auto-reconnect keeps the room "active" forever.
   */
  lastEngagementAt = Date.now();
  readonly participants = new Map<string, Participant>();
  /** Holder of the reveal "star" — the only participant allowed to reveal. */
  revealerId: string | null = null;
  /** Results of every revealed round, oldest first. */
  readonly log: RoundLog[] = [];

  constructor(id: string) {
    this.id = id;
  }

  private touch() {
    this.lastActivityAt = Date.now();
  }

  /** Record a real user action — resets the idle-disconnect timer. */
  private engage() {
    this.lastEngagementAt = Date.now();
  }

  /** Voting (non-observer) participants — the only ones who can hold the star. */
  private eligibleRevealers(): Participant[] {
    return [...this.participants.values()].filter(
      (p) => p.connected && !p.isObserver,
    );
  }

  /** Pick a fresh random star holder (used at the start of each round). */
  assignRevealer() {
    const eligible = this.eligibleRevealers();
    this.revealerId =
      eligible.length > 0
        ? eligible[Math.floor(Math.random() * eligible.length)].id
        : null;
  }

  /** Reassign only if the current holder is gone or no longer eligible. */
  private ensureRevealer() {
    const cur = this.revealerId
      ? this.participants.get(this.revealerId)
      : undefined;
    if (!cur || !cur.connected || cur.isObserver) this.assignRevealer();
  }

  isFull(): boolean {
    return this.participants.size >= Room.MAX_PARTICIPANTS;
  }

  addParticipant(id: string, name: string, isObserver: boolean): Participant {
    const p: Participant = {
      id,
      name,
      isObserver,
      connected: true,
      vote: null,
      disconnectedAt: null,
    };
    this.participants.set(id, p);
    this.ensureRevealer();
    this.touch();
    return p;
  }

  /**
   * Re-attach a returning participant (same stable clientId) WITHOUT resetting their
   * vote/observer state. This is the fix for "my vote disappears": a flaky WS that
   * reconnects every ~30-100s used to come back as a brand-new participant with no
   * vote. Now the vote (and the reveal "star") survive the reconnect.
   */
  reattachParticipant(id: string, name: string): Participant | null {
    const p = this.participants.get(id);
    if (!p) return null;
    p.connected = true;
    p.disconnectedAt = null;
    if (name) p.name = name;
    this.ensureRevealer();
    this.touch();
    return p; // vote intentionally preserved
  }

  /** Mark connected=false but KEEP the participant (and their vote) for the grace window. */
  markDisconnected(id: string) {
    const p = this.participants.get(id);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    this.ensureRevealer();
    this.touch();
  }

  /** Drop participants that have been disconnected longer than `graceMs` (left for good). */
  purgeDisconnected(graceMs: number): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, p] of this.participants) {
      if (!p.connected && p.disconnectedAt !== null && now - p.disconnectedAt > graceMs) {
        this.participants.delete(id);
        removed++;
      }
    }
    if (removed) {
      this.ensureRevealer();
      this.touch();
    }
    return removed;
  }

  removeParticipant(id: string) {
    this.participants.delete(id);
    this.ensureRevealer();
    this.touch();
  }

  vote(id: string, value: CardValue): boolean {
    const p = this.participants.get(id);
    if (!p || p.isObserver || this.phase !== "voting") return false;
    if (!ALLOWED_VOTES.has(value)) return false; // reject cards not in the deck
    p.vote = value;
    this.touch();
    this.engage();
    return true;
  }

  unvote(id: string): boolean {
    const p = this.participants.get(id);
    if (!p || p.isObserver || this.phase !== "voting") return false;
    p.vote = null;
    this.touch();
    this.engage();
    return true;
  }

  setObserver(id: string, isObserver: boolean) {
    const p = this.participants.get(id);
    if (!p) return;
    p.isObserver = isObserver;
    if (isObserver) p.vote = null;
    this.ensureRevealer(); // a holder who became an observer must hand off the star
    this.touch();
    this.engage();
  }

  /** Only the star holder may reveal. Records the round's results in the log. */
  reveal(by: string): boolean {
    if (this.phase !== "voting" || by !== this.revealerId) return false;
    this.phase = "revealed";
    this.log.push({ itemTitle: this.itemTitle, summary: this.summary() });
    this.touch();
    this.engage();
    return true;
  }

  reset(itemTitle?: string) {
    this.phase = "voting";
    this.itemTitle = itemTitle ?? null;
    for (const p of this.participants.values()) p.vote = null;
    this.assignRevealer(); // fresh random star holder each round
    this.touch();
    this.engage();
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
