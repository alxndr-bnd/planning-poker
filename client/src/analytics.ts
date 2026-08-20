// GA4 (G-B5CQC4JJV0) is loaded by the static gtag.js snippet in index.html, which
// counts exactly one page_view: the one at load. The app routes on the URL hash
// (`#/r/<id>`), and assigning `location.hash` fires none of the history events GA4's
// enhanced measurement listens for (pushState / replaceState / popstate) — so every
// room a user entered was invisible, and an hour-long session showed up as a single
// page_view of the lobby. This module sends the missing page_views, plus the room
// funnel events (lobby -> room_created/room_joined -> vote_cast -> round_revealed).
//
// PRIVACY: a room id IS the invite credential — anyone holding the link can join the
// room — so it must never be sent to analytics. Every room is reported as the same
// virtual page, `/room`. Keeping the id in a fragment would not help: GA4's page-path
// dimension drops the fragment, so the rooms would also be invisible in reports.
// index.html applies the same normalization to the load-time page_view, which is what
// a shared invite link produces.

type EventParams = Record<string, string | number | boolean>;

// Structural, not the DOM lib's `Window`: this module is also type-checked and unit
// tested from the server workspace, whose tsconfig has no DOM lib.
interface AnalyticsWindow {
  gtag?: (...args: unknown[]) => void;
  location: { href: string; hash: string; origin: string };
  document: { title: string };
}

/** The virtual page every room reports as (see PRIVACY above). */
export const ROOM_VIRTUAL_PATH = "/room";

/** Hash prefix of a room route. Mirrors the room route in App.tsx. */
const ROOM_HASH_PREFIX = "#/r/";

/** `window`, or undefined outside the browser (module is imported by the test gate). */
function browser(): AnalyticsWindow | undefined {
  return (globalThis as unknown as { window?: AnalyticsWindow }).window;
}

/**
 * Fire-and-forget call into gtag. The tag can legitimately be missing — a content
 * blocker, or gtag.js still in flight — and analytics must never break the app.
 */
function gtag(...args: unknown[]): void {
  try {
    browser()?.gtag?.(...args);
  } catch {
    /* never let a broken tag surface to the user */
  }
}

/** What GA should report as the current page: real URL, or `/room` inside a room. */
export function currentPage(): { page_location: string; page_title: string } {
  const win = browser();
  if (!win) return { page_location: "", page_title: "" };
  const { location: loc, document: doc } = win;
  return loc.hash.startsWith(ROOM_HASH_PREFIX)
    ? {
        page_location: `${loc.origin}${ROOM_VIRTUAL_PATH}`,
        page_title: "Planning Poker — Room",
      }
    : { page_location: loc.href, page_title: doc.title };
}

/**
 * Report a hash-route change as a page_view. The `set` also re-points the automatic
 * events (user_engagement, scroll) at the new page, which otherwise keep reporting
 * whichever URL the tag was configured with at load.
 */
export function trackPageView(): void {
  const page = currentPage();
  gtag("set", page);
  gtag("event", "page_view", page);
}

/** Report a funnel event against the current page. */
export function trackEvent(name: string, params: EventParams = {}): void {
  gtag("event", name, { ...currentPage(), ...params });
}
