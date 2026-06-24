import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 2026-06-24 Lighthouse pass: a11y 98→100 (main landmark) + perf cache lifetimes.
const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(__dirname, p), "utf-8");

describe("a11y + perf guards", () => {
  it("App renders a <main> landmark (Lighthouse landmark-one-main)", () => {
    expect(read("../../client/src/App.tsx")).toContain("<main>");
  });
  it("static server long-caches hashed assets (immutable)", () => {
    const s = read("../src/static.ts");
    expect(s).toContain("immutable");
    expect(s).toMatch(/no-cache/); // html stays fresh
  });
});
