import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// SERBITO-559: Google did not crawl three comparison pages. They had almost no links
// from the site's own pages, and on a low-authority host internal links decide what
// Google crawls first. Every English guide now links to them from its body: in the
// text with descriptive anchors, and in a "Related guides" block.

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../../client/public");
const page = (slug: string) => readFileSync(join(publicDir, slug, "index.html"), "utf-8");
/** The page's own content: <main>, without the shared header and footer links. */
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
/** Anchor texts of the links in `html` that point at /<slug>. */
const anchors = (html: string, slug: string) =>
  [...html.matchAll(new RegExp(`<a href="/${slug}">([^<]+)</a>`, "g"))].map((m) => m[1]);
const relatedOf = (html: string) => {
  const at = html.indexOf('<section id="related">');
  return at < 0 ? "" : html.slice(at, html.indexOf("</section>", at));
};

const COMPARISONS = [
  "best-planning-poker-tools",
  "planningpokeronline-alternative",
  "scrum-poker-online-without-ads",
  "planning-poker-vs-estimation-meetings",
];
const EN_GUIDES = ["what-is-planning-poker", "glossary", "planning-poker-for-jira", "planning-poker-for-remote-teams", ...COMPARISONS];
const WEAK = ["planning-poker-vs-estimation-meetings", "planningpokeronline-alternative", "scrum-poker-online-without-ads"];
const GENERIC = /^(here|click here|this page|read more|more|link|this)$/i;

describe("internal links to the comparison pages (SERBITO-559)", () => {
  it.each(WEAK)("/%s has 4 or more in-body links from other English guides", (slug) => {
    const from = EN_GUIDES.filter((g) => g !== slug && anchors(mainOf(page(g)), slug).length > 0);
    expect(from.length, from.join(", ")).toBeGreaterThanOrEqual(4);
  });

  it.each([
    ["planning-poker-for-jira", "planningpokeronline-alternative"],
    ["what-is-planning-poker", "planning-poker-vs-estimation-meetings"],
    ["planning-poker-for-remote-teams", "scrum-poker-online-without-ads"],
  ])("/%s links to /%s in its text with a descriptive anchor", (from, to) => {
    const main = mainOf(page(from));
    const text = main.slice(0, main.indexOf('<section id="related">'));
    const found = anchors(text, to);
    expect(found.length).toBeGreaterThan(0);
    for (const a of found) {
      expect(a, a).not.toMatch(GENERIC);
      expect(a.split(/\s+/).length, a).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(EN_GUIDES)("/%s has a Related guides block that links every other English guide", (slug) => {
    const related = relatedOf(page(slug));
    expect(related, "no <section id=\"related\">").not.toBe("");
    expect(related).toMatch(/<h2>Related guides<\/h2>/);
    expect(mainOf(page(slug))).toContain(related); // in the body, not in the footer
    for (const other of EN_GUIDES) {
      const found = anchors(related, other);
      if (other === slug) expect(found, "links to itself").toHaveLength(0);
      else {
        expect(found, other).toHaveLength(1);
        expect(found[0].split(/\s+/).length, found[0]).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("the 4 comparison pages link to each other from the body", () => {
    for (const from of COMPARISONS) {
      for (const to of COMPARISONS.filter((c) => c !== from)) {
        expect(anchors(mainOf(page(from)), to).length, `${from} -> ${to}`).toBeGreaterThan(0);
      }
    }
  });
});
