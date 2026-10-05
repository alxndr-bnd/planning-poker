import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EN, LANGS, t, type Lang } from "../../client/src/i18n.js";
import { TRANSLATIONS } from "../../client/src/i18n.translations.js";
import { ORIGIN, listPages, setDateModified } from "../../scripts/sitemap.js";

// SERBITO-502: scrum masters who search "planning poker online" find the home page.
// SERBITO-504: guide pages carry a real author and honest dates; /llms.txt exists.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const clientDir = join(here, "../../client");
const publicDir = join(clientDir, "public");
const APP_MODULE = join(here, "../../client/src/App.tsx");
const read = (p: string) => readFileSync(p, "utf-8");
const SHELL = read(join(clientDir, "index.html"));

/** The app as React renders it into #root (no effects run), on the real shell. */
async function renderPage({
  lang = "en",
  hash = "",
  name = "",
}: { lang?: Lang; hash?: string; name?: string } = {}): Promise<{ app: string; page: string }> {
  const store = new Map<string, string>([["pp_lang", lang]]);
  if (name) store.set("pp_name", name);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal("location", { hash, search: "", pathname: "/", origin: ORIGIN });
  // Not a literal specifier: the server's tsc (no JSX, no DOM lib) must not follow it.
  const { App } = (await import(/* @vite-ignore */ APP_MODULE)) as { App: ComponentType };
  const app = renderToStaticMarkup(createElement(App));
  return { app, page: SHELL.replace('<div id="root"></div>', `<div id="root">${app}</div>`) };
}

const h1s = (html: string) => [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("home page: one H1 (SERBITO-502)", () => {
  it("the rendered / has exactly one H1: the static landing heading", async () => {
    for (const { code } of LANGS) {
      const { app, page } = await renderPage({ lang: code });
      expect(h1s(app), code).toEqual([]); // React adds no H1 of its own...
      expect(h1s(page), code).toEqual(["Free Online Planning Poker for Agile Teams"]); // ...and keeps the static one
    }
  });

  it("a room and an invite link add no second H1 either", async () => {
    for (const opts of [{ hash: "#/r/ZC3THcb2yw" }, { hash: "#/r/ZC3THcb2yw", name: "Ana" }]) {
      const { app, page } = await renderPage(opts);
      expect(app, JSON.stringify(opts)).toContain("Planning Poker"); // the app still shows its name
      expect(h1s(page), JSON.stringify(opts)).toHaveLength(1);
    }
  });
});

describe("lobby subtitle (SERBITO-502)", () => {
  it("says 'Free online planning poker — no sign-up' above the name field", async () => {
    expect(EN["lobby.tagline"]).toBe("Free online planning poker — no sign-up");
    const { app } = await renderPage();
    const sub = app.indexOf(EN["lobby.tagline"]);
    expect(sub).toBeGreaterThan(0);
    expect(sub).toBeLessThan(app.indexOf("<input"));
  });

  it("is translated in every UI language, and names free + no sign-up", async () => {
    for (const { code } of LANGS.filter((l) => l.code !== "en")) {
      const s = TRANSLATIONS[code as Exclude<Lang, "en">]?.["lobby.tagline"];
      expect(s, code).toBeTruthy();
      expect(s, code).not.toBe(EN["lobby.tagline"]);
      expect(s, code).not.toMatch(/unlimited|ilimitad|unbegrenzt|illimit|неогранич|neograni|無制限|不限/i);
      const { app } = await renderPage({ lang: code });
      expect(app, code).toContain(t(code, "lobby.tagline"));
    }
  });
});

describe("home meta description (SERBITO-502)", () => {
  it("is at most 155 characters and names free, online, planning poker, no sign-up", () => {
    const d = SHELL.match(/<meta\s+name="description"\s+content="([^"]+)"/)?.[1];
    expect(d).toBeTruthy();
    expect(d!.length).toBeLessThanOrEqual(155);
    for (const term of ["free", "online", "planning poker", "no sign-up"]) {
      expect(d!.toLowerCase(), term).toContain(term);
    }
  });
});

const EN_GUIDES = ["what-is-planning-poker", "glossary", "planning-poker-for-jira", "planning-poker-for-remote-teams"];
const guideHtml = (slug: string) => read(join(publicDir, slug, "index.html"));
const head = (html: string) => ({
  title: html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "",
  description: html.match(/<meta\s+name="description"\s+content="([^"]+)"/)?.[1] ?? "",
  h1: h1s(html),
});
/** The page's own content: <main>, without the shared header and footer links. */
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .split(/\s+/)
    .filter((w) => /\w/.test(w)).length;

describe("/planning-poker-for-jira: its own how-to (SERBITO-502)", () => {
  const html = guideHtml("planning-poker-for-jira");
  const own = head(html);

  it("has its own H1, title and description", () => {
    expect(own.h1).toHaveLength(1);
    expect(own.h1[0]).toMatch(/Jira/);
    expect(own.title).toMatch(/Jira/);
    expect(own.description).toMatch(/Jira/);
    expect(own.description.length).toBeLessThanOrEqual(155);
    for (const other of EN_GUIDES.filter((g) => g !== "planning-poker-for-jira")) {
      const o = head(guideHtml(other));
      expect(o.title, other).not.toBe(own.title);
      expect(o.description, other).not.toBe(own.description);
      expect(o.h1[0], other).not.toBe(own.h1[0]);
    }
  });

  it("has a step-by-step how-to of 400–600 words", () => {
    const at = html.indexOf('id="how-to"');
    expect(at).toBeGreaterThan(0);
    const section = html.slice(at, html.indexOf("</section>", at));
    expect(section).toMatch(/<ol\b/);
    const n = words(section);
    expect(n).toBeGreaterThanOrEqual(400);
    expect(n).toBeLessThanOrEqual(600);
  });

  it("shows real screenshots: files exist, small, with alt text and fixed size (no CLS)", () => {
    const imgs = [...mainOf(html).matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    for (const tag of imgs) {
      const src = tag.match(/\bsrc="\/([^"]+)"/)?.[1];
      expect(src, tag).toBeTruthy();
      expect(existsSync(join(publicDir, src!)), src).toBe(true);
      expect(readFileSync(join(publicDir, src!)).byteLength, src).toBeLessThan(150 * 1024);
      expect(tag).toMatch(/\balt="[^"]{20,}"/);
      expect(tag).toMatch(/\bwidth="\d+"/);
      expect(tag).toMatch(/\bheight="\d+"/);
      expect(tag).toMatch(/\bloading="lazy"/);
    }
  });

  // SERBITO-464: the room has an item title field now. The guide names it as the UI
  // does and no longer says to read the key aloud because there is no field.
  it("describes the item title field by its UI name", () => {
    expect(mainOf(html)).not.toMatch(/paste it in as the item|paste the backlog item in|drop in your story keys/i);
    expect(mainOf(html)).not.toMatch(/has no field|out loud|read the next key/i);
    expect(mainOf(html)).toContain(`<em>${EN["room.itemLabel"]}</em>`);
    expect(mainOf(html)).toContain(`<em>${EN["room.reset"]}</em>`);
  });

  it("is linked from the body of every other English guide", () => {
    for (const other of EN_GUIDES.filter((g) => g !== "planning-poker-for-jira")) {
      expect(mainOf(guideHtml(other)), other).toMatch(/<a href="\/planning-poker-for-jira">[^<]{10,}<\/a>/);
    }
  });
});

// The 8 translations told people to paste the issue key into the room, which had no field
// for it, then to read the key aloud. SERBITO-464 added the field: they follow the English
// workflow, type the key into the room's item title field, type the points into Jira.
describe("translated Jira guides tell the truth", () => {
  const NO_FIELD: Record<string, string> = {
    es: "La sala no tiene un campo para la incidencia",
    de: "Der Raum hat kein Feld für den Vorgang",
    fr: "La salle n'a pas de champ pour le ticket",
    pt: "A sala não tem campo para a issue",
    ru: "В комнате нет поля для задачи",
    sr: "Soba nema polje za zadatak",
    ja: "ルームには課題を入れる欄がない",
    zh: "房间里没有填写事项的字段",
  };
  // The old "bring the backlog in" step, which pasted "PROJ-142 - ..." into the room.
  const OLD_STEP: Record<string, string> = {
    es: "Trae el backlog",
    de: "Den Backlog einbringen",
    fr: "Importez le backlog",
    pt: "Traga o backlog",
    ru: "Перенесите бэклог",
    sr: "Unesite backlog",
    ja: "バックログを持ち込む",
    zh: "引入待办事项",
  };

  it.each(Object.keys(NO_FIELD))("/%s/planning-poker-for-jira", (lang) => {
    const html = guideHtml(`${lang}/planning-poker-for-jira`);
    const main = mainOf(html);
    expect(main).not.toContain(NO_FIELD[lang]);
    // The field and the button carry the names the UI shows in this language.
    expect(main).toContain(`<em>${t(lang as Lang, "room.itemLabel")}</em>`);
    expect(main).toContain(`<em>${t(lang as Lang, "room.reset")}</em>`);
    expect(main).not.toContain(OLD_STEP[lang]);
    expect(main).not.toContain("PROJ-142");
    // Same shape as the English how-to: a section with the 9 steps, linked from the intro.
    const at = html.indexOf('<section id="how-to">');
    expect(at).toBeGreaterThan(0);
    const section = html.slice(at, html.indexOf("</section>", at));
    expect(section.match(/<li>/g)).toHaveLength(9);
    expect(main.slice(0, main.indexOf("<h2>"))).toContain('<a href="#how-to">');
    // The app links stay in the page's language.
    expect(section).toContain(`<a href="https://poker.serbito.rs/?lang=${lang}">`);
    expect(section).toContain(`<a href="/${lang}/what-is-planning-poker">`);
    // English UI screenshots do not belong on a translated page.
    expect(main).not.toMatch(/<img\b/);
  });
});

// --------------------------------------------------------------------------- #
// SERBITO-504: Article JSON-LD names a real person and the page's real date.
// --------------------------------------------------------------------------- #
const sitemapXml = read(join(publicDir, "sitemap.xml"));
const lastmodOf = (loc: string) =>
  sitemapXml.match(new RegExp(`<loc>${loc.replace(/[.?]/g, "\\$&")}</loc>\\s*<lastmod>([^<]+)</lastmod>`))?.[1];
const articles = listPages(clientDir)
  .map((p) => ({ ...p, html: read(p.file) }))
  .map((p) => ({
    ...p,
    article: [...p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]))
      .find((j) => j["@type"] === "Article"),
  }))
  .filter((p) => p.article);

describe("guide Article JSON-LD (SERBITO-504)", () => {
  it("covers the prose guides in every language", () => {
    expect(articles.length).toBe(27); // 3 prose topics x 9 languages
  });

  it("names the owner as a Person author, with the GitHub profile", () => {
    for (const { loc, article } of articles) {
      expect(article.author, loc).toEqual({
        "@type": "Person",
        name: "Alexander Bondarchuk",
        url: "https://github.com/alxndr-bnd",
        sameAs: ["https://github.com/alxndr-bnd"],
      });
      expect(article.publisher["@type"], loc).toBe("Organization");
    }
  });

  it("dateModified is the sitemap lastmod (the page's git date), never before datePublished", () => {
    for (const { loc, article } of articles) {
      expect(article.dateModified, `${loc}: stale — run \`npm run sitemap\``).toBe(lastmodOf(loc));
      expect(article.dateModified >= article.datePublished, loc).toBe(true);
    }
  });

  it("setDateModified rewrites only the Article date", () => {
    const html = '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-06-21","dateModified":"2026-07-06"}</script>';
    expect(setDateModified(html, "2026-10-05")).toBe(html.replace("2026-07-06", "2026-10-05"));
    expect(setDateModified("<p>no schema</p>", "2026-10-05")).toBe("<p>no schema</p>");
  });
});

describe("/llms.txt (SERBITO-504)", () => {
  const file = join(publicDir, "llms.txt");
  const txt = existsSync(file) ? read(file) : "";

  it("is a short llmstxt.org file: title, summary, key URLs", () => {
    expect(txt).toMatch(/^# Planning Poker\n\n> /);
    expect(txt).not.toContain("<");
    expect(txt.endsWith("\n")).toBe(true);
    expect(txt.split("\n").length).toBeLessThan(40);
    for (const url of [`${ORIGIN}/`, ...EN_GUIDES.map((g) => `${ORIGIN}/${g}`), "https://github.com/alxndr-bnd/planning-poker"]) {
      expect(txt, url).toContain(`](${url})`);
    }
  });
});
