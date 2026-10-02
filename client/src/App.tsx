import {
  createContext,
  useContext,
  useEffect,
  useId,
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
import { PokerSocket, newRoomId, getClientId, type ConnStatus } from "./ws.js";
import {
  type Lang,
  type StringKey,
  EN,
  LANGS,
  t,
  getInitialLang,
  setLang as persistLang,
} from "./i18n.js";
import { resolveUiV2 } from "./ui.js";
import { localizeShell } from "./shell.js";
import { trackEvent, trackPageView } from "./analytics.js";

const REPO = "alxndr-bnd/planning-poker";
const REPO_URL = `https://github.com/${REPO}`;
const ALTERNATIVETO_URL =
  "https://alternativeto.net/software/estimation-poker-serbito/about/";

// Per-language URL prefix for the prerendered guide pages (EN at root, others under
// /<lang>/). A constant lookup keyed by the validated `Lang` union — the resolved value
// is always a string literal, so a guide href can never carry unvalidated input into the
// DOM (no DOM-derived text reaches the href; cf. CodeQL js/xss-through-dom).
const LANG_PREFIX: Record<Lang, string> = {
  en: "",
  es: "/es",
  de: "/de",
  fr: "/fr",
  pt: "/pt",
  ru: "/ru",
  sr: "/sr",
  ja: "/ja",
  zh: "/zh",
};

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

// UI v2 only: a link to our AlternativeTo listing (lobby + room).
function AlternativeToLink() {
  const { tr } = useT();
  return (
    <a
      className="altto-link"
      href={ALTERNATIVETO_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      {tr("altto.featured")}
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

/**
 * Rooms this tab created or has been in (sessionStorage). Only those are (re)created
 * on join — e.g. after a deploy wiped the server's rooms. Any other link must point
 * at a live room: a mistyped or expired one shows "room not found" (SERBITO-355).
 */
const KNOWN_ROOM = (id: string) => `pp_room:${id}`;
function rememberRoom(id: string) {
  try {
    sessionStorage.setItem(KNOWN_ROOM(id), "1");
  } catch {
    /* sessionStorage unavailable: only the in-memory flag in Room */
  }
}
function isKnownRoom(id: string): boolean {
  try {
    return sessionStorage.getItem(KNOWN_ROOM(id)) === "1";
  } catch {
    return false;
  }
}

/** Create a room in this tab and go there. */
function startNewRoom(): string {
  const id = newRoomId();
  rememberRoom(id);
  trackEvent("room_created");
  location.hash = `#/r/${id}`;
  return id;
}

function parseHash(): string | null {
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9_-]{6,32})$/);
  return m ? m[1] : null;
}

export function App() {
  const roomId = useHashRoom();
  const [name, setName] = useState(() => localStorage.getItem("pp_name") ?? "");
  const [lang, setLangState] = useState<Lang>(getInitialLang);
  // Resolved once on load: are we in the v2 UI preview? (`?ui=v2` sticks in localStorage.)
  const [uiV2] = useState(resolveUiV2);

  useEffect(() => {
    document.documentElement.lang = lang;
    localizeShell(lang, document);
  }, [lang]);

  // GA4 counts one page_view — at load, from the tag in index.html. Hash routing
  // (`#/r/<id>`) fires no history event it listens for, so lobby <-> room moves were
  // never counted; send them here. Room ids stay out of GA (see analytics.ts).
  useEffect(() => {
    const onHash = () => trackPageView();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setLang = (l: Lang) => {
    persistLang(l);
    setLangState(l);
  };
  const i18n: I18n = { lang, setLang, tr: (k, v) => t(lang, k, v) };

  const joined = roomId && name;
  return (
    <I18nCtx.Provider value={i18n}>
      <main>
        {!joined ? (
          <Lobby roomId={roomId} name={name} setName={setName} uiV2={uiV2} />
        ) : (
          <Room key={roomId} roomId={roomId} name={name} uiV2={uiV2} />
        )}
      </main>
    </I18nCtx.Provider>
  );
}

function Lobby({
  roomId,
  name,
  setName,
  uiV2,
}: {
  roomId: string | null;
  name: string;
  setName: (n: string) => void;
  uiV2: boolean;
}) {
  const { tr } = useT();
  const nameId = useId();
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
      rememberRoom(id);
      if (copyOnCreate) {
        const url = `${location.origin}${location.pathname}#/r/${id}`;
        navigator.clipboard?.writeText(url).catch(() => {});
        // Flag the freshly-created room so it toasts "link copied" once on entry.
        try {
          sessionStorage.setItem(`pp_link_copied:${id}`, "1");
        } catch {
          /* sessionStorage unavailable — skip the toast */
        }
      }
      trackEvent("room_created");
      location.hash = `#/r/${id}`;
    }
  }

  return (
    <div className="lobby">
      <h1>Planning Poker</h1>
      <p className="muted">{roomId ? tr("lobby.enterName") : tr("lobby.tagline")}</p>
      {/* A visible label, not a placeholder (WCAG 3.3.2). Autofocus only on an invite
          link, where joining is the one thing to do; on the landing it would skip the
          header, language switcher and cookie banner for keyboard users (SERBITO-350). */}
      <div className="name-field">
        <label htmlFor={nameId}>{tr("lobby.nameLabel")}</label>
        <input
          id={nameId}
          autoFocus={!!roomId}
          autoComplete="nickname"
          value={input}
          maxLength={40}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
      </div>
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
      {uiV2 && (
        <div className="altto-row">
          <AlternativeToLink />
        </div>
      )}
      <LearnMore />
    </div>
  );
}

function LearnMore() {
  const { lang, tr } = useT();
  // Lang-aware clean-URL to a prerendered guide page, via the constant LANG_PREFIX map.
  const guide = (slug: string) => `${LANG_PREFIX[lang]}/${slug}`;
  return (
    <details className="learn">
      <summary>{tr("learn.summary")}</summary>
      <div className="learn-body">
        <p>{tr("learn.intro")}</p>
        <p>
          <a href={guide("what-is-planning-poker")}>{tr("learn.readFull")}</a>
        </p>
        {/* Internal links to the guide cluster, in the rendered app itself (the static
            landing below #root links to the English guides only), so every language's
            guides are linked from the live page. */}
        <p>
          <b>{tr("learn.moreGuides")}</b>
        </p>
        <ul>
          <li>
            <a href={guide("glossary")}>{tr("learn.guideGlossary")}</a>
          </li>
          <li>
            <a href={guide("planning-poker-for-jira")}>{tr("learn.guideJira")}</a>
          </li>
          <li>
            <a href={guide("planning-poker-for-remote-teams")}>{tr("learn.guideRemote")}</a>
          </li>
        </ul>
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

/** Server errors that end the join: the socket is closed and the user decides. */
const FATAL_ERRORS = new Set(["room_full", "server_full", "too_many_rooms", "bad_room", "no_name"]);

/** The message for a server `error`: ours when we know the code, else the server's. */
function errorText(tr: I18n["tr"], code: string, message: string): string {
  const key = `error.${code}`;
  return key in EN ? tr(key as StringKey) : message || tr("error.internal");
}

function Room({ roomId, name, uiV2 }: { roomId: string; name: string; uiV2: boolean }) {
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
  // Transient toast (e.g. "invite link copied" right after creating the room).
  const [toast, setToast] = useState<string | null>(null);
  // Socket state, shown as a pill while we're not connected (SERBITO-355).
  const [conn, setConn] = useState<ConnStatus>("connecting");
  // A server error that ended the join (room full, ...): the socket is closed.
  const [fatal, setFatal] = useState<string | null>(null);
  // Any other server error (rate limited, ...), shown for a few seconds.
  const [notice, setNotice] = useState<string | null>(null);
  // A vote (or un-vote: value null) made while the socket was down. Sent once the
  // server has us back (on `joined`); shown as our pick meanwhile.
  const [pending, setPending] = useState<{ value: CardValue | null } | null>(null);
  const pendingRef = useRef<{ value: CardValue | null } | null>(null);
  const queueVote = (p: { value: CardValue | null } | null) => {
    pendingRef.current = p;
    setPending(p);
  };
  const trRef = useRef(tr);
  trRef.current = tr;

  // If this room was just created with "copy link on create" ticked, the lobby flagged
  // it — show a one-shot toast on entry so the creator knows the link is on the clipboard.
  useEffect(() => {
    try {
      const key = `pp_link_copied:${roomId}`;
      if (sessionStorage.getItem(key) === "1") {
        sessionStorage.removeItem(key);
        setToast(tr("room.linkCopiedToast"));
        const timer = setTimeout(() => setToast(null), 3000);
        return () => clearTimeout(timer);
      }
    } catch {
      /* sessionStorage unavailable */
    }
  }, [roomId, tr]);

  // Our current observer role, mirrored into a ref so the (re)connect handler — whose
  // closure is created once — always re-sends the *current* role. Without this, a
  // reconnect after the server lost our participant (grace expired, or a deploy reset
  // the in-memory rooms) re-adds us as a plain voter and the observer state is lost.
  const observerRef = useRef(false);
  // The server re-sends `joined` after every reconnect; the funnel wants one event
  // per room entry. Room is keyed by roomId, so this resets when the room changes.
  const joinTracked = useRef(false);
  // The room exists for us: we created it here, or we've been in it. Then a join may
  // (re)create it; otherwise a missing room is "not found".
  const knownRef = useRef(isKnownRoom(roomId));
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const sock = new PokerSocket(
      (msg) => {
        switch (msg.type) {
          case "joined": {
            setYouId(msg.youId);
            knownRef.current = true;
            rememberRoom(roomId);
            if (!joinTracked.current) {
              joinTracked.current = true;
              trackEvent("room_joined");
            }
            const p = pendingRef.current;
            if (p) {
              sock.send(p.value === null ? { type: "unvote" } : { type: "vote", value: p.value });
              queueVote(null);
            }
            break;
          }
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
          case "error": {
            if (msg.code === "room_not_found") {
              sock.close();
              setNotFound(true);
              break;
            }
            const text = errorText(trRef.current, msg.code, msg.message);
            if (FATAL_ERRORS.has(msg.code)) {
              sock.close();
              setFatal(text);
            } else {
              setNotice(text);
            }
            break;
          }
        }
      },
      () => {
        setIdleDisconnected(false);
        // Carry the observer role across the reconnect: the server keeps it when it can
        // re-attach us, but falls back to asObserver when our participant is gone.
        sock.send({
          type: "join",
          roomId,
          name,
          clientId: getClientId(),
          asObserver: observerRef.current,
          create: knownRef.current,
        });
      },
      () => setIdleDisconnected(true),
      setConn,
    );
    sock.connect();
    sockRef.current = sock;
    return () => sock.close();
  }, [roomId, name]);

  // Hide a transient server notice after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const send = (m: Parameters<PokerSocket["send"]>[0]) => sockRef.current?.send(m) ?? false;
  const online = conn === "open" && !fatal && !idleDisconnected;
  const me = participants.find((p) => p.id === youId);
  const myVote = pending ? pending.value : (me?.vote ?? null);
  const isObserver = me?.isObserver ?? false;
  observerRef.current = isObserver;

  function copyLink() {
    navigator.clipboard.writeText(location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (notFound) {
    return (
      <div className="room not-found">
        <div className="not-found-card" role="alert">
          <h1>{tr("room.notFoundTitle")}</h1>
          <p>{tr("room.notFoundText")}</p>
          <div className="not-found-actions">
            <button className="primary" onClick={() => startNewRoom()}>
              {tr("room.createNew")}
            </button>
            <button onClick={() => (location.hash = "")}>{tr("nav.home")}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="room">
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {fatal && (
        <div className="idle-banner" role="alert">
          <span>{fatal}</span>
          <button
            className="primary"
            onClick={() => {
              setFatal(null);
              setConn("connecting");
              sockRef.current?.connect();
            }}
          >
            {tr("room.tryAgain")}
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="alert">
          {notice}
        </div>
      )}
      {!online && !fatal && !idleDisconnected && (
        <div className="conn-pill" role="status">
          {conn === "connecting"
            ? tr("conn.connecting")
            : pending
              ? tr("conn.voteQueued")
              : tr("conn.reconnecting")}
        </div>
      )}
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
          {uiV2 && <AlternativeToLink />}
          <LanguageSwitcher />
          <GitHubBadge />
          <SerbitoSponsor short />
        </div>
      </header>

      <div className="reveal-bar">
        {phase === "voting" ? (
          <>
            {youId === revealerId ? (
              <button
                className="primary"
                disabled={!online}
                onClick={() => {
                  trackEvent("round_revealed");
                  send({ type: "reveal" });
                }}
              >
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
            <button disabled={!online} onClick={() => send({ type: "reset" })} title={tr("room.resetTitle")}>
              {tr("room.reset")}
            </button>
          </>
        ) : (
          <button className="primary" disabled={!online} onClick={() => send({ type: "reset" })}>
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
            {phase === "voting" && me && participants.length === 1 && (
              <div className="empty-room">
                <p>{tr("room.alone")}</p>
                <button className="primary" onClick={copyLink}>
                  {copied ? tr("room.copied") : tr("room.invite")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="hand">
        {phase === "voting" && (
          <>
            <button
              className={`card observer-card ${isObserver ? "active" : ""}`}
              disabled={!online}
              onClick={() => send({ type: "setObserver", isObserver: !isObserver })}
              title={isObserver ? tr("room.observeJoin") : tr("room.observe")}
              aria-pressed={isObserver}
            >
              <span className="mic-off" aria-hidden="true">🎤</span>
              {/* Shown on phones only, where the toggle is a labelled row above the deck. */}
              <span className="observer-label">{tr("room.observe")}</span>
            </button>
            {!isObserver && (
              <Deck
                selected={myVote}
                onPick={(v) => {
                  // Offline: keep the pick and send it once we're back (SERBITO-355).
                  if (v === myVote) {
                    if (!send({ type: "unvote" })) queueVote({ value: null });
                    else if (pending) queueVote(null);
                    return;
                  }
                  trackEvent("vote_cast", { card: String(v) });
                  if (!send({ type: "vote", value: v })) queueVote({ value: v });
                  else if (pending) queueVote(null);
                }}
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
            {r.summary.consensus && (
              <span className="log-consensus">
                <span className="consensus">✓ {tr("log.consensus")}</span>
              </span>
            )}
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
      {summary.consensus && (
        <div className="summary-stats">
          <span className="consensus">{tr("summary.consensus")}</span>
        </div>
      )}
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
