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
  "lobby.namePlaceholder": "Your name",
  "lobby.create": "Create room",
  "lobby.join": "Join room",
  "lobby.copyOnCreate": "Copy invite link to clipboard on create",
  "nav.home": "Home",
  "nav.homeTitle": "Back to start — change name or create a new room",
  "room.invite": "Invite teammates",
  "room.copied": "Copied!",
  "room.idleDisconnected": "Disconnected due to inactivity.",
  "room.idleReconnect": "Reconnect",
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
  "log.avg": "avg",
  "summary.average": "Average:",
  "summary.consensus": "Consensus 🎉",
  "learn.summary": "How Planning Poker works — theory & resources",
  "learn.intro":
    "Planning Poker is a consensus-based, gamified estimation technique for agile teams. Everyone privately picks a card; all votes reveal at once to avoid anchoring. The team discusses the spread and re-votes until it converges.",
  "learn.readFull": "Read the full guide →",
  "learn.resources": "Resources",
  "sponsor.full": "Sponsored by serbito.rs",
  "sponsor.short": "by serbito.rs",
  "altto.featured": "Find us on AlternativeTo ↗",
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

/** Saved language, else English (default — no auto-detect, per product choice). */
export function getInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LS_KEY) as Lang | null;
    if (saved && LANGS.some((l) => l.code === saved)) return saved;
  } catch {
    /* localStorage unavailable */
  }
  return "en";
}

export function setLang(lang: Lang): void {
  try {
    localStorage.setItem(LS_KEY, lang);
  } catch {
    /* ignore */
  }
}
