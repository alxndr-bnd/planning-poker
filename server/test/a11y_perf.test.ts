import { afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LANGS, t, type Lang } from "../../client/src/i18n.js";

// 2026-06-24 Lighthouse pass: a11y 98→100 (main landmark). Cache lifetimes of
// hashed assets vs HTML are checked over HTTP in static.test.ts.
const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(__dirname, p), "utf-8");
const APP_MODULE = join(__dirname, "../../client/src/App.tsx");

/** The app's first screen, rendered by React itself (no effects run). */
async function renderLobby({ lang = "en", hash = "" }: { lang?: Lang; hash?: string } = {}) {
  const store = new Map<string, string>([["pp_lang", lang]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal("location", { hash, search: "", pathname: "/", origin: "https://poker.serbito.rs" });
  // Not a literal specifier on purpose: the server's tsc (no JSX, no DOM lib) must not
  // follow it into the client, which `npm -w @pp/client run typecheck` checks already.
  const { App } = (await import(/* @vite-ignore */ APP_MODULE)) as { App: ComponentType };
  return renderToStaticMarkup(createElement(App));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a11y + perf guards", () => {
  it("App renders a <main> landmark (Lighthouse landmark-one-main)", async () => {
    expect(await renderLobby()).toContain("<main>");
  });
});

// SERBITO-350 (from the SERBITO-330 audit).
describe("name field (WCAG 3.3.2)", () => {
  it("has a visible label tied to the input, in every UI language", async () => {
    for (const { code } of LANGS) {
      const html = await renderLobby({ lang: code });
      const m = /<label for="([^"]+)">([^<]+)<\/label><input id="([^"]+)"/.exec(html);
      expect(m, code).not.toBeNull();
      expect(m![3], code).toBe(m![1]);
      expect(m![2], code).toBe(t(code, "lobby.nameLabel"));
    }
  });

  it("does not grab focus on the landing, only on an invite link (joining a room)", async () => {
    expect(await renderLobby()).not.toContain("autofocus");
    expect(await renderLobby({ hash: "#/r/ZC3THcb2yw" })).toMatch(/<input id="[^"]+" autofocus=""/);
  });
});

describe("app shell (client/index.html)", () => {
  const html = read("../../client/index.html");
  /** The body of a CSS rule in the page's <style>, by exact selector. */
  const rule = (sel: string) => {
    const at = html.indexOf(`${sel} {`);
    return at < 0 ? "" : html.slice(at, html.indexOf("}", at));
  };

  it("underlines the cross-promo links: not told apart by colour alone (WCAG 1.4.1)", () => {
    expect(rule(".pp-crosspromo a")).toContain("text-decoration: underline");
  });

  it("un-fixes the footer while the cookie banner is open, so focus there is never hidden (2.4.11)", () => {
    expect(html).toMatch(/<footer\s+class="pp-foot"/);
    expect(rule(".pp-foot")).toContain("position: fixed");
    expect(rule("html[data-ppc-open] .pp-foot")).toContain("position: static");
    // Only the class positions it: an inline position would beat the rule above.
    const tag = html.slice(html.lastIndexOf("<footer"));
    expect(tag.slice(0, tag.indexOf(">"))).not.toContain("position:");
  });
});
