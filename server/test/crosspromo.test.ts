import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Client module — tested here so it runs in the existing vitest gate.
import {
  CROSSPROMO_MARKER,
  CROSSPROMO_UTM,
  MADE_BY,
  OTHER_PROJECTS,
  injectCrossPromo,
  pageLang,
  renderCrossPromo,
} from "../../client/src/crosspromo.js";
import { LANGS, t } from "../../client/src/i18n.js";

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const clientDir = join(here, "../../client"); // planning-poker/client

// index.html + the 36 prerendered guide pages (9 languages x 4 guides).
const PAGES = [
  join(clientDir, "index.html"),
  ...["", "ru/", "de/", "es/", "fr/", "ja/", "pt/", "sr/", "zh/"].flatMap((p) =>
    [
      "glossary",
      "what-is-planning-poker",
      "planning-poker-for-jira",
      "planning-poker-for-remote-teams",
    ].map((g) => join(clientDir, "public", p + g, "index.html")),
  ),
];

const hrefs = (html: string) =>
  [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe('"Other projects" cross-promo block (SERBITO-264)', () => {
  it("lists GTD, Javi and Serbito plus the No Handoff credit, every link with the footer UTM", () => {
    const html = renderCrossPromo("en");
    expect(hrefs(html)).toEqual([
      `https://gtd.serbito.rs/?${CROSSPROMO_UTM}`,
      `https://javi.serbito.rs/?${CROSSPROMO_UTM}`,
      `https://serbito.rs/?${CROSSPROMO_UTM}`,
      `https://www.linkedin.com/company/nohandoff/?${CROSSPROMO_UTM}`,
    ]);
    expect(CROSSPROMO_UTM).toBe("utm_source=poker&utm_medium=crosspromo&utm_campaign=footer");
    expect(html).toContain("Other projects:");
    expect(html).toContain("GTD</a> — Free GTD task manager with a Telegram bot");
    expect(html).toContain("Javi</a> — Delivery notifications for small businesses in Serbia");
    expect(html).toContain("Serbito</a> — Classifieds in Serbia");
    expect(html).toContain(`Made by <a href="${MADE_BY.url}?`);
    expect(html).toContain(">No Handoff</a>");
  });

  it("is plain static markup: no script, no inline handlers, ampersands escaped", () => {
    for (const { code } of LANGS) {
      const html = renderCrossPromo(code);
      expect(html).not.toMatch(/<script|\son\w+=|javascript:/i);
      expect(html).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/); // no raw & in the markup
      expect(hrefs(html)).toHaveLength(OTHER_PROJECTS.length + 1);
    }
  });

  it("translates the labels and keeps the credit name in every language", () => {
    for (const { code } of LANGS) {
      const html = renderCrossPromo(code);
      expect(html).toContain(`${t(code, "crosspromo.title")}:`);
      expect(html).toContain(t(code, "crosspromo.serbito"));
      expect(html).toContain(">No Handoff</a>");
      expect(html).not.toContain("{name}");
    }
    expect(renderCrossPromo("ru")).toContain("Другие проекты");
  });

  it("reads the page language from <html lang>, including region/script subtags", () => {
    expect(pageLang('<html lang="pt-BR">')).toBe("pt");
    expect(pageLang('<html lang="sr-Latn">')).toBe("sr");
    expect(pageLang('<html lang="zh-Hans">')).toBe("zh");
    expect(pageLang('<html lang="en">')).toBe("en");
    expect(pageLang("<html>")).toBe("en");
    expect(pageLang('<html lang="xx">')).toBe("en");
  });

  it("every public page carries exactly one marker, and the build fills it in the page's language", () => {
    for (const page of PAGES) {
      const src = readFileSync(page, "utf-8");
      expect(src.split(CROSSPROMO_MARKER).length - 1, `${page} marker count`).toBe(1);
      const out = injectCrossPromo(src);
      expect(out, page).not.toContain(CROSSPROMO_MARKER);
      expect(out, page).toContain(renderCrossPromo(pageLang(src)));
      for (const p of OTHER_PROJECTS) {
        expect(out, `${page} -> ${p.name}`).toContain(
          `href="${p.url}?${CROSSPROMO_UTM.replace(/&/g, "&amp;")}"`,
        );
      }
    }
  });

  it("leaves the SEO head untouched: only the marker changes", () => {
    for (const page of PAGES) {
      const src = readFileSync(page, "utf-8");
      const out = injectCrossPromo(src);
      const head = (h: string) => h.slice(0, h.indexOf("</head>"));
      expect(head(out), page).toBe(head(src));
      expect(out.replace(renderCrossPromo(pageLang(src)), CROSSPROMO_MARKER)).toBe(src);
    }
  });

  it("sits in a footer on guide pages and outside #root (after it) on the home page", () => {
    const home = readFileSync(join(clientDir, "index.html"), "utf-8");
    const root = home.indexOf('<div id="root">');
    const marker = home.indexOf(CROSSPROMO_MARKER);
    expect(marker).toBeGreaterThan(home.indexOf("</main>", root)); // not replaced on mount
    expect(marker).toBeLessThan(home.indexOf("<footer"));
    for (const page of PAGES.slice(1)) {
      const html = readFileSync(page, "utf-8");
      const footer = html.slice(html.indexOf('<footer class="site">'), html.indexOf("</footer>"));
      expect(footer, page).toContain(CROSSPROMO_MARKER);
    }
  });

  it("does nothing to a page without the marker", () => {
    const html = "<!doctype html><html lang=\"en\"><body>app</body></html>";
    expect(injectCrossPromo(html)).toBe(html);
  });
});
