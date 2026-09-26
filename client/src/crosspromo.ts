// "Other projects" cross-promo block (SERBITO-264): the ONE list of sibling products.
//
// Rendered at build time, not by React: the Vite plugin in vite.config.ts replaces
// CROSSPROMO_MARKER in index.html and in every prerendered guide page with plain
// static <a href> links, so crawlers and no-JS visitors see them and no script runs.
// Page language comes from <html lang>, strings from the UI i18n tables.
import { LANGS, t, type Lang, type StringKey } from "./i18n.js";

/** Placeholder the build replaces with the rendered block. */
export const CROSSPROMO_MARKER = "<!-- crosspromo -->";

/** Every link in the block carries these, so the sibling sites can attribute the visit. */
export const CROSSPROMO_UTM = "utm_source=poker&utm_medium=crosspromo&utm_campaign=footer";

export const OTHER_PROJECTS: readonly { name: string; url: string; blurb: StringKey }[] = [
  { name: "GTD", url: "https://gtd.serbito.rs/", blurb: "crosspromo.gtd" },
  { name: "Javi", url: "https://javi.serbito.rs/", blurb: "crosspromo.javi" },
  { name: "Serbito", url: "https://serbito.rs/", blurb: "crosspromo.serbito" },
];

export const MADE_BY = {
  name: "No Handoff",
  url: "https://www.linkedin.com/company/nohandoff/",
} as const;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const link = (url: string, text: string) =>
  `<a href="${esc(`${url}?${CROSSPROMO_UTM}`)}" rel="noopener">${esc(text)}</a>`;

/** `<html lang="pt-BR">` -> "pt"; anything unknown -> "en". */
export function pageLang(html: string): Lang {
  const tag = /<html[^>]*\slang="([a-zA-Z]+)/.exec(html)?.[1]?.toLowerCase();
  return LANGS.find((l) => l.code === tag)?.code ?? "en";
}

/** The block as static HTML: one line of products, one "Made by" line. */
export function renderCrossPromo(lang: Lang): string {
  const title = t(lang, "crosspromo.title");
  const items = OTHER_PROJECTS.map(
    (p) => `${link(p.url, p.name)} — ${esc(t(lang, p.blurb))}`,
  ).join(" · ");
  const [before, after] = t(lang, "crosspromo.madeBy").split("{name}");
  return (
    `<nav class="crosspromo" aria-label="${esc(title)}">` +
    `${esc(title)}: ${items}<br />` +
    `${esc(before)}${link(MADE_BY.url, MADE_BY.name)}${esc(after ?? "")}` +
    `</nav>`
  );
}

/** Replace the marker in a page with the block in that page's language. */
export function injectCrossPromo(html: string): string {
  return html.includes(CROSSPROMO_MARKER)
    ? html.replace(CROSSPROMO_MARKER, renderCrossPromo(pageLang(html)))
    : html;
}
