import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { trackEvent } from "../../client/src/analytics.js";
import { inlineScripts } from "../src/static.js";

// SERBITO-320: GA4 stays, but only with consent. Every page sets the Consent Mode v2
// default inline, before the gtag "config" (denied unless the visitor accepted within
// 12 months), and loads the one shared banner script, client/public/consent.js, which
// asks, stores the answer (pp_consent) and sends the consent update. The footer's
// "Cookie settings" link reopens it.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const clientDir = join(here, "../../client");
const read = (p: string) => readFileSync(p, "utf-8");
const CONSENT_JS = read(join(clientDir, "public/consent.js"));

/** client/index.html + every client/public/**\/index.html (36 guides + /privacy). */
function allPages(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name === "index.html"
          ? [join(dir, e.name)]
          : [],
    );
  return [join(clientDir, "index.html"), ...walk(join(clientDir, "public")).sort()];
}

/** The inline consent-default block of a page's <head>. */
function defaultBlock(html: string): string | undefined {
  return /\/\/ Consent Mode v2 \(SERBITO-320\)[\s\S]*?\}\)\(\);/.exec(html)?.[0];
}

const footer = (html: string) =>
  html.slice(html.lastIndexOf("<footer"), html.lastIndexOf("</footer>"));

const DAY = 24 * 60 * 60 * 1000;
const stored = (choice: string, ageDays: number) =>
  JSON.stringify({ choice, date: new Date(Date.now() - ageDays * DAY).toISOString() });

// --------------------------------------------------------------------------- #
// Every page
// --------------------------------------------------------------------------- #
describe("consent on every page", () => {
  const pages = allPages().map((file) => ({
    file: relative(clientDir, file),
    html: read(file),
  }));

  it("covers the app shell, the 36 guides and /privacy", () => {
    expect(pages.length).toBeGreaterThanOrEqual(38);
  });

  it("sets the consent default before the gtag config, identically everywhere", () => {
    const canonical = defaultBlock(pages[0].html);
    expect(canonical).toBeDefined();
    const bad = pages.filter(({ html }) => {
      const block = defaultBlock(html);
      const at = block ? html.indexOf(block) : -1;
      const config = html.search(/gtag\(\s*"config"/); // the app shell splits it over lines
      return block !== canonical || at < 0 || config < 0 || at > config;
    });
    expect(bad.map((p) => p.file)).toEqual([]);
  });

  // Run each page's real inline gtag snippet: the dataLayer it leaves is what gtag.js
  // reads, in order.
  it("queues consent default -> js -> config with host-only cookies, on every page", () => {
    const bad: string[] = [];
    for (const { file, html } of pages) {
      // inlineScripts: a tag scanner, not a regex (CodeQL js/bad-tag-filter).
      const script = inlineScripts(html).find((s) => /gtag\(\s*"config"/.test(s))!;
      for (const hash of ["", "#/r/ZC3THcb2yw"]) {
        const ctx: Record<string, unknown> = {
          localStorage: { getItem: () => null },
          location: { hash, origin: "https://poker.serbito.rs" },
        };
        ctx.window = ctx;
        runInContext(script, createContext(ctx));
        const dl = (ctx.dataLayer as ArrayLike<unknown>[]).map((a) => Array.from(a));
        const ok =
          dl.length === 3 &&
          dl[0][0] === "consent" &&
          dl[0][1] === "default" &&
          (dl[0][2] as Record<string, unknown>).analytics_storage === "denied" &&
          dl[1][0] === "js" &&
          dl[2][0] === "config" &&
          dl[2][1] === "G-B5CQC4JJV0" &&
          // Host-only _ga cookies: not shared with the other *.serbito.rs sites.
          (dl[2][2] as Record<string, unknown> | undefined)?.cookie_domain === "none" &&
          !JSON.stringify(dl).includes("ZC3THcb2yw");
        if (!ok) bad.push(`${file} ${hash}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("defaults every Consent Mode v2 signal to denied, and waits for the update", () => {
    const block = defaultBlock(pages[0].html)!;
    expect(block).toContain('gtag("consent", "default", {');
    for (const k of ["ad_storage", "ad_user_data", "ad_personalization"]) {
      expect(block).toContain(`${k}: "denied"`);
    }
    expect(block).toContain('var a = "denied"');
    expect(block).toContain("analytics_storage: a");
    expect(block).toContain("wait_for_update: 500");
  });

  it("loads the shared banner script (one file, not a copy per page)", () => {
    const missing = pages.filter(
      ({ html }) => !html.includes('<script defer src="/consent.js"></script>'),
    );
    expect(missing.map((p) => p.file)).toEqual([]);
    expect(pages.every(({ html }) => !html.includes("ppConsent"))).toBe(true);
  });

  it("has a translated 'Cookie settings' link in the footer", () => {
    const text = runBanner().win.ppConsent.text as Record<string, string[]>;
    const bad = pages.filter(({ html }) => {
      const lang = /<html lang="([a-z]{2})/.exec(html)![1];
      const link = /<a href="\/privacy#cookies"[^>]*\sdata-pp-consent(?:\s[^>]*)?>([^<]+)<\/a>/.exec(
        footer(html),
      );
      // The app shell's footer is English whatever the UI language (like the rest of it).
      return !link || link[1] !== text[lang][3];
    });
    expect(bad.map((p) => p.file)).toEqual([]);
  });
});

// --------------------------------------------------------------------------- #
// The inline default, executed
// --------------------------------------------------------------------------- #
describe("inline consent default", () => {
  const block = defaultBlock(read(join(clientDir, "index.html")))!;

  function run(storage: { getItem: (k: string) => string | null }) {
    const calls: unknown[][] = [];
    const ctx = createContext({ localStorage: storage, gtag: (...a: unknown[]) => calls.push(a) });
    runInContext(block, ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toEqual(["consent", "default"]);
    return calls[0][2] as Record<string, unknown>;
  }
  const withItem = (v: string | null) => ({ getItem: (k: string) => (k === "pp_consent" ? v : null) });

  it("denies everything for a new visitor", () => {
    expect(run(withItem(null))).toEqual({
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      wait_for_update: 500,
    });
  });

  it("applies a returning visitor's Accept at once — analytics only", () => {
    const c = run(withItem(stored("granted", 30)));
    expect(c.analytics_storage).toBe("granted");
    expect(c.ad_storage).toBe("denied");
    expect(c.ad_user_data).toBe("denied");
    expect(c.ad_personalization).toBe("denied");
  });

  it("stays denied after a Decline, an expired Accept, junk, or blocked storage", () => {
    expect(run(withItem(stored("denied", 1))).analytics_storage).toBe("denied");
    expect(run(withItem(stored("granted", 366))).analytics_storage).toBe("denied");
    expect(run(withItem("{not json")).analytics_storage).toBe("denied");
    expect(run(withItem('{"choice":"granted"}')).analytics_storage).toBe("denied");
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(run(blocked).analytics_storage).toBe("denied");
  });
});

// --------------------------------------------------------------------------- #
// consent.js, executed against a minimal DOM
// --------------------------------------------------------------------------- #
type Listener = (e: FakeEvent) => void;
interface FakeEvent {
  type: string;
  key?: string;
  target: FakeEl;
  defaultPrevented: boolean;
  preventDefault(): void;
}

class FakeEl {
  attrs = new Map<string, string>();
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  hidden = false;
  textContent = "";
  style: Record<string, any> = {
    setProperty(k: string, v: string) {
      this[k] = v;
    },
    removeProperty(k: string) {
      delete this[k];
    },
  };
  offsetHeight = 52;
  /** Viewport rect: only top/bottom matter to consent.js. */
  rect = { top: 0, bottom: 0 };
  lang = "";
  listeners: Record<string, Listener[]> = {};
  constructor(
    public doc: FakeDoc,
    public tagName: string,
  ) {}
  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  contains(c: FakeEl | null): boolean {
    for (let n = c; n; n = n.parent) if (n === this) return true;
    return false;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  appendChild(c: FakeEl) {
    return this.insertBefore(c, null);
  }
  insertBefore(c: FakeEl, ref: FakeEl | null) {
    c.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    return c;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  addEventListener(type: string, f: Listener) {
    (this.listeners[type] ??= []).push(f);
  }
  focus() {
    this.doc.activeElement = this;
  }
  closest(sel: string): FakeEl | null {
    const attr = /^\[([\w-]+)\]$/.exec(sel)![1];
    for (let n: FakeEl | null = this; n; n = n.parent) if (n.hasAttribute(attr)) return n;
    return null;
  }
  /** Dispatch a bubbling event: this element, its ancestors, then the document. */
  fire(type: string, extra: { key?: string } = {}): FakeEvent {
    const e: FakeEvent = {
      type,
      ...extra,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (let n: FakeEl | null = this; n; n = n.parent) n.listeners[type]?.forEach((f) => f(e));
    this.doc.listeners[type]?.forEach((f) => f(e));
    return e;
  }
  /** Depth-first search by tag and optional class. */
  find(tag: string, cls?: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (n: FakeEl) => {
      if (n.tagName === tag && (!cls || n.getAttribute("class") === cls)) out.push(n);
      n.children.forEach(walk);
    };
    walk(this);
    return out;
  }
}

class FakeDoc {
  listeners: Record<string, Listener[]> = {};
  documentElement: FakeEl;
  head: FakeEl;
  body: FakeEl;
  activeElement: FakeEl;
  jar = new Map<string, string>();
  cookieWrites: string[] = [];
  constructor(lang: string) {
    this.documentElement = new FakeEl(this, "html");
    this.documentElement.lang = lang;
    this.head = this.documentElement.appendChild(new FakeEl(this, "head"));
    this.body = this.documentElement.appendChild(new FakeEl(this, "body"));
    this.activeElement = this.body;
  }
  createElement(tag: string) {
    return new FakeEl(this, tag);
  }
  /** Only `[attr]` selectors, which is all consent.js asks for. */
  querySelector(sel: string): FakeEl | null {
    const attr = /^\[([\w-]+)\]$/.exec(sel)![1];
    const walk = (n: FakeEl): FakeEl | null =>
      n.hasAttribute(attr) ? n : n.children.reduce<FakeEl | null>((f, c) => f ?? walk(c), null);
    return walk(this.documentElement);
  }
  addEventListener(type: string, f: Listener) {
    (this.listeners[type] ??= []).push(f);
  }
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  set cookie(s: string) {
    this.cookieWrites.push(s);
    const [pair, ...attrs] = s.split(";").map((x) => x.trim());
    const [k, v] = pair.split("=");
    if (attrs.some((a) => a.toLowerCase() === "max-age=0")) this.jar.delete(k);
    else this.jar.set(k, v);
  }
}

interface Env {
  item?: string | null;
  lang?: string;
  blockedStorage?: boolean;
  cookies?: Record<string, string>;
  /** The app shell's fixed footer (client/index.html): 85 px tall, as on a phone. */
  footer?: boolean;
}

/** Run consent.js in a fresh page. Returns the page's window and the gtag calls. */
function runBanner(env: Env = {}) {
  const doc = new FakeDoc(env.lang ?? "en");
  let footer: FakeEl | undefined;
  if (env.footer) {
    footer = doc.body.appendChild(doc.createElement("footer"));
    footer.setAttribute("data-pp-fixed-bottom", "");
    footer.offsetHeight = 85;
    footer.rect = { top: 582, bottom: 667 };
  }
  for (const [k, v] of Object.entries(env.cookies ?? {})) doc.jar.set(k, v);
  const store = new Map<string, string>();
  if (env.item != null) store.set("pp_consent", env.item);
  const blocked = () => {
    throw new Error("SecurityError");
  };
  const calls: unknown[][] = [];
  const observers: (() => void)[] = [];
  const scrolls: number[] = [];
  const win: Record<string, any> = {
    document: doc,
    location: {
      hostname: "poker.serbito.rs",
      origin: "https://poker.serbito.rs",
      href: "https://poker.serbito.rs/#/r/ZC3THcb2yw",
      hash: "#/r/ZC3THcb2yw",
    },
    localStorage: env.blockedStorage
      ? { getItem: blocked, setItem: blocked }
      : {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, String(v)),
        },
    gtag: (...a: unknown[]) => calls.push(a),
    MutationObserver: class {
      constructor(private cb: () => void) {}
      observe() {
        observers.push(this.cb);
      }
    },
    addEventListener: () => {},
    scrollBy: (_x: number, y: number) => void scrolls.push(y),
    // The page's CSS: the footer is fixed, except while the banner is open.
    getComputedStyle: (e: FakeEl) => ({
      position:
        e === footer && !doc.documentElement.hasAttribute("data-ppc-open") ? "fixed" : "static",
    }),
  };
  win.window = win;
  runInContext(CONSENT_JS, createContext(win));
  const bar = doc.body.find("div", "ppc")[0];
  const slot = doc.body.find("div", "ppc-slot")[0];
  const button = (cls: string) => doc.body.find("button", cls)[0];
  return {
    win,
    doc,
    calls,
    store,
    scrolls,
    bar,
    slot,
    footer,
    accept: () => button("ppc-yes").fire("click"),
    decline: () => button("ppc-no").fire("click"),
    button,
    setLang: (l: string) => {
      doc.documentElement.lang = l;
      observers.forEach((cb) => cb());
    },
  };
}

const visible = (el: FakeEl | undefined) => !!el && !el.hidden;
const barText = (bar: FakeEl) => bar.find("p")[0].textContent;

describe("consent banner (client/public/consent.js)", () => {
  it("asks a new visitor, in the page's language, without taking focus", () => {
    const p = runBanner({ lang: "pt-BR" });
    expect(visible(p.bar)).toBe(true);
    expect(barText(p.bar)).toContain("Google Analytics");
    expect(barText(p.bar)).toContain(p.win.ppConsent.text.pt[0]);
    expect(p.button("ppc-yes").textContent).toBe("Aceitar");
    expect(p.button("ppc-no").textContent).toBe("Recusar");
    expect(p.bar.getAttribute("role")).toBe("region");
    expect(p.bar.getAttribute("aria-label")).toBe("Configurações de cookies");
    expect(p.bar.find("a")[0].getAttribute("href")).toBe("/privacy#cookies");
    expect(p.doc.activeElement).toBe(p.doc.body);
    expect(p.calls).toEqual([]); // no update until the visitor answers
  });

  it("goes first in <body> (reached first by keyboard), with an in-flow spacer last", () => {
    const p = runBanner();
    expect(p.doc.body.children[0]).toBe(p.bar);
    expect(p.doc.body.children.at(-1)).toBe(p.slot);
    // The spacer is as tall as the bar, so the page can scroll clear of it: the bar
    // never permanently covers the end of a guide or the room's cards on a phone.
    expect(p.slot.style.height).toBe("52px");
  });

  // SERBITO-350, WCAG 2.4.11: tabbing must never put focus fully behind the bar.
  it("while open, pads focus scrolling by the bar's height and flags <html>", () => {
    const p = runBanner();
    const html = p.doc.documentElement;
    const css = p.doc.head.find("style")[0].textContent;
    expect(css).toContain(":where(html){scroll-padding-bottom:var(--ppc-h,var(--pp-foot-h,0px))}");
    expect(html.style["--ppc-h"]).toBe("52px");
    expect(html.hasAttribute("data-ppc-open")).toBe(true); // the app shell un-fixes its footer
    p.accept();
    expect(html.style["--ppc-h"]).toBeUndefined();
    expect(html.hasAttribute("data-ppc-open")).toBe(false);
  });

  it("scrolls a focused element out from under the bar, and leaves the rest alone", () => {
    const p = runBanner();
    p.bar.rect = { top: 600, bottom: 652 };
    const el = (top: number, bottom: number) => {
      const a = p.doc.body.appendChild(p.doc.createElement("a"));
      a.rect = { top, bottom };
      return a;
    };
    el(610, 630).fire("focusin"); // fully behind the bar
    el(590, 612).fire("focusin"); // partly behind
    el(100, 120).fire("focusin"); // in the clear
    p.button("ppc-yes").fire("focusin"); // the bar's own button
    expect(p.scrolls).toEqual([38, 20]);
    p.accept();
    el(610, 630).fire("focusin"); // bar closed: nothing to clear
    expect(p.scrolls).toEqual([38, 20]);
  });

  // SERBITO-350: with the banner gone, the home page's fixed footer is what covers the
  // bottom of the viewport, so focus has to stay clear of it the same way.
  it("keeps focus clear of the page's fixed footer when there is no banner", () => {
    const p = runBanner({ item: stored("denied", 10), footer: true });
    expect(p.bar).toBeUndefined();
    const html = p.doc.documentElement;
    const css = p.doc.head.find("style")[0]?.textContent ?? "";
    expect(css).toContain(":where(html){scroll-padding-bottom:var(--ppc-h,var(--pp-foot-h,0px))}");
    expect(html.style["--pp-foot-h"]).toBe("85px");
    const el = (top: number, bottom: number) => {
      const a = p.doc.body.appendChild(p.doc.createElement("a"));
      a.rect = { top, bottom };
      return a;
    };
    el(600, 640).fire("focusin"); // fully behind the footer
    el(570, 590).fire("focusin"); // partly behind
    el(100, 120).fire("focusin"); // in the clear
    p.footer!.appendChild(p.doc.createElement("a")).fire("focusin"); // the footer's own link
    expect(p.scrolls).toEqual([66, 16]);
  });

  it("hands over between banner and footer: the one on screen is the one to clear", () => {
    const p = runBanner({ footer: true });
    const html = p.doc.documentElement;
    p.bar.rect = { top: 615, bottom: 667 };
    // Banner open: the footer is back in the flow, the bar is what covers focus.
    expect(html.style["--pp-foot-h"]).toBeUndefined();
    const a = p.doc.body.appendChild(p.doc.createElement("a"));
    a.rect = { top: 590, bottom: 610 }; // above the bar, though where the footer would be
    a.fire("focusin");
    expect(p.scrolls).toEqual([]);
    p.accept();
    // Banner closed: the footer is fixed again.
    expect(html.style["--pp-foot-h"]).toBe("85px");
    a.fire("focusin");
    expect(p.scrolls).toEqual([36]);
  });

  it("Accept: grants analytics only, stores the choice with a date, closes", () => {
    const p = runBanner();
    const before = Date.now();
    p.accept();
    expect(p.calls).toEqual([["consent", "update", { analytics_storage: "granted" }]]);
    const saved = JSON.parse(p.store.get("pp_consent")!);
    expect(saved.choice).toBe("granted");
    expect(Date.parse(saved.date)).toBeGreaterThanOrEqual(before - 1000);
    expect(visible(p.bar)).toBe(false);
    expect(visible(p.slot)).toBe(false);
  });

  it("Decline: stays denied, deletes the _ga cookies, closes", () => {
    const p = runBanner({
      cookies: { _ga: "GA1.1.1.2", _ga_B5CQC4JJV0: "GS2.1.s1", pp_other: "1" },
    });
    p.decline();
    expect(p.calls).toEqual([["consent", "update", { analytics_storage: "denied" }]]);
    expect(JSON.parse(p.store.get("pp_consent")!).choice).toBe("denied");
    expect([...p.doc.jar.keys()]).toEqual(["pp_other"]);
    // Host-only cookies (cookie_domain "none"), plus the ones older versions of the
    // site left on the registrable domain.
    expect(p.doc.cookieWrites).toContain("_ga=; Max-Age=0; path=/");
    expect(p.doc.cookieWrites).toContain("_ga=; Max-Age=0; path=/; domain=.serbito.rs");
    expect(p.doc.cookieWrites).toContain(
      "_ga_B5CQC4JJV0=; Max-Age=0; path=/; domain=.poker.serbito.rs",
    );
    expect(visible(p.bar)).toBe(false);
  });

  it("doesn't ask again within 12 months, whatever the answer was", () => {
    expect(runBanner({ item: stored("granted", 200) }).bar).toBeUndefined();
    expect(runBanner({ item: stored("denied", 364) }).bar).toBeUndefined();
  });

  it("asks again after 12 months, or when the stored value is junk", () => {
    expect(visible(runBanner({ item: stored("granted", 366) }).bar)).toBe(true);
    expect(visible(runBanner({ item: "{oops" }).bar)).toBe(true);
    expect(visible(runBanner({ item: '{"choice":"maybe","date":"2026-01-01"}' }).bar)).toBe(true);
  });

  it("'Cookie settings' reopens the banner with focus, and withdrawing deletes _ga", () => {
    const p = runBanner({ item: stored("granted", 10), cookies: { _ga: "GA1.1.1.2" } });
    const link = p.doc.body.appendChild(p.doc.createElement("a"));
    link.setAttribute("href", "/privacy#cookies");
    link.setAttribute("data-pp-consent", "");
    const text = link.appendChild(p.doc.createElement("span")); // click lands on a child
    // (Safari doesn't focus a clicked link: focus must return to the link anyway.)
    const click = text.fire("click");
    expect(click.defaultPrevented).toBe(true); // no navigation to /privacy
    const bar = p.doc.body.find("div", "ppc")[0];
    expect(visible(bar)).toBe(true);
    expect(p.doc.activeElement).toBe(p.button("ppc-yes"));
    p.decline();
    expect(p.calls).toEqual([["consent", "update", { analytics_storage: "denied" }]]);
    expect(p.doc.jar.has("_ga")).toBe(false);
    expect(visible(bar)).toBe(false);
    expect(p.doc.activeElement).toBe(link); // focus goes back where it came from
  });

  it("Escape dismisses a reopened banner without changing the choice", () => {
    const p = runBanner({ item: stored("granted", 10) });
    p.win.ppConsent.open(true);
    p.button("ppc-yes").fire("keydown", { key: "Escape" });
    expect(visible(p.doc.body.find("div", "ppc")[0])).toBe(false);
    expect(p.calls).toEqual([]);
    expect(JSON.parse(p.store.get("pp_consent")!).choice).toBe("granted");
  });

  it("ignores clicks elsewhere on the page", () => {
    const p = runBanner({ item: stored("denied", 10) });
    const other = p.doc.body.appendChild(p.doc.createElement("a"));
    expect(other.fire("click").defaultPrevented).toBe(false);
    expect(p.doc.body.find("div", "ppc")).toEqual([]);
  });

  it("follows the app's language switch (<html lang> changes after load)", () => {
    const p = runBanner({ lang: "en" });
    p.setLang("ru");
    expect(barText(p.bar)).toContain(p.win.ppConsent.text.ru[0]);
    expect(p.button("ppc-yes").textContent).toBe("Принять");
  });

  it("falls back to English for an unknown language", () => {
    const p = runBanner({ lang: "xx" });
    expect(p.button("ppc-yes").textContent).toBe("Accept");
  });

  it("works with storage blocked: asks, and the answer still applies to this page", () => {
    const p = runBanner({ blockedStorage: true });
    expect(visible(p.bar)).toBe(true);
    expect(() => p.accept()).not.toThrow();
    expect(p.calls).toEqual([["consent", "update", { analytics_storage: "granted" }]]);
  });

  it("never throws when gtag is blocked", () => {
    const p = runBanner();
    delete p.win.gtag;
    expect(() => p.accept()).not.toThrow();
  });

  it("has every string in all nine languages", () => {
    const text = runBanner().win.ppConsent.text as Record<string, string[]>;
    expect(Object.keys(text).sort()).toEqual(
      ["de", "en", "es", "fr", "ja", "pt", "ru", "sr", "zh"],
    );
    for (const [lang, strings] of Object.entries(text)) {
      expect(strings, lang).toHaveLength(5);
      for (const s of strings) expect(s.trim(), lang).not.toBe("");
    }
  });
});

// --------------------------------------------------------------------------- #
// The room funnel after Accept
// --------------------------------------------------------------------------- #
describe("room funnel after Accept", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });
  let p: ReturnType<typeof runBanner>;
  beforeEach(() => {
    p = runBanner();
    (globalThis as { window?: unknown }).window = p.win; // analytics.ts reads window.gtag
  });

  it("keeps sending the funnel events, after the consent update", () => {
    trackEvent("room_joined");
    p.accept();
    trackEvent("vote_cast", { card: "5" });
    expect(p.calls.map((c) => c.slice(0, 2))).toEqual([
      ["event", "room_joined"],
      ["consent", "update"],
      ["event", "vote_cast"],
    ]);
    expect(JSON.stringify(p.calls)).not.toContain("ZC3THcb2yw"); // still /room
  });
});
