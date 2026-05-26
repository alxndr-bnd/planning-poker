import { useEffect, useRef, useState } from "react";
import {
  FIBONACCI_DECK,
  type CardValue,
  type ParticipantView,
  type Phase,
  type Summary,
} from "@pp/shared";
import { PokerSocket, newRoomId } from "./ws.js";

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
    </div>
  );
}

function Room({ roomId, name }: { roomId: string; name: string }) {
  const sockRef = useRef<PokerSocket | null>(null);
  const [youId, setYouId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("voting");
  const [itemTitle, setItemTitle] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string>("");
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
            setHostId(msg.hostId);
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
  const isHost = youId === hostId;
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
        <h1>Planning Poker</h1>
        <div className="room-actions">
          <button onClick={copyLink}>{copied ? "Copied!" : "Copy invite link"}</button>
          <label className="observer-toggle">
            <input
              type="checkbox"
              checked={isObserver}
              onChange={(e) => send({ type: "setObserver", isObserver: e.target.checked })}
            />
            Observer
          </label>
        </div>
      </header>

      {/* Reveal / New vote button — top of the screen */}
      <div className="reveal-bar">
        {isHost ? (
          phase === "voting" ? (
            <button className="primary" onClick={() => send({ type: "reveal" })}>
              Reveal
            </button>
          ) : (
            <button className="primary" onClick={() => send({ type: "reset" })}>
              New vote
            </button>
          )
        ) : (
          <span className="muted">
            Waiting for the host to {phase === "voting" ? "reveal" : "start a new vote"}…
          </span>
        )}
      </div>

      {/* Green table with the players around it, centered */}
      <div className="table-wrap">
        <div className="table">
          {itemTitle && <h2 className="item">{itemTitle}</h2>}
          <Participants
            participants={participants}
            youId={youId}
            hostId={hostId}
            phase={phase}
          />
          {summary && phase === "revealed" && <SummaryView summary={summary} />}
        </div>
      </div>

      {/* Your own hand of cards — bottom of the screen */}
      {!isObserver && phase === "voting" && (
        <div className="hand">
          <Deck
            myVote={me?.hasVoted ? "voted" : null}
            onVote={(v) => send({ type: "vote", value: v })}
          />
        </div>
      )}
    </div>
  );
}

function Participants({
  participants,
  youId,
  hostId,
  phase,
}: {
  participants: ParticipantView[];
  youId: string;
  hostId: string;
  phase: Phase;
}) {
  return (
    <ul className="participants">
      {participants.map((p) => (
        <li key={p.id} className={p.connected ? "" : "offline"}>
          <span className={`card-slot ${p.isObserver ? "observer" : ""}`}>
            {p.isObserver ? (
              <span className="mic-off" title="Observer (not voting)">
                🎤
              </span>
            ) : phase === "revealed" ? (
              (p.vote ?? "–")
            ) : p.hasVoted ? (
              "✓"
            ) : (
              "…"
            )}
          </span>
          <span className="pname">
            {p.name}
            {p.id === youId && " (you)"}
            {p.id === hostId && " ⭐"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Deck({ myVote, onVote }: { myVote: string | null; onVote: (v: CardValue) => void }) {
  return (
    <div className="deck">
      {FIBONACCI_DECK.map((v) => (
        <button key={v} className={`card ${myVote ? "dim" : ""}`} onClick={() => onVote(v)}>
          {v}
        </button>
      ))}
    </div>
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
