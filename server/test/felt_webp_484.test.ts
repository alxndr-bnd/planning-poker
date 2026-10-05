import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// SERBITO-484 (seo/03-seo-product-roadmap.md): the table felt was a 285 KB JPEG; now it is
// a WebP under 150 KB. No image-set() JPEG fallback: the build minifier folds the two
// declarations into one -webkit-image-set() with type(), which old WebKit rejects anyway.
// A browser without WebP keeps the felt-green background-color.

const pub = join(dirname(fileURLToPath(import.meta.url)), "../../client/public");
const css = readFileSync(join(pub, "../src/styles.css"), "utf-8");

describe("felt background", () => {
  it("is a real WebP under 150 KB, and the old JPEG is gone", () => {
    const file = join(pub, "table-felt.webp");
    expect(statSync(file).size).toBeLessThan(150 * 1024);
    const head = readFileSync(file).subarray(0, 12).toString("latin1");
    expect(head.startsWith("RIFF") && head.endsWith("WEBP")).toBe(true);
    expect(existsSync(join(pub, "table-felt.jpg"))).toBe(false);
  });

  it("the table uses the WebP over a felt-green background-color", () => {
    const start = css.indexOf(".table {");
    const table = css.slice(start, css.indexOf("}", start));
    expect(table).toContain("url(/table-felt.webp) center / cover");
    expect(table).toContain("background-color: #15603b");
    expect(css).not.toContain("table-felt.jpg");
  });
});
