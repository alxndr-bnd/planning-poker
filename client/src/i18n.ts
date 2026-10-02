// Lightweight i18n for the planning-poker UI. English is the source of truth and the
// default; other languages live in i18n.translations.ts and fall back to English per key.
import { TRANSLATIONS } from "./i18n.translations.js";

export type Lang = "en" | "es" | "de" | "fr" | "pt" | "ru" | "sr" | "ja" | "zh";

/** Languages offered in the switcher (label in the language's own name). */
export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "sr", label: "Srpski" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
];

// English strings = the source of truth (keys are derived from this object).
export const EN = {
  "lobby.tagline": "Free · no sign-up · unlimited rooms",
  "lobby.enterName": "Enter your name to join the room.",
  "lobby.nameLabel": "Your name",
  "lobby.create": "Create room",
  "lobby.join": "Join room",
  "lobby.copyOnCreate": "Copy invite link to clipboard on create",
  "nav.home": "Home",
  "nav.homeTitle": "Back to start — change name or create a new room",
  "room.invite": "Invite teammates",
  "room.copied": "Copied!",
  "room.linkCopiedToast": "Invite link copied to clipboard",
  "room.copyFailed": "Couldn't copy the link. Copy it from here:",
  "room.close": "Close",
  "room.idleDisconnected": "Disconnected due to inactivity.",
  "room.idleReconnect": "Reconnect",
  "room.tryAgain": "Try again",
  "room.notFoundTitle": "Room not found",
  "room.notFoundText":
    "This link is mistyped or the room has expired: a room closes a few minutes after everyone leaves.",
  "room.createNew": "Create a new room",
  "room.alone": "You're the only one here. Share the room link to invite your team.",
  "conn.connecting": "Connecting…",
  "conn.reconnecting": "Connection lost. Reconnecting…",
  "conn.voteQueued": "Connection lost. Your vote will be sent when it's back.",
  // Server `error` codes (shared/protocol.ts); unknown codes show the server's text.
  "error.room_full": "This room is full.",
  "error.server_full": "The server is busy. Try again in a few minutes.",
  "error.too_many_rooms": "Too many new rooms from your network. Try again in a few minutes.",
  "error.rate_limited": "Too many actions at once. Wait a moment and try again.",
  "error.bad_room": "This room link is not valid.",
  "error.no_name": "Enter a name to join.",
  "error.internal": "Something went wrong on the server. Try again.",
  "room.reveal": "Reveal",
  "room.revealsThisRound": "{name} reveals this round",
  "room.reset": "Reset",
  "room.resetTitle": "Restart the voting round",
  "room.newVote": "New vote",
  "room.observeJoin": "You are observing — click to join voting",
  "room.observe": "Observe (don't vote)",
  "room.you": "(you)",
  "deck.more": "More",
  "deck.collapse": "Hide high cards",
  "deck.showHighTitle": "Show high cards (89–610)",
  "deck.hideHighTitle": "Hide high cards",
  "log.title": "Estimate log",
  "log.consensus": "consensus",
  "summary.consensus": "Consensus 🎉",
  "learn.summary": "How Planning Poker works — theory & resources",
  "learn.intro":
    "Planning Poker is a consensus-based, gamified estimation technique for agile teams. Everyone privately picks a card; all votes reveal at once to avoid anchoring. The team discusses the spread and re-votes until it converges.",
  "learn.readFull": "Read the full guide →",
  "learn.moreGuides": "More guides",
  "learn.guideGlossary": "Agile estimation glossary",
  "learn.guideJira": "Planning Poker for Jira",
  "learn.guideRemote": "Planning Poker for remote teams",
  "learn.resources": "Resources",
  "sponsor.full": "Sponsored by serbito.rs",
  "sponsor.short": "by serbito.rs",
  "altto.featured": "Like us on AlternativeTo ↗",
  // The app shell's fixed footer (client/index.html, outside React): elements carrying
  // data-pp-i18n="<key>" are re-labelled in the UI language by shell.ts.
  "footer.tagline": "Free & open-source planning poker — no ads, no sign-up.",
  "footer.github": "Open source on GitHub",
  "footer.vote": "🗳️ Vote on what we build next",
  "footer.altto": "Find us on AlternativeTo",
  "footer.privacy": "Privacy",
  "footer.cookies": "Cookie settings",
  // "Other projects" footer block: static HTML rendered at build time by crosspromo.ts.
  "crosspromo.title": "Other projects",
  "crosspromo.gtd": "Free GTD task manager with a Telegram bot",
  "crosspromo.javi": "Delivery notifications for small businesses in Serbia",
  "crosspromo.serbito": "Classifieds in Serbia",
  "crosspromo.madeBy": "Made by {name}",
} as const;

export type StringKey = keyof typeof EN;

/**
 * Translate `key` into `lang`, interpolating `{var}` placeholders. Missing
 * translations fall back to the English string, so partial language files are safe.
 */
export function t(
  lang: Lang,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  const table = lang === "en" ? EN : (TRANSLATIONS[lang] ?? {});
  let s = (table as Record<string, string>)[key] ?? EN[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

const LS_KEY = "pp_lang";

const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.code === v);

/**
 * The first UI language among the browser's preferences, by primary subtag
 * ("ru-RU" -> ru, "pt-BR" -> pt, "sr-Latn-RS" -> sr), or null when none is offered.
 */
export function detectLang(prefs: readonly string[]): Lang | null {
  for (const tag of prefs) {
    const primary = String(tag).split(/[-_]/)[0].toLowerCase();
    if (isLang(primary)) return primary;
  }
  return null;
}

/** `?lang=xx` (the /xx/ guides link to the app with it), removed from the address bar
 *  so it doesn't travel on in a copied room link. */
// Structural, not the DOM lib's types: this module is also type-checked and unit
// tested from the server workspace, whose tsconfig has no DOM lib.
interface AddressBar {
  location: { href: string };
  history: { state: unknown; replaceState(state: unknown, unused: string, url: string): void };
}

function takeLangParam(): Lang | null {
  try {
    const { location, history } = globalThis as unknown as AddressBar;
    const url = new URL(location.href);
    const lang = url.searchParams.get("lang");
    if (lang === null) return null;
    url.searchParams.delete("lang");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    return isLang(lang) ? lang : null;
  } catch {
    return null;
  }
}

/**
 * The UI language (SERBITO-355): `?lang=xx` from a guide link, else the saved choice
 * (pp_lang), else — on the first visit only — the browser's language, else English.
 * The link's and the detected language are saved, so later visits don't re-detect.
 */
export function getInitialLang(): Lang {
  const fromLink = takeLangParam();
  if (fromLink) {
    setLang(fromLink);
    return fromLink;
  }
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* localStorage unavailable */
  }
  let detected: Lang = "en";
  try {
    detected = detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]) ?? "en";
  } catch {
    /* no navigator */
  }
  setLang(detected);
  return detected;
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch {
    /* ignore */
  }
}
