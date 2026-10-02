import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// SERBITO-355 (5b): "Создать комнату" on a Russian guide opened the app in English.
// Every link from a /<lang>/ guide to the app carries ?lang=<lang>, which the app
// takes as the UI language (client/src/i18n.ts getInitialLang).

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../../client/public");
const LANG_DIRS = readdirSync(publicDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^[a-z]{2}$/.test(e.name))
  .map((e) => e.name);

/** hrefs of the <a> links on a page that point at the app (the site root). */
const appLinks = (html: string) =>
  [...html.matchAll(/<a\b[^>]*\bhref="(https:\/\/poker\.serbito\.rs\/(?:\?[^"#]*)?)"/g)].map((m) => m[1]);

describe("guide links to the app", () => {
  it("covers the 8 guide languages", () => {
    expect(LANG_DIRS.sort()).toEqual(["de", "es", "fr", "ja", "pt", "ru", "sr", "zh"]);
  });

  for (const lang of LANG_DIRS) {
    it(`/${lang}/ guides open the app in ${lang}`, () => {
      for (const topic of readdirSync(join(publicDir, lang))) {
        const html = readFileSync(join(publicDir, lang, topic, "index.html"), "utf-8");
        const links = appLinks(html);
        expect(links.length, `${lang}/${topic}`).toBeGreaterThan(0);
        for (const href of links) expect(href, `${lang}/${topic}`).toBe(`https://poker.serbito.rs/?lang=${lang}`);
      }
    });
  }
});
