import { afterEach, describe, it, expect, vi } from "vitest";
// Client i18n module — tested here so it runs in the existing vitest gate.
import { EN, LANGS, t, detectLang, getInitialLang } from "../../client/src/i18n.js";

describe("UI i18n", () => {
  it("returns the English string for en", () => {
    expect(t("en", "lobby.create")).toBe("Create room");
  });

  it("interpolates {var} placeholders", () => {
    expect(t("en", "room.revealsThisRound", { name: "Ann" })).toBe(
      "Ann reveals this round",
    );
  });

  it("uses the target-language string when a translation exists", () => {
    const es = t("es", "lobby.create");
    expect(es).not.toBe(EN["lobby.create"]); // actually translated
    expect(es.length).toBeGreaterThan(0);
  });

  it("preserves the {name} placeholder across languages", () => {
    // every language must keep the interpolation slot, or the reveal hint breaks
    for (const { code } of LANGS) {
      expect(t(code, "room.revealsThisRound", { name: "Ann" })).toContain("Ann");
    }
  });

  it("offers English plus 8 languages, with English first (default)", () => {
    expect(LANGS[0].code).toBe("en");
    expect(LANGS.map((l) => l.code)).toEqual([
      "en",
      "es",
      "de",
      "fr",
      "pt",
      "ru",
      "sr",
      "ja",
      "zh",
    ]);
  });


  it("never returns an empty string for any EN key in any language", () => {
    for (const { code } of LANGS) {
      for (const key of Object.keys(EN) as (keyof typeof EN)[]) {
        expect(t(code, key).length).toBeGreaterThan(0);
      }
    }
  });
});

// SERBITO-355 (5a): a ru-RU browser got English. Owner: detect navigator.language on
// the first visit only; a saved pp_lang wins; the /xx/ guides link with ?lang=xx.
describe("initial UI language", () => {
  function browser({ saved, languages, href = "https://poker.serbito.rs/" }: {
    saved?: string;
    languages: string[];
    href?: string;
  }) {
    const store = new Map<string, string>(saved ? [["pp_lang", saved]] : []);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("navigator", { languages, language: languages[0] });
    const bar = { href };
    vi.stubGlobal("location", bar);
    vi.stubGlobal("history", {
      state: null,
      replaceState: (_s: unknown, _t: string, url: string) => {
        bar.href = new URL(url, bar.href).href;
      },
    });
    return { store, bar };
  }
  afterEach(() => vi.unstubAllGlobals());

  it("first visit: the browser's language, saved so later visits keep it", () => {
    const { store } = browser({ languages: ["ru-RU", "en-US"] });
    expect(getInitialLang()).toBe("ru");
    expect(store.get("pp_lang")).toBe("ru");
  });

  it("first visit, a language we don't offer: English", () => {
    const { store } = browser({ languages: ["pl-PL", "it"] });
    expect(getInitialLang()).toBe("en");
    expect(store.get("pp_lang")).toBe("en");
  });

  it("a saved choice wins over the browser's language", () => {
    browser({ saved: "de", languages: ["ru-RU"] });
    expect(getInitialLang()).toBe("de");
  });

  it("?lang=xx from a guide link wins, is saved, and leaves the address bar", () => {
    const { store, bar } = browser({
      saved: "en",
      languages: ["en-US"],
      href: "https://poker.serbito.rs/?lang=ru&ui=v2#/r/abcdef123",
    });
    expect(getInitialLang()).toBe("ru");
    expect(store.get("pp_lang")).toBe("ru");
    expect(bar.href).toBe("https://poker.serbito.rs/?ui=v2#/r/abcdef123");
  });

  it("an unknown ?lang is dropped and ignored", () => {
    const { bar } = browser({ saved: "es", languages: ["en"], href: "https://poker.serbito.rs/?lang=xx" });
    expect(getInitialLang()).toBe("es");
    expect(bar.href).toBe("https://poker.serbito.rs/");
  });

  it("matches by primary subtag", () => {
    expect(detectLang(["pt-BR"])).toBe("pt");
    expect(detectLang(["sr-Latn-RS"])).toBe("sr");
    expect(detectLang(["zh-Hans-CN"])).toBe("zh");
    expect(detectLang(["ZH_tw"])).toBe("zh");
    expect(detectLang(["nl", "fr-CA"])).toBe("fr");
    expect(detectLang([])).toBeNull();
  });
});
