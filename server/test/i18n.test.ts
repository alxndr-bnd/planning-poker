import { describe, it, expect } from "vitest";
// Client i18n module — tested here so it runs in the existing vitest gate.
import { EN, LANGS, t, getInitialLang } from "../../client/src/i18n.js";

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

  it("defaults to English when nothing is saved", () => {
    expect(getInitialLang()).toBe("en");
  });

  it("never returns an empty string for any EN key in any language", () => {
    for (const { code } of LANGS) {
      for (const key of Object.keys(EN) as (keyof typeof EN)[]) {
        expect(t(code, key).length).toBeGreaterThan(0);
      }
    }
  });
});
