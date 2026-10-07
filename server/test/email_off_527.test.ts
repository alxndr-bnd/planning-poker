import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// SERBITO-527: Cloudflare Email Obfuscation rewrites a bare mailto link into
// /cdn-cgi/l/email-protection, and Googlebot reports that URL as a 404. Every mailto
// link on a page we ship must sit inside <!--email_off--> … <!--/email_off-->.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const clientDir = join(here, "../../client");

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(p);
    return e.name.endsWith(".html") ? [p] : [];
  });
}

describe("mailto links are hidden from Cloudflare Email Obfuscation", () => {
  const pages = [join(clientDir, "index.html"), ...htmlFiles(join(clientDir, "public"))];

  it("finds the privacy page with its contact links", () => {
    const privacy = readFileSync(join(clientDir, "public/privacy/index.html"), "utf8");
    expect(privacy.match(/href="mailto:/g)?.length).toBe(2);
  });

  it.each(pages)("%s", (page) => {
    // Drop every email_off block; no mailto link may be left outside one.
    const outside = readFileSync(page, "utf8").replace(
      /<!--email_off-->[\s\S]*?<!--\/email_off-->/g,
      "",
    );
    expect(outside).not.toContain("mailto:");
  });
});
