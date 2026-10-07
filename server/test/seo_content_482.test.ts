import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIBONACCI_DECK } from "@pp/shared";
import { Room } from "../src/room.js";
import { ORIGIN, faqPairs, listPages } from "../../scripts/sitemap.js";

// SERBITO-482: finish the SEO roadmap content.
// 1. Every guide answers common questions as plain HTML Q&A: a question-style <h3> and a
//    short direct answer. The same Q&A is in FAQPage JSON-LD, word for word: Google shows
//    no FAQ rich result for this site, but Bing and AI answer engines read the markup.
//    scripts/sitemap.ts writes it from the visible FAQ (`npm run sitemap`).
// 2. Comparison pages for comparison-intent searches. English only (the 2026-10-05 audit:
//    no new translations until the English pages are indexed). Every competitor fact is
//    dated and has a source link to the competitor's own page.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const clientDir = join(here, "../../client");
const publicDir = join(clientDir, "public");
const read = (p: string) => readFileSync(p, "utf-8");
const page = (path: string) => read(join(publicDir, path, "index.html"));
const LANGS = ["", "es/", "de/", "fr/", "pt/", "ru/", "sr/", "ja/", "zh/"];

const section = (html: string, id: string) => {
  const at = html.indexOf(`<section id="${id}">`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</section>", at));
};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const attr = (html: string, re: RegExp) => html.match(re)?.[1] ?? "";
const schemas = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const words = (s: string) => s.split(/\s+/).filter((w) => /\w/.test(w)).length;
/** Short for CJK, where words have no spaces: count characters instead. */
const short = (lang: string, answer: string) =>
  lang === "ja/" || lang === "zh/" ? answer.length <= 160 : words(answer) <= 60;

// --------------------------------------------------------------------------- #
// 1. FAQ sections
// --------------------------------------------------------------------------- #
const FAQ_TOPICS = ["what-is-planning-poker", "planning-poker-for-jira", "planning-poker-for-remote-teams", "glossary"];

describe("guide FAQ: question headings with short answers (SERBITO-482)", () => {
  for (const topic of FAQ_TOPICS) {
    it.each(LANGS)(`/%s${topic}`, (lang) => {
      const html = page(lang + topic);
      const faq = section(html, "faq");
      expect(faq, "no <section id=\"faq\">").not.toBe("");
      expect(faq).toMatch(/^<section id="faq">\s*<h2>[^<]+<\/h2>/);
      expect(faq).not.toMatch(/<dl\b/);
      const pairs = [...faq.matchAll(/<h3>([\s\S]+?)<\/h3>\s*<p>([\s\S]+?)<\/p>/g)];
      expect(pairs.length).toBeGreaterThanOrEqual(4);
      expect(faq.match(/<h3>/g)).toHaveLength(pairs.length); // every question has an answer
      for (const [, q, a] of pairs) {
        expect(text(q), q).toMatch(/[?？]$/);
        expect(short(lang, text(a)), a).toBe(true);
      }
      // A question heading needs a matching style; the old dt/dd rules styled the old FAQ.
      expect(html).toMatch(/main\.page h3\{[^}]+\}/);
    });
  }

  it("every page with a visible FAQ has FAQPage JSON-LD with the same text (run `npm run sitemap`)", () => {
    for (const { loc, file } of listPages(clientDir)) {
      if (loc === `${ORIGIN}/`) continue; // the home page keeps its own hand-written block
      const html = read(file);
      const lang = attr(html, /<html lang="([^"]+)"/);
      const blocks = schemas(html).filter((s) => s["@type"] === "FAQPage");
      const visible = faqPairs(html);
      if (!visible.length) {
        expect(blocks, loc).toHaveLength(0);
        continue;
      }
      expect(blocks, loc).toHaveLength(1);
      expect(blocks[0].inLanguage, loc).toBe(lang);
      const marked = blocks[0].mainEntity.map((q: any) => ({ question: q.name, answer: q.acceptedAnswer.text }));
      expect(marked, loc).toEqual(visible);
    }
  });

  it("all 36 guides (4 topics x 9 languages) carry FAQPage JSON-LD", () => {
    const pages = FAQ_TOPICS.flatMap((t) => LANGS.map((l) => page(l + t)));
    expect(pages).toHaveLength(36);
    for (const html of pages) expect(schemas(html).some((s) => s["@type"] === "FAQPage")).toBe(true);
  });
});

// --------------------------------------------------------------------------- #
// 2. Comparison pages
// --------------------------------------------------------------------------- #
const COMPARISONS = [
  "best-planning-poker-tools",
  "planning-poker-vs-estimation-meetings",
  "planningpokeronline-alternative",
  "scrum-poker-online-without-ads",
];

/** Competitor facts each page states, and the official page that backs each one. */
const FACTS: Record<string, { fact: RegExp; source: string }[]> = {
  "best-planning-poker-tools": [
    { fact: /\$30 per facilitator per month/, source: "https://planningpokeronline.com/pricing/" },
    { fact: /9 votings per game/, source: "https://planningpokeronline.com/pricing/" },
    { fact: /40 USD a year/, source: "https://www.scrumpoker-online.org/en/" },
    { fact: /sustained by unobtrusive ads/, source: "https://www.pointingpoker.com/" },
  ],
  "planningpokeronline-alternative": [
    { fact: /\$30 per facilitator per month/, source: "https://planningpokeronline.com/pricing/" },
    { fact: /\$300 billed yearly/, source: "https://planningpokeronline.com/pricing/" },
    { fact: /9 votings per game/, source: "https://planningpokeronline.com/pricing/" },
    { fact: /5 issues voted per game/, source: "https://planningpokeronline.com/pricing/" },
    { fact: /6 weeks/, source: "https://planningpokeronline.com/pricing/" },
  ],
  "scrum-poker-online-without-ads": [
    { fact: /40 USD a year/, source: "https://www.scrumpoker-online.org/en/" },
    { fact: /sustained by unobtrusive ads/, source: "https://www.pointingpoker.com/" },
  ],
  "planning-poker-vs-estimation-meetings": [],
};

const head = (html: string) => html.slice(0, html.indexOf("</head>"));
/** Row label -> our cell, from every table whose first data column is this app. */
const ourColumn = (html: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [table] of html.matchAll(/<table>[\s\S]*?<\/table>/g)) {
    const cols = [...(table.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "").matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    if (cols[1] !== "Serbito Planning Poker") continue;
    for (const [, label, cell] of table.matchAll(/<tr><th scope="row">([^<]+)<\/th><td>([\s\S]*?)<\/td>/g)) {
      out[label] = text(cell);
    }
  }
  return out;
};

describe("comparison pages (SERBITO-482)", () => {
  it.each(COMPARISONS)("/%s: SEO head", (slug) => {
    const file = join(publicDir, slug, "index.html");
    expect(existsSync(file), file).toBe(true);
    const html = read(file);
    const url = `${ORIGIN}/${slug}`;
    expect(html).toMatch(/^<!doctype html>\s*<html lang="en">/);
    const title = attr(html, /<title>([^<]+)<\/title>/);
    expect(title.length, title).toBeGreaterThan(20);
    expect(title.length, title).toBeLessThanOrEqual(60);
    const description = attr(html, /<meta\s+name="description"\s+content="([^"]+)"/);
    expect(description.length, description).toBeGreaterThan(70);
    expect(description.length, description).toBeLessThanOrEqual(155);
    expect(html).toContain(`<link rel="canonical" href="${url}" />`);
    expect(html).toMatch(/<meta name="robots" content="index, follow" \/>/);
    // English only: hreflang names this page and x-default, never a missing translation.
    const alternates = [...head(html).matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g)].map(
      ([, l, h]) => `${l} ${h}`,
    );
    expect(alternates).toEqual([`en ${url}`, `x-default ${url}`]);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const schema = schemas(html);
    const faq = faqPairs(html).length ? ["FAQPage"] : [];
    expect(schema.map((s) => s["@type"]).sort()).toEqual(["Article", "BreadcrumbList", ...faq].sort());
    const article = schema.find((s) => s["@type"] === "Article");
    expect(article.inLanguage).toBe("en");
    expect(article.mainEntityOfPage["@id"]).toBe(url);
  });

  it.each(COMPARISONS)("/%s: titles differ from every other page", (slug) => {
    const own = attr(page(slug), /<title>([^<]+)<\/title>/);
    for (const { loc, file } of listPages(clientDir)) {
      if (loc === `${ORIGIN}/${slug}`) continue;
      expect(attr(read(file), /<title>([^<]+)<\/title>/), loc).not.toBe(own);
    }
  });

  it.each(COMPARISONS)("/%s: dated, with sources for every competitor fact", (slug) => {
    const html = page(slug);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).toMatch(/as of October 2026|checked on 2026-10-05/i);
    const sources = section(html, "sources");
    for (const { fact, source } of FACTS[slug]) {
      expect(text(main), String(fact)).toMatch(fact);
      expect(sources, source).toContain(`href="${source}"`);
    }
    if (FACTS[slug].length) {
      // Brand names are used only to name the products compared, never as ours.
      expect(main).toMatch(/not affiliated/i);
    }
  });

  // Only what the app really does (README, shared/protocol.ts, server/src/room.ts). Our
  // column in each comparison table is checked row by row against the code.
  it.each(COMPARISONS)("/%s: claims about this app match the code", (slug) => {
    const html = page(slug);
    const main = text(html.slice(html.indexOf("<main"), html.indexOf("</main>")));
    const ours = ourColumn(html);
    const expected: [RegExp, RegExp][] = [
      [/^Price$/, /^Free, no paid plan$/],
      [/^Ads$/, /^None$/],
      [/^Account to start$/, /^No, a name only$/],
      [/^Card decks$/, /^Fibonacci only\b/],
      [/^Average and median$/, /^No\b/],
      [/^(Jira|Integrations)$/, /^(No|None)\b/],
      [/^Saved (history|games and history)$/, /^No\b/],
    ];
    if (slug === "best-planning-poker-tools" || slug === "planningpokeronline-alternative") {
      expect(Object.keys(ours).length, "our column not found").toBeGreaterThanOrEqual(8);
    }
    for (const [label, cell] of Object.entries(ours)) {
      const rule = expected.find(([l]) => l.test(label));
      if (rule) expect(cell, `${slug}: ${label}`).toMatch(rule[1]);
    }
    // The deck the pages describe is the real one: 1 to 55, "More" up to 610, ? and coffee.
    if (/1 to 55, more up to 610/.test(main)) {
      expect(FIBONACCI_DECK.slice(0, 9)).toEqual(["1", "2", "3", "5", "8", "13", "21", "34", "55"]);
      expect(FIBONACCI_DECK).toContain("610");
    }
    // A room holds at most Room.MAX_PARTICIPANTS people, so nothing promises more.
    for (const [, n] of main.matchAll(/up to (\d+) people/g)) expect(Number(n)).toBe(Room.MAX_PARTICIPANTS);
    expect(main).not.toMatch(/unlimited (?:players|participants|people)/i);
    // The site has analytics: a page that says "no ads" must not suggest "no tracking".
    expect(main).not.toMatch(/\b(?:no|without) (?:tracking|cookies)\b/i);
    if (/\bno ads\b/i.test(main)) expect(html).toContain('<a href="/privacy">');
  });

  it("are linked from the home page and from every English guide footer", () => {
    const home = read(join(clientDir, "index.html"));
    for (const slug of COMPARISONS) expect(home, slug).toContain(`<a href="/${slug}">`);
    for (const slug of ["what-is-planning-poker", "glossary", "planning-poker-for-jira", "planning-poker-for-remote-teams", ...COMPARISONS]) {
      const html = page(slug);
      const footer = html.slice(html.lastIndexOf("<footer"), html.lastIndexOf("</footer>"));
      expect(footer, slug).toContain('<a href="/best-planning-poker-tools">');
    }
  });

  it("the tools overview links to the other three comparison pages", () => {
    const main = page("best-planning-poker-tools");
    for (const slug of COMPARISONS.slice(1)) expect(main, slug).toContain(`<a href="/${slug}">`);
  });

  it("are listed in /llms.txt", () => {
    const txt = read(join(publicDir, "llms.txt"));
    for (const slug of COMPARISONS) expect(txt, slug).toContain(`](${ORIGIN}/${slug})`);
  });
});

// The home page roadmap invited votes on median and more languages: one is dropped
// (SERBITO-355), the other shipped. Voters must see only open candidates.
describe("home page roadmap text (SERBITO-482)", () => {
  it("does not ask for votes on dropped or shipped features", () => {
    const home = read(join(clientDir, "index.html"));
    const at = home.indexOf("Help shape the roadmap");
    expect(at).toBeGreaterThan(0);
    const block = home.slice(at, home.indexOf("</p>", at));
    expect(block).not.toMatch(/median|more languages/i);
  });
});
