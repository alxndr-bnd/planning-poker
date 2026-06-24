import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 2026-06-24: GA4 (G-B5CQC4JJV0) to count users via analytics.google.com.
// Must be the STANDARD static <script src=...gtag/js> snippet — Google's "verify your
// tag" detection does NOT see a dynamically-injected/host-gated tag (that failed
// verification on 2026-06-24). Guard the id + that it's a real static script tag.
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, "../../client/index.html"), "utf-8");

describe("GA4 analytics", () => {
  it("includes the GA4 measurement id", () => {
    expect(html).toContain("G-B5CQC4JJV0");
  });
  it("loads gtag.js as a static script tag (so Google can detect/verify it)", () => {
    expect(html).toMatch(
      /<script[^>]*src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-B5CQC4JJV0"/,
    );
  });
});
