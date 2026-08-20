import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import {
  ROOM_VIRTUAL_PATH,
  currentPage,
  trackEvent,
  trackPageView,
} from "../../client/src/analytics.js";

// 2026-06-24: GA4 (G-B5CQC4JJV0) to count users via analytics.google.com.
// Must be the STANDARD static <script src=...gtag/js> snippet — Google's "verify your
// tag" detection does NOT see a dynamically-injected/host-gated tag (that failed
// verification on 2026-06-24). Guard the id + that it's a real static script tag.
const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = join(__dirname, "../../client");
const html = readFileSync(join(clientDir, "index.html"), "utf-8");

const MEASUREMENT_ID = "G-B5CQC4JJV0";
const STATIC_TAG = new RegExp(
  `<script[^>]*src="https://www\\.googletagmanager\\.com/gtag/js\\?id=${MEASUREMENT_ID}"`,
);

/** Every prerendered page under client/public (the SEO landing pages). */
function guidePages(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "index.html") out.push(p);
    }
  };
  walk(join(clientDir, "public"));
  return out.sort();
}

describe("GA4 analytics", () => {
  it("includes the GA4 measurement id", () => {
    expect(html).toContain(MEASUREMENT_ID);
  });
  it("loads gtag.js as a static script tag (so Google can detect/verify it)", () => {
    expect(html).toMatch(STATIC_TAG);
  });

  // 2026-08-20: the prerendered guide pages carried no tag at all, so every visit that
  // landed on the SEO cluster from search was missing from GA4 entirely.
  it("tags every prerendered guide page, not just the app shell", () => {
    const pages = guidePages();
    expect(pages.length).toBeGreaterThan(30); // 4 guides x 9 languages
    const untagged = pages
      .filter((p) => !STATIC_TAG.test(readFileSync(p, "utf-8")))
      .map((p) => relative(clientDir, p));
    expect(untagged).toEqual([]);
  });

  // 2026-08-20: a room id is the invite credential — holding the link is what lets you
  // into the room — so it must never be shipped to a third party. An entry via a shared
  // #/r/<id> link is the one page_view gtag.js sends by itself, so index.html has to
  // normalize it at config time; analytics.ts does the same for later route changes.
  it("normalizes a #/r/<id> entry to the virtual room page at config time", () => {
    expect(html).toContain('location.hash.indexOf("#/r/") === 0');
    expect(html).toContain('location.origin + "/room"');
  });
});

// --------------------------------------------------------------------------- #
// client/src/analytics.ts — the hash-route page_views and funnel events that GA4's
// enhanced measurement cannot see (assigning location.hash fires no history event).
// --------------------------------------------------------------------------- #
describe("client analytics module", () => {
  let calls: unknown[][];

  const setPage = (href: string, hash = "", title = "Planning Poker") => {
    (globalThis as { window?: unknown }).window = {
      gtag: (...args: unknown[]) => calls.push(args),
      location: { href, hash, origin: "https://poker.serbito.rs" },
      document: { title },
    };
  };

  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("reports the real URL outside a room", () => {
    setPage("https://poker.serbito.rs/");
    expect(currentPage()).toEqual({
      page_location: "https://poker.serbito.rs/",
      page_title: "Planning Poker",
    });
  });

  it("never sends a room id — every room is the same virtual page", () => {
    setPage("https://poker.serbito.rs/#/r/ZC3THcb2yw", "#/r/ZC3THcb2yw");
    const page = currentPage();
    expect(page.page_location).toBe(`https://poker.serbito.rs${ROOM_VIRTUAL_PATH}`);
    expect(JSON.stringify(page)).not.toContain("ZC3THcb2yw");
  });

  it("sends a page_view for the room, and re-points the automatic events at it", () => {
    setPage("https://poker.serbito.rs/#/r/ZC3THcb2yw", "#/r/ZC3THcb2yw");
    trackPageView();
    const page = { page_location: "https://poker.serbito.rs/room", page_title: "Planning Poker — Room" };
    // `set` so user_engagement/scroll stop reporting the URL from load time.
    expect(calls).toEqual([
      ["set", page],
      ["event", "page_view", page],
    ]);
  });

  it("attaches the current page to funnel events, and keeps the room id out", () => {
    setPage("https://poker.serbito.rs/#/r/ZC3THcb2yw", "#/r/ZC3THcb2yw");
    trackEvent("vote_cast", { card: "5" });
    expect(calls).toEqual([
      [
        "event",
        "vote_cast",
        {
          page_location: "https://poker.serbito.rs/room",
          page_title: "Planning Poker — Room",
          card: "5",
        },
      ],
    ]);
    expect(JSON.stringify(calls)).not.toContain("ZC3THcb2yw");
  });

  it("stays silent (and never throws) when the tag is blocked or absent", () => {
    (globalThis as { window?: unknown }).window = {
      location: { href: "https://poker.serbito.rs/", hash: "", origin: "https://poker.serbito.rs" },
      document: { title: "Planning Poker" },
    };
    expect(() => {
      trackPageView();
      trackEvent("room_created");
    }).not.toThrow();
    expect(calls).toEqual([]);
  });
});

// --------------------------------------------------------------------------- #
// The four funnel events have to actually be wired in the UI — the module alone
// proves nothing. Guard the call sites in App.tsx.
// --------------------------------------------------------------------------- #
describe("room funnel wiring (App.tsx)", () => {
  const app = readFileSync(join(clientDir, "src/App.tsx"), "utf-8");

  it("re-sends a page_view on every hash route change", () => {
    expect(app).toContain('window.addEventListener("hashchange", onHash)');
    expect(app).toContain("trackPageView()");
  });

  it.each(["room_created", "room_joined", "vote_cast", "round_revealed"])(
    "tracks %s",
    (event) => {
      expect(app).toContain(`trackEvent("${event}"`);
    },
  );
});
