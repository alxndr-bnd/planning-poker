import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FIBONACCI_DECK,
  type CardValue,
  type ParticipantView,
  type Phase,
  type RoundLog,
  type Summary,
} from "@pp/shared";
import { PokerSocket, newRoomId } from "./ws.js";
import {
  type Lang,
  type StringKey,
  LANGS,
  t,
  getInitialLang,
  setLang as persistLang,
} from "./i18n.js";

const REPO = "alxndr-bnd/planning-poker";
const REPO_URL = `https://github.com/${REPO}`;

// --- i18n context: lang + a bound translator, available to every component. ---
type I18n = { lang: Lang; setLang: (l: Lang) => void; tr: (k: StringKey, v?: Record<string, string | number>) => string };
const I18nCtx = createContext<I18n>({ lang: "en", setLang: () => {}, tr: (k) => t("en", k) });
const useT = () => useContext(I18nCtx);

function LanguageSwitcher() {
  const { lang, setLang } = useT();
  return (
    <select
      className="lang-switcher"
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      aria-label="Language"
      title="Language"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

// Official GitHub badge (shields.io) — image only, no external JS/tracking.
function GitHubBadge() {
  return (
    <a className="gh-badge" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub repository">
      <img alt="GitHub repo" height="28" src={`https://img.shields.io/github/stars/${REPO}?style=social&logo=github&label=GitHub`} />
    </a>
  );
}

function SerbitoSponsor({ short = false }: { short?: boolean }) {
  const { tr } = useT();
  return (
    <a className="sponsor" href="https://serbito.rs" target="_blank" rel="noopener noreferrer">
      {short ? tr("sponsor.short") : tr("sponsor.full")}
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
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    persistLang(l);
    setLangState(l);
  };
  const i18n: I18n = { lang, setLang, tr: (k, v) => t(lang, k, v) };

  const joined = roomId && name;
  return (
    <I18nCtx.Provider value={i18n}>
      {!joined ? (
        <Lobby roomId={roomId} name={name} setName={setName} />
      ) : (
        <Room key={roomId} roomId={roomId} name={name} />
      )}
    </I18nCtx.Provider>
  );
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
  const { tr } = useT();
  const [input, setInput] = useState(name);
  const [copyOnCreate, setCopyOnCreate] = useState(
    () => localStorage.getItem("pp_copy_on_create") !== "0",
  );

  function go() {
    const n = input.trim();
    if (!n) return;
    localStorage.setItem("pp_name", n);
    setName(n);
    if (!roomId) {
      const id = newRoomId();
      if (copyOnCreate) {
        const url = `${location.origin}${location.pathname}#/r/${id}`;
        navigator.clipboard?.writeText(url).catch(() => {});
      }
      location.hash = `#/r/${id}`;
    }
  }

  return (
    <div className="lobby">
      <h1>Planning Poker</h1>
      <p className="muted">{roomId ? tr("lobby.enterName") : tr("lobby.tagline")}</p>
      <input
        autoFocus
        placeholder={tr("lobby.namePlaceholder")}
        value={input}
        maxLength={40}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <button onClick={go} disabled={!input.trim()}>
        {roomId ? tr("lobby.join") : tr("lobby.create")}
      </button>
      {!roomId && (
        <label className="copy-on-create">
          <input
            type="checkbox"
            checked={copyOnCreate}
            onChange={(e) => {
              setCopyOnCreate(e.target.checked);
              localStorage.setItem("pp_copy_on_create", e.target.checked ? "1" : "0");
            }}
          />
          {tr("lobby.copyOnCreate")}
        </label>
      )}
      <div className="lobby-links">
        <LanguageSwitcher />
        <GitHubBadge />
        <SerbitoSponsor />
      </div>
      <LearnMore />
    </div>
  );
}

function LearnMore() {
  const { lang, tr } = useT();
  const guideHref =
    lang === "en" ? "/what-is-planning-poker" : `/${lang}/what-is-planning-poker`;
  return (
    <details className="learn">
      <summary>{tr("learn.summary")}</summary>
      <div className="learn-body">
        <p>{tr("learn.intro")}</p>
        <p>
          <a href={guideHref}>{tr("learn.readFull")}</a>
        </p>
        <p>
          <b>{tr("learn.resources")}</b>
        </p>
        <ul>
          <li>
            <a href="https://en.wikipedia.org/wiki/Planning_poker" target="_blank" rel="noopener noreferrer">
              Planning Poker — Wikipedia
            </a>
          </li>
          <li>
            <a href="https://www.mountaingoatsoftware.com/agile/planning-poker" target="_blank" rel="noopener noreferrer">
              Mountain Goat Software — Planning Poker guide
            </a>
          </li>
          <li>
            <a href="https://www.mountaingoatsoftware.com/books/agile-estimating-and-planning" target="_blank" rel="noopener noreferrer">
              Mike Cohn — Agile Estimating and Planning
            </a>
          </li>
        </ul>
      </div>
    </details>
  );
}

function Room({ roomId, name }: { roomId: string; name: string }) {
  const { tr } = useT();
  const sockRef = useRef<PokerSocket | null>(null);
  const [youId, setYouId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("voting");
  const [itemTitle, setItemTitle] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealerId, setRevealerId] = useState<string | null>(null);
  const [log, setLog] = useState<RoundLog[]>([]);
  // Server closed our socket for inactivity (idle-disconnect, lets Cloud Run scale
  // to zero). We do NOT auto-reconnect; the user clicks to rejoin.
  const [idleDisconnected, setIdleDisconnected] = useState(false);

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
            setRevealerId(msg.revealerId);
            setLog(msg.log);
            if (msg.phase === "voting") setSummary(null);
            break;
          case "summary":
            setSummary(msg.summary);
            break;
        }
      },
      () => {
        setIdleDisconnected(false);
        sock.send({ type: "join", roomId, name });
      },
      () => setIdleDisconnected(true),
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
      {idleDisconnected && (
        <div className="idle-banner" role="alert">
          <span>{tr("room.idleDisconnected")}</span>
          <button
            className="primary"
            onClick={() => {
              setIdleDisconnected(false);
              sockRef.current?.connect();
            }}
          >
            {tr("room.idleReconnect")}
          </button>
        </div>
      )}
      <header className="room-top">
        <div className="brand">
          <button
            className="ghost home-btn"
            onClick={() => {
              location.hash = "";
            }}
            title={tr("nav.homeTitle")}
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
              <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
            </svg>
            <span>{tr("nav.home")}</span>
          </button>
          <h1>Planning Poker</h1>
        </div>
        <div className="room-actions">
          <button className="primary" onClick={copyLink}>
            {copied ? tr("room.copied") : tr("room.invite")}
          </button>
          <LanguageSwitcher />
          <GitHubBadge />
          <SerbitoSponsor short />
        </div>
      </header>

      <div className="reveal-bar">
        {phase === "voting" ? (
          <>
            {youId === revealerId ? (
              <button className="primary" onClick={() => send({ type: "reveal" })}>
                {tr("room.reveal")}
              </button>
            ) : (
              <span className="reveal-hint">
                ⭐{" "}
                {tr("room.revealsThisRound", {
                  name: participants.find((p) => p.id === revealerId)?.name ?? "—",
                })}
              </span>
            )}
            <button onClick={() => send({ type: "reset" })} title={tr("room.resetTitle")}>
              {tr("room.reset")}
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => send({ type: "reset" })}>
            {tr("room.newVote")}
          </button>
        )}
      </div>

      <div className="table-wrap">
        <div className="table">
          {itemTitle && <h2 className="item">{itemTitle}</h2>}
          <div className="table-spacer" aria-hidden="true" />
          <Participants participants={participants} youId={youId} phase={phase} revealerId={revealerId} />
          <div className="summary-slot">
            {summary && phase === "revealed" && <SummaryView summary={summary} />}
          </div>
        </div>
      </div>

      <div className="hand">
        {phase === "voting" && (
          <>
            <button
              className={`card observer-card ${isObserver ? "active" : ""}`}
              onClick={() => send({ type: "setObserver", isObserver: !isObserver })}
              title={isObserver ? tr("room.observeJoin") : tr("room.observe")}
            >
              <span className="mic-off">🎤</span>
            </button>
            {!isObserver && (
              <Deck
                selected={me?.vote ?? null}
                onPick={(v) =>
                  send(v === (me?.vote ?? null) ? { type: "unvote" } : { type: "vote", value: v })
                }
              />
            )}
          </>
        )}
      </div>

      <footer className="room-footer">
        <EstimateLog log={log} />
        <LearnMore />
      </footer>
    </div>
  );
}

function Participants({
  participants,
  youId,
  phase,
  revealerId,
}: {
  participants: ParticipantView[];
  youId: string;
  phase: Phase;
  revealerId: string | null;
}) {
  const { tr } = useT();
  return (
    <ul className="participants">
      {participants
        .filter((p) => !p.isObserver)
        .map((p) => (
          <li key={p.id} className={p.connected ? "" : "offline"}>
            {phase === "revealed" ? (
              <span className="card-slot">{p.vote ?? "–"}</span>
            ) : p.vote === "?" || p.vote === "☕" ? (
              <span className="card-slot">{p.vote}</span>
            ) : p.hasVoted ? (
              <span className="card-slot">✓</span>
            ) : (
              <span className="card-slot pending">…</span>
            )}
            <span className="pname">
              {p.id === revealerId && (
                <span className="star" title="Reveals this round">
                  ⭐
                </span>
              )}
              {p.name}
              {p.id === youId && ` ${tr("room.you")}`}
            </span>
          </li>
        ))}
    </ul>
  );
}

function EstimateLog({ log }: { log: RoundLog[] }) {
  const { tr } = useT();
  if (log.length === 0) return null;
  const rounds = log.map((r, i) => ({ r, n: i + 1 })).reverse();
  return (
    <details className="estimate-log">
      <summary>
        {tr("log.title")} ({log.length})
      </summary>
      <ol className="log-list">
        {rounds.map(({ r, n }) => (
          <li key={n}>
            <span className="log-round">#{n}</span>
            <span className="log-title">{r.itemTitle || "—"}</span>
            <span className="log-avg">
              {r.summary.consensus && <span className="consensus">✓ </span>}
              {tr("log.avg")} {r.summary.average ?? "–"}
            </span>
            <span className="log-dist">
              {Object.entries(r.summary.distribution)
                .sort((a, b) => b[1] - a[1])
                .map(([value, count]) => (
                  <span key={value} className="log-chip">
                    {value}×{count}
                  </span>
                ))}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

const EXTENDED_CARDS: readonly CardValue[] = ["89", "144", "233", "377", "610"];

function Deck({
  selected,
  onPick,
}: {
  selected: CardValue | null;
  onPick: (v: CardValue) => void;
}) {
  const { tr } = useT();
  const [expanded, setExpanded] = useState(false);
  const showExtended = expanded || (selected != null && EXTENDED_CARDS.includes(selected));

  const numbers = FIBONACCI_DECK.filter(
    (v) => v !== "?" && v !== "☕" && (showExtended || !EXTENDED_CARDS.includes(v)),
  );
  const n = numbers.length + 2 + 1;

  const renderCard = (v: CardValue) => (
    <button
      key={v}
      className={`card ${selected === v ? "selected" : selected ? "dim" : ""}`}
      onClick={() => onPick(v)}
    >
      {v}
    </button>
  );

  return (
    <div className="fan" style={{ ["--n" as string]: n }}>
      {numbers.map(renderCard)}
      <button
        className="card toggle"
        onClick={() => setExpanded((e) => !e)}
        title={showExtended ? tr("deck.hideHighTitle") : tr("deck.showHighTitle")}
      >
        {showExtended ? "«" : `${tr("deck.more")} 🤪🫠`}
      </button>
      {renderCard("?")}
      {renderCard("☕")}
    </div>
  );
}

function SummaryView({ summary }: { summary: Summary }) {
  const { tr } = useT();
  const entries = Object.entries(summary.distribution).sort((a, b) => b[1] - a[1]);
  return (
    <div className="summary">
      <div className="summary-stats">
        <span>
          {tr("summary.average")} <b>{summary.average ?? "–"}</b>
        </span>
        {summary.consensus && <span className="consensus">{tr("summary.consensus")}</span>}
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
