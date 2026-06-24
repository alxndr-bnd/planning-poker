import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 2026-06-24: GA4 (G-B5CQC4JJV0) added to count users via analytics.google.com.
// It MUST stay gated to the prod host so localhost / *.run.app / footer-preview don't
// pollute the stats. Guard both the id and the hostname gate.
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, "../../client/index.html"), "utf-8");

describe("GA4 analytics", () => {
  it("includes the GA4 measurement id", () => {
    expect(html).toContain("G-B5CQC4JJV0");
  });
  it("loads GA only on the production host", () => {
    expect(html).toMatch(/location\.hostname\s*===\s*"poker\.serbito\.rs"/);
  });
});
