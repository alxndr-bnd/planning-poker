import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPage, startApp, type App } from "./support/app.js";

// SERBITO-355 (5a-5d), end to end in Chromium: Russian users got English.

let app: App;
beforeAll(async () => {
  app = await startApp();
}, 60_000);
afterAll(async () => {
  await app?.close();
});

const footer = (page: import("playwright-core").Page) =>
  page.evaluate<string>(`document.querySelector(".pp-foot").textContent.replace(/\\s+/g, " ").trim()`);

describe("UI language", () => {
  it("a ru-RU browser's first visit: the app, its footer and Other projects in Russian", async () => {
    const { page } = await openPage(app, { path: "/", locale: "ru-RU", storage: { pp_name: "Аня" } });
    try {
      await page.getByRole("button", { name: "Создать комнату" }).waitFor();
      expect(await page.evaluate("document.documentElement.lang")).toBe("ru");
      expect(await page.evaluate(`localStorage.getItem("pp_lang")`)).toBe("ru");
      const foot = await footer(page);
      expect(foot).toContain("Открытый код на GitHub");
      expect(foot).toContain("Настройки cookie");
      expect(foot).not.toContain("Open source on GitHub");
      expect(await page.locator(".pp-crosspromo").textContent()).toContain("Другие проекты");
    } finally {
      await page.context().close();
    }
  });

  it("a saved choice wins over the browser's language", async () => {
    const { page } = await openPage(app, { path: "/", locale: "ru-RU", storage: { pp_name: "Ann", pp_lang: "en" } });
    try {
      await page.getByRole("button", { name: "Create room" }).waitFor();
      expect(await footer(page)).toContain("Open source on GitHub");
    } finally {
      await page.context().close();
    }
  });

  it("/ru/ (a guide's language root) opens the app in Russian, ?lang gone from the URL", async () => {
    const { page } = await openPage(app, { path: "/ru/", locale: "en-US", storage: { pp_name: "Ann", pp_lang: "en" } });
    try {
      await page.getByRole("button", { name: "Создать комнату" }).waitFor();
      expect(new URL(page.url()).search).toBe("");
      expect(await page.evaluate(`localStorage.getItem("pp_lang")`)).toBe("ru");
    } finally {
      await page.context().close();
    }
  });

  it("switching the language re-labels the footer too", async () => {
    const { page } = await openPage(app, { path: "/" });
    try {
      await page.getByRole("combobox", { name: "Language" }).selectOption("ru");
      await expect.poll(() => footer(page)).toContain("Открытый код на GitHub");
      await page.getByRole("combobox", { name: "Language" }).selectOption("en");
      await expect.poll(() => footer(page)).toContain("Open source on GitHub");
    } finally {
      await page.context().close();
    }
  });
});
