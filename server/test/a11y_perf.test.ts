import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 2026-06-24 Lighthouse pass: a11y 98→100 (main landmark). Cache lifetimes of
// hashed assets vs HTML are checked over HTTP in static.test.ts.
const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(__dirname, p), "utf-8");

describe("a11y + perf guards", () => {
  it("App renders a <main> landmark (Lighthouse landmark-one-main)", () => {
    expect(read("../../client/src/App.tsx")).toContain("<main>");
  });
});
