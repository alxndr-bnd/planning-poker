// Generates client/public/sitemap.xml from the pages that actually exist (SERBITO-305):
// the home page (client/index.html) plus every client/public/**/index.html, served at
// its clean URL. <lastmod> is the date of the page file's last git commit (today for a
// page with uncommitted changes), and each URL carries the hreflang alternates the page
// itself declares, so the sitemap can't drift from the pages.
//
// The generated file is committed: the Docker build has no git history (.git is
// dockerignored, the slim image has no git), so the image ships the committed copy and
// `npm run build` only regenerates it where full history exists. server/test/seo.test.ts
// fails if the committed file is stale — fix with `npm run sitemap`.
//
// The same git date is each guide's Article JSON-LD "dateModified" (SERBITO-504): the
// script rewrites it first, so the page and the sitemap never disagree.
//
// It also writes each guide's FAQPage JSON-LD from its visible FAQ (SERBITO-482).
//
// Usage:  node scripts/sitemap.ts            regenerate (fails without git history)
//         node scripts/sitemap.ts --if-git   regenerate, or keep the committed file
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ORIGIN = "https://poker.serbito.rs";
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CLIENT_DIR = join(REPO_ROOT, "client");
export const SITEMAP_PATH = join(CLIENT_DIR, "public", "sitemap.xml");

export interface Page {
  /** Absolute URL, the page's canonical (no trailing slash except the home page). */
  loc: string;
  /** Source file, absolute path. */
  file: string;
}

export interface SitemapEntry extends Page {
  lastmod: string; // YYYY-MM-DD
  alternates: { hreflang: string; href: string }[];
}

/** Home page + every prerendered client/public/<path>/index.html, in a stable order. */
export function listPages(clientDir: string = CLIENT_DIR): Page[] {
  const publicDir = join(clientDir, "public");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name === "index.html"
          ? [join(dir, e.name)]
          : [],
    );
  const guides = walk(publicDir)
    .map((file) => ({
      file,
      path: relative(publicDir, dirname(file)).split(sep).join("/"),
    }))
    // English guides (/<topic>) first, then /<lang>/<topic>; alphabetical within.
    .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
  return [
    { loc: `${ORIGIN}/`, file: join(clientDir, "index.html") },
    ...guides.map(({ file, path }) => ({ loc: `${ORIGIN}/${path}`, file })),
  ];
}

const depth = (path: string) => path.split("/").length;

/** hreflang alternates exactly as the page declares them in its <head>. */
export function pageAlternates(html: string): { hreflang: string; href: string }[] {
  const out: { hreflang: string; href: string }[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    if (!/\brel="alternate"/.test(tag)) continue;
    const hreflang = tag.match(/\bhreflang="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    if (hreflang && href) out.push({ hreflang, href });
  }
  return out;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * True when REPO_ROOT is a git checkout with full history. A shallow clone (e.g. CI's
 * default fetch-depth 1) would date every page to the tip commit, so it doesn't count.
 */
export function gitHistoryAvailable(): boolean {
  try {
    return (
      resolve(git(["rev-parse", "--show-toplevel"])) === REPO_ROOT &&
      git(["rev-parse", "--is-shallow-repository"]) === "false"
    );
  } catch {
    return false;
  }
}

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Committer date (YYYY-MM-DD) of the last commit touching `file`; today when the file
 * is new or has uncommitted changes (it will be committed with them).
 */
export function lastCommitDate(file: string, today: Date = new Date()): string {
  const rel = relative(REPO_ROOT, file);
  const dirty = git(["status", "--porcelain", "--", rel]) !== "";
  const committed = git(["log", "-1", "--format=%cs", "--", rel]);
  return dirty || !committed ? localDate(today) : committed;
}

// The Article JSON-LD on the guides is one line of JSON (no spaces), as in the pages.
const ARTICLE_DATE = /("@type":"Article"[^<]*?"dateModified":")(\d{4}-\d{2}-\d{2})(")/;

/** The Article JSON-LD "dateModified" of a page, or null when it has none. */
export function articleDateModified(html: string): string | null {
  return html.match(ARTICLE_DATE)?.[2] ?? null;
}

/** The page with its Article JSON-LD "dateModified" set to `date` (no Article: as is). */
export function setDateModified(html: string, date: string): string {
  return html.replace(ARTICLE_DATE, (_, a: string, _d: string, b: string) => `${a}${date}${b}`);
}

/**
 * Set each page's Article "dateModified" to its sitemap lastmod (SERBITO-504). A page
 * whose date is wrong gets today's date: the rewrite itself is an uncommitted change,
 * so today is the lastmod it will have. Returns the files it rewrote.
 */
export function syncDateModified(clientDir: string = CLIENT_DIR, today: Date = new Date()): string[] {
  const changed: string[] = [];
  for (const { file } of listPages(clientDir)) {
    const html = readFileSync(file, "utf-8");
    const current = articleDateModified(html);
    if (current === null || current === lastCommitDate(file, today)) continue;
    writeFileSync(file, setDateModified(html, localDate(today)));
    changed.push(relative(REPO_ROOT, file));
  }
  return changed;
}

export function buildEntries(clientDir: string = CLIENT_DIR): SitemapEntry[] {
  return listPages(clientDir).map((page) => ({
    ...page,
    lastmod: lastCommitDate(page.file),
    alternates: pageAlternates(readFileSync(page.file, "utf-8")),
  }));
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const d = depth(e.loc.slice(ORIGIN.length + 1) || "");
    const isHome = e.loc === `${ORIGIN}/`;
    const lines = [
      "  <url>",
      `    <loc>${esc(e.loc)}</loc>`,
      `    <lastmod>${e.lastmod}</lastmod>`,
      `    <changefreq>${isHome ? "weekly" : "monthly"}</changefreq>`,
      // Home > English guides > translated guides (hints only; Google ignores them).
      `    <priority>${isHome ? "1.0" : d === 1 ? "0.8" : "0.6"}</priority>`,
      // Extension elements go last: sitemap.xsd puts <xsd:any> after <priority>.
      ...e.alternates.map(
        (a) =>
          `    <xhtml:link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}" />`,
      ),
      "  </url>",
    ];
    return lines.join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- Generated by scripts/sitemap.ts (npm run sitemap). Do not edit by hand. -->",
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export function generateSitemap(clientDir: string = CLIENT_DIR): string {
  return renderSitemap(buildEntries(clientDir));
}

// --------------------------------------------------------------------------- #
// FAQPage JSON-LD on the guides (SERBITO-482)
// --------------------------------------------------------------------------- #
// The visible <section id="faq"> is the source: each <h3> question and the <p> answer after
// it. The JSON-LD repeats that text word for word, as Google requires, and this script
// rewrites it, so the two can't drift (server/test/seo_content_482.test.ts checks it).
// Google shows FAQ rich results only for a few authoritative sites, so this is not for a
// Google snippet: Bing and AI answer engines read FAQPage markup, at ~1 KB a page.

export interface FaqPair {
  question: string;
  answer: string;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", "#39": "'", lt: "<", gt: ">", nbsp: " " };

/** Visible text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
export const plain = (html: string): string =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|quot|apos|#39|lt|gt|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();

/** Question/answer pairs of the page's visible FAQ section; [] when it has none. */
export function faqPairs(html: string): FaqPair[] {
  const at = html.indexOf('<section id="faq">');
  if (at < 0) return [];
  const faq = html.slice(at, html.indexOf("</section>", at));
  return [...faq.matchAll(/<h3>([\s\S]+?)<\/h3>\s*<p>([\s\S]+?)<\/p>/g)].map(([, q, a]) => ({
    question: plain(q),
    answer: plain(a),
  }));
}

/** The FAQPage JSON-LD object for these pairs. */
export function faqSchema(pairs: FaqPair[], lang: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: lang,
    mainEntity: pairs.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

// One <script> block per schema, indented as the other blocks in the guides' <head>.
const FAQ_BLOCK = /\n {2}<script type="application\/ld\+json">\n {4}\{"@context":"https:\/\/schema\.org","@type":"FAQPage"[^\n]*\n {2}<\/script>/;

/** The page with its FAQPage block added or replaced (or removed when it has no FAQ). */
export function withFaqSchema(html: string): string {
  const stripped = html.replace(FAQ_BLOCK, "");
  const pairs = faqPairs(stripped);
  if (!pairs.length) return stripped;
  const lang = stripped.match(/<html lang="([^"]+)"/)?.[1] ?? "en";
  // "<" escaped so no answer text can close the <script> element.
  const json = JSON.stringify(faqSchema(pairs, lang)).replace(/</g, "\\u003c");
  const block = `\n  <script type="application/ld+json">\n    ${json}\n  </script>`;
  const end = stripped.lastIndexOf("</script>", stripped.indexOf("</head>"));
  if (end < 0) throw new Error("no JSON-LD block in <head> to put the FAQPage after");
  const cut = end + "</script>".length;
  return stripped.slice(0, cut) + block + stripped.slice(cut);
}

/** Rewrite every guide page whose FAQPage block is missing or stale. Returns the files. */
export function syncFaqSchema(clientDir: string = CLIENT_DIR): string[] {
  const changed: string[] = [];
  // The home page (client/index.html) keeps its own hand-written FAQPage block.
  for (const { file } of listPages(clientDir).slice(1)) {
    const html = readFileSync(file, "utf-8");
    const next = withFaqSchema(html);
    if (next === html) continue;
    writeFileSync(file, next);
    changed.push(relative(REPO_ROOT, file));
  }
  return changed;
}

function main(argv: string[]): void {
  if (!gitHistoryAvailable()) {
    if (argv.includes("--if-git")) {
      console.log("sitemap: no full git history here; keeping the committed sitemap.xml");
      return;
    }
    console.error("sitemap: needs a git checkout with full history (lastmod = last commit)");
    process.exit(1);
  }
  const faqs = syncFaqSchema();
  if (faqs.length) console.log(`sitemap: wrote FAQPage JSON-LD in ${faqs.length} page(s) — commit them`);
  const dated = syncDateModified();
  if (dated.length) console.log(`sitemap: set Article dateModified in ${dated.length} page(s) — commit them`);
  const xml = generateSitemap();
  let before = "";
  try {
    before = readFileSync(SITEMAP_PATH, "utf-8");
  } catch {
    /* first run: no sitemap yet */
  }
  if (xml === before) {
    console.log("sitemap: client/public/sitemap.xml is up to date");
    return;
  }
  writeFileSync(SITEMAP_PATH, xml);
  console.log("sitemap: regenerated client/public/sitemap.xml — commit it");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
