// Cookie consent banner (SERBITO-320). ONE file for every page: the app shell
// (client/index.html) and every prerendered guide under client/public, loaded with
// <script defer src="/consent.js">. Plain script, no build step, so the guides stay
// static HTML.
//
// Split of work with the page:
// - Each page's <head> sets the Consent Mode v2 DEFAULT inline, before gtag "config":
//   everything denied, except analytics_storage when the visitor accepted within the
//   last 12 months. It has to be inline: it must run before the tag, synchronously.
// - This script shows the banner when there is no valid stored choice, stores the
//   answer (pp_consent: choice + date), sends the consent UPDATE, and reopens the
//   banner from any footer link carrying `data-pp-consent`.
//
// Accept grants analytics_storage only: the site has no ads, and the banner asks about
// statistics, so the ad_* signals stay denied. Decline (also later, from the footer
// link) deletes the _ga* cookies. Unit tested in server/test/consent.test.ts.
(function () {
  "use strict";

  var KEY = "pp_consent";
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // re-ask after 12 months (as the <head> snippet)

  // [question, accept, decline, "cookie settings" (also the banner's label), privacy link]
  var TEXT = {
    en: ["May we use Google Analytics cookies to see how the site is used?", "Accept", "Decline", "Cookie settings", "Privacy"],
    es: ["¿Podemos usar cookies de Google Analytics para ver cómo se usa el sitio?", "Aceptar", "Rechazar", "Configuración de cookies", "Privacidad"],
    de: ["Dürfen wir Google-Analytics-Cookies verwenden, um zu sehen, wie die Website genutzt wird?", "Akzeptieren", "Ablehnen", "Cookie-Einstellungen", "Datenschutz"],
    fr: ["Pouvons-nous utiliser les cookies de Google Analytics pour voir comment le site est utilisé ?", "Accepter", "Refuser", "Paramètres des cookies", "Confidentialité"],
    pt: ["Podemos usar cookies do Google Analytics para ver como o site é usado?", "Aceitar", "Recusar", "Configurações de cookies", "Privacidade"],
    ru: ["Можно использовать cookie Google Analytics, чтобы видеть, как используется сайт?", "Принять", "Отклонить", "Настройки cookie", "Конфиденциальность"],
    sr: ["Da li smemo da koristimo Google Analytics kolačiće da bismo videli kako se sajt koristi?", "Prihvati", "Odbij", "Podešavanja kolačića", "Privatnost"],
    ja: ["サイトの利用状況を把握するために Google アナリティクスの Cookie を使用してもよろしいですか？", "同意する", "拒否する", "Cookie 設定", "プライバシー"],
    zh: ["我们可以使用 Google Analytics Cookie 来了解网站的使用情况吗？", "接受", "拒绝", "Cookie 设置", "隐私"],
  };

  var CSS =
    ".ppc-slot[hidden],.ppc[hidden]{display:none}" +
    // Focus scrolling stops above whatever covers the bottom of the viewport (WCAG
    // 2.4.11): the bar while open (--ppc-h, set by fit()), else the page's own fixed
    // footer (--pp-foot-h, set by dock()). :where() keeps it overridable by the page.
    ":where(html){scroll-padding-bottom:var(--ppc-h,var(--pp-foot-h,0px))}" +
    ".ppc{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.4rem .75rem;padding:.55rem 1rem;background:#15603b;color:#fff;font:.85rem/1.4 system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif;box-shadow:0 -2px 8px rgba(0,0,0,.2);text-align:center}" +
    ".ppc p{margin:0}" +
    ".ppc a{color:#fff;text-decoration:underline}" +
    ".ppc .ppc-b{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.5rem .75rem}" +
    // Accept and Decline carry equal weight: one style for both, in two equal grid
    // columns, so they are the same size whatever the language; on a narrow screen
    // the Privacy link wraps rather than squeezing one button (SERBITO-350).
    ".ppc .ppc-yn{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}" +
    ".ppc button{font:inherit;font-weight:600;min-height:2.25rem;padding:.3rem 1rem;border:1px solid #fff;border-radius:6px;background:#fff;color:#15603b;cursor:pointer}" +
    ".ppc button:hover{background:#e3f1e8}" +
    ".ppc a:focus-visible,.ppc button:focus-visible{outline:2px solid #ffd54a;outline-offset:2px}" +
    // Phones: about as tall as the app's own fixed footer, which the bar covers.
    "@media (max-width:600px){.ppc{font-size:.8rem;gap:.3rem;padding:.4rem .75rem}.ppc button{min-height:2rem;padding:.2rem .9rem}}";

  var w = window;
  var d = document;
  var slot; // in-flow spacer at the end of <body>, as tall as the bar: the page can always
  // scroll clear of the bar, so it never hides the end of a page or the room controls
  var bar;
  var parts; // the elements that carry text: [question, accept, decline, privacy link]
  var returnFocus = null;
  // The page's own bottom-fixed chrome, if it has any: the app shell's footer
  // (client/index.html) marks itself with data-pp-fixed-bottom.
  var foot = d.querySelector ? d.querySelector("[data-pp-fixed-bottom]") : null;

  /** The stored choice ("granted" | "denied") if made within 12 months, else null. */
  function stored() {
    try {
      var c = JSON.parse(w.localStorage.getItem(KEY));
      if (c && (c.choice === "granted" || c.choice === "denied") && Date.now() - Date.parse(c.date) < MAX_AGE_MS) {
        return c.choice;
      }
    } catch (e) {
      /* storage blocked or corrupt: ask again */
    }
    return null;
  }

  function gtag() {
    try {
      if (typeof w.gtag === "function") w.gtag.apply(w, arguments);
    } catch (e) {
      /* analytics must never break the page */
    }
  }

  /**
   * Delete the GA cookies (_ga, _ga_<id>). Every page configures GA with cookie_domain
   * "none" (host-only cookies); the parent domains are cleared too, for cookies an
   * earlier version of the site set on .serbito.rs.
   */
  function clearGaCookies() {
    var names = d.cookie.split(";").map(function (c) {
      return c.split("=")[0].trim();
    });
    var host = w.location.hostname.split(".");
    names.forEach(function (name) {
      if (name.indexOf("_ga") !== 0) return;
      var gone = name + "=; Max-Age=0; path=/";
      d.cookie = gone;
      for (var i = 0; i < host.length - 1; i++) d.cookie = gone + "; domain=." + host.slice(i).join(".");
    });
  }

  function lang() {
    var l = String(d.documentElement.lang || "en").slice(0, 2).toLowerCase();
    return TEXT[l] ? l : "en";
  }

  function el(tag, attrs, parent) {
    var e = d.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function fill() {
    var t = TEXT[lang()];
    bar.setAttribute("aria-label", t[3]);
    parts[0].textContent = t[0];
    parts[1].textContent = t[1];
    parts[2].textContent = t[2];
    parts[3].textContent = t[4];
    fit();
  }

  function fit() {
    if (!slot || bar.hidden) return;
    var h = bar.offsetHeight + "px";
    slot.style.height = h;
    d.documentElement.style.setProperty("--ppc-h", h);
  }

  /** Whether the page's footer is currently fixed (the page un-fixes it under the bar). */
  function footFixed() {
    return !!foot && !!w.getComputedStyle && w.getComputedStyle(foot).position === "fixed";
  }

  /** The element covering the bottom of the viewport: the open bar, else a fixed footer. */
  function cover() {
    if (bar && !bar.hidden) return bar;
    return footFixed() ? foot : null;
  }

  /** Publish the fixed footer's height as --pp-foot-h (scroll padding, page spacing). */
  function dock() {
    var h = footFixed() ? foot.offsetHeight : 0;
    if (h) d.documentElement.style.setProperty("--pp-foot-h", h + "px");
    else d.documentElement.style.removeProperty("--pp-foot-h");
  }

  /**
   * Focus must never end up behind the bar or a fixed footer (WCAG 2.4.11).
   * scroll-padding covers browsers that honour it for focus scrolling, but not an
   * element that is already "in view" behind the cover; this covers the rest: once the
   * browser has scrolled, if the focused element still reaches under, scroll it clear.
   */
  function reveal(e) {
    var t = e.target;
    var c = cover();
    if (!c || !t || !t.getBoundingClientRect || c.contains(t)) return;
    var raf = w.requestAnimationFrame || function (f) { f(); };
    raf(function () {
      if (cover() !== c) return;
      var under = t.getBoundingClientRect().bottom - c.getBoundingClientRect().top;
      if (under > 0) w.scrollBy(0, under + 8);
    });
  }

  function build() {
    // The bar goes first in <body>, so keyboard and screen-reader users meet it first;
    // it is fixed, so where it sits in the DOM moves nothing on screen (no layout shift).
    bar = el("div", { class: "ppc", role: "region" });
    d.body.insertBefore(bar, d.body.firstChild);
    slot = el("div", { class: "ppc-slot" }, d.body);
    var q = el("p", {}, bar);
    var row = el("div", { class: "ppc-b" }, bar);
    var pair = el("div", { class: "ppc-yn" }, row);
    var yes = el("button", { type: "button", class: "ppc-yes" }, pair);
    var no = el("button", { type: "button", class: "ppc-no" }, pair);
    var link = el("a", { href: "/privacy#cookies", hreflang: "en" }, row);
    yes.addEventListener("click", function () {
      choose("granted");
    });
    no.addEventListener("click", function () {
      choose("denied");
    });
    bar.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && returnFocus) close(); // only a reopened banner: dismiss, keep the choice
    });
    parts = [q, yes, no, link];
    // The app shell sets <html lang> after this script has run (React effect), and on
    // every language switch: follow it.
    if (w.MutationObserver) {
      new w.MutationObserver(fill).observe(d.documentElement, { attributes: true, attributeFilter: ["lang"] });
    }
    w.addEventListener("resize", fit);
  }

  /**
   * Show the banner. `focus`: opened on request (footer link) — move focus into it, and
   * back to `from` (default: the focused element) when it closes.
   */
  function open(focus, from) {
    if (!bar) build();
    slot.hidden = false;
    bar.hidden = false;
    // Lets the page move its own bottom-fixed chrome out of the bar's way (the app
    // shell's footer goes back into the flow: client/index.html).
    d.documentElement.setAttribute("data-ppc-open", "");
    if (foot) dock();
    fill();
    if (focus) {
      returnFocus = from || d.activeElement || null;
      parts[1].focus();
    }
  }

  function close() {
    if (!bar) return;
    bar.hidden = true;
    slot.hidden = true;
    d.documentElement.removeAttribute("data-ppc-open");
    d.documentElement.style.removeProperty("--ppc-h");
    if (foot) dock(); // the footer is fixed again: its height is the scroll padding now
    if (returnFocus && returnFocus.focus) returnFocus.focus();
    // Never leave focus on a hidden button (e.g. it had nowhere to return to).
    var a = d.activeElement;
    if (a && a.blur && bar.contains && bar.contains(a)) a.blur();
    returnFocus = null;
  }

  function choose(choice) {
    try {
      w.localStorage.setItem(KEY, JSON.stringify({ choice: choice, date: new Date().toISOString() }));
    } catch (e) {
      /* not stored: the banner comes back on the next page, the choice still applies here */
    }
    gtag("consent", "update", { analytics_storage: choice });
    if (choice === "denied") clearGaCookies();
    close();
  }

  // Footer "Cookie settings" links. Their href (/privacy#cookies) is the no-JS fallback.
  d.addEventListener("click", function (e) {
    var t = e.target;
    var link = t && t.closest ? t.closest("[data-pp-consent]") : null;
    if (!link) return;
    e.preventDefault();
    open(true, link);
  });

  w.ppConsent = { open: open, stored: stored, text: TEXT };

  // Always on, banner or not: the scroll padding and the focus check also keep focus
  // clear of the page's fixed footer.
  el("style", {}, d.head).textContent = CSS;
  d.addEventListener("focusin", reveal);
  if (foot) {
    dock();
    if (w.ResizeObserver) new w.ResizeObserver(dock).observe(foot);
    else w.addEventListener("resize", dock);
  }

  if (!stored()) open(false);
})();
