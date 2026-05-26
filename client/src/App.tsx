import { useEffect, useRef, useState } from "react";
import {
  FIBONACCI_DECK,
  type CardValue,
  type ParticipantView,
  type Phase,
  type Summary,
} from "@pp/shared";
import { PokerSocket, newRoomId } from "./ws.js";

const REPO = "alxndr-bnd/planning-poker";
const REPO_URL = `https://github.com/${REPO}`;

// Official GitHub badge (shields.io) — image only, no external JS/tracking.
function GitHubBadge() {
  return (
    <a
      className="gh-badge"
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub repository"
    >
      <img
        alt="GitHub repo"
        height="28"
        src={`https://img.shields.io/github/stars/${REPO}?style=social&logo=github&label=GitHub`}
      />
    </a>
  );
}

function SerbitoSponsor({ short = false }: { short?: boolean }) {
  return (
    <a
      className="sponsor"
      href="https://serbito.rs"
      target="_blank"
      rel="noopener noreferrer"
    >
      {short ? "by serbito.rs" : "Sponsored by serbito.rs"}
    </a>
  );
}

function useHashRoom(): string | null {
  const [roomId, setRoomId] = useState(parseHash);
  useEffect(() => {
    const onHash = () => setRoomId(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return roomId;
}

function parseHash(): string | null {
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9_-]{6,32})$/);
  return m ? m[1] : null;
}

export function App() {
  const roomId = useHashRoom();
  const [name, setName] = useState(() => localStorage.getItem("pp_name") ?? "");
  const joined = roomId && name;

  if (!joined) {
    return <Lobby roomId={roomId} name={name} setName={setName} />;
  }
  return <Room key={roomId} roomId={roomId} name={name} />;
}

function Lobby({
  roomId,
  name,
  setName,
}: {
  roomId: string | null;
  name: string;
  setName: (n: string) => void;
}) {
  const [input, setInput] = useState(name);

  function go() {
    const n = input.trim();
    if (!n) return;
    localStorage.setItem("pp_name", n);
    setName(n);
    if (!roomId) location.hash = `#/r/${newRoomId()}`;
  }

  return (
    <div className="lobby">
      <h1>Planning Poker</h1>
      <p className="muted">
        {roomId ? "Enter your name to join the room." : "Free · no sign-up · unlimited rooms"}
      </p>
      <input
        autoFocus
        placeholder="Your name"
        value={input}
        maxLength={40}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <button onClick={go} disabled={!input.trim()}>
        {roomId ? "Join room" : "Create room"}
      </button>
      <div className="lobby-links">
        <GitHubBadge />
        <SerbitoSponsor />
      </div>
    </div>
  );
}

function Room({ roomId, name }: { roomId: string; name: string }) {
  const sockRef = useRef<PokerSocket | null>(null);
  const [youId, setYouId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("voting");
  const [itemTitle, setItemTitle] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sock = new PokerSocket(
      (msg) => {
        switch (msg.type) {
          case "joined":
            setYouId(msg.youId);
            break;
          case "state":
            setPhase(msg.phase);
            setItemTitle(msg.itemTitle);
            setParticipants(msg.participants);
            if (msg.phase === "voting") setSummary(null);
            break;
          case "summary":
            setSummary(msg.summary);
            break;
        }
      },
      () => sock.send({ type: "join", roomId, name }),
    );
    sock.connect();
    sockRef.current = sock;
    return () => sock.close();
  }, [roomId, name]);

  const send = (m: Parameters<PokerSocket["send"]>[0]) => sockRef.current?.send(m);
  const me = participants.find((p) => p.id === youId);
  const isObserver = me?.isObserver ?? false;

  function copyLink() {
    navigator.clipboard.writeText(location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="room">
      <header className="room-top">
        <div className="brand">
          <button
            className="ghost home-btn"
            onClick={() => {
              location.hash = "";
            }}
            title="Back to start — change name or create a new room"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
              <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
            </svg>
            <span>Home</span>
          </button>
          <h1>Planning Poker</h1>
        </div>
        <div className="room-actions">
          <button className="primary" onClick={copyLink}>
            {copied ? "Copied!" : "Invite teammates"}
          </button>
          <GitHubBadge />
          <SerbitoSponsor short />
        </div>
      </header>

      {/* Reveal / New vote button — top of the screen, anyone in the room can press */}
      <div className="reveal-bar">
        {phase === "voting" ? (
          <>
            <button className="primary" onClick={() => send({ type: "reveal" })}>
              Reveal
            </button>
            <button onClick={() => send({ type: "reset" })} title="Restart the voting round">
              Reset
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => send({ type: "reset" })}>
            New vote
          </button>
        )}
      </div>

      {/* Green table with the players around it, centered */}
      <div className="table-wrap">
        <div className="table">
          {itemTitle && <h2 className="item">{itemTitle}</h2>}
          {/* Equal flex:1 zones above (spacer) and below (summary-slot) center the
              cards while voting. On reveal the summary fills the lower zone, so the
              cards shift up; table height stays constant via min-height. */}
          <div className="table-spacer" aria-hidden="true" />
          <Participants participants={participants} youId={youId} phase={phase} />
          <div className="summary-slot">
            {summary && phase === "revealed" && <SummaryView summary={summary} />}
          </div>
        </div>
      </div>

      {/* Your hand — always rendered (fixed height) so the layout/table height
          doesn't change between voting and results. Cards only show while voting. */}
      <div className="hand">
        {phase === "voting" && (
          <>
            {/* Observer card — pinned left; position stays put when selected */}
            <button
              className={`card observer-card ${isObserver ? "active" : ""}`}
              onClick={() => send({ type: "setObserver", isObserver: !isObserver })}
              title={
                isObserver
                  ? "You are observing — click to join voting"
                  : "Observe (don't vote)"
              }
            >
              <span className="mic-off">🎤</span>
            </button>
            {!isObserver && (
              <Deck
                selected={me?.vote ?? null}
                onPick={(v) =>
                  send(
                    v === (me?.vote ?? null)
                      ? { type: "unvote" }
                      : { type: "vote", value: v },
                  )
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Participants({
  participants,
  youId,
  phase,
}: {
  participants: ParticipantView[];
  youId: string;
  phase: Phase;
}) {
  return (
    <ul className="participants">
      {/* Observers are hidden entirely (no frame, no name); the rest stay centered. */}
      {participants
        .filter((p) => !p.isObserver)
        .map((p) => (
          <li key={p.id} className={p.connected ? "" : "offline"}>
            {phase === "revealed" ? (
              <span className="card-slot">{p.vote ?? "–"}</span>
            ) : p.hasVoted ? (
              <span className="card-slot">✓</span>
            ) : (
              // Expected-but-not-yet-cast vote: dashed placeholder frame
              <span className="card-slot pending">…</span>
            )}
            <span className="pname">
              {p.name}
              {p.id === youId && " (you)"}
            </span>
          </li>
        ))}
    </ul>
  );
}

function Deck({
  selected,
  onPick,
}: {
  selected: CardValue | null;
  onPick: (v: CardValue) => void;
}) {
  // Cards are direct flex children of `.hand` so they lay out in a row.
  // Click the selected card again to cancel; click another to change.
  return (
    <>
      {FIBONACCI_DECK.map((v) => (
        <button
          key={v}
          className={`card ${selected === v ? "selected" : selected ? "dim" : ""}`}
          onClick={() => onPick(v)}
        >
          {v}
        </button>
      ))}
    </>
  );
}

function SummaryView({ summary }: { summary: Summary }) {
  const entries = Object.entries(summary.distribution).sort((a, b) => b[1] - a[1]);
  return (
    <div className="summary">
      <div className="summary-stats">
        <span>Average: <b>{summary.average ?? "–"}</b></span>
        {summary.consensus && <span className="consensus">Consensus 🎉</span>}
      </div>
      <div className="distribution">
        {entries.map(([value, count]) => (
          <span key={value} className="dist-item">
            {value} × {count}
          </span>
        ))}
      </div>
    </div>
  );
}
