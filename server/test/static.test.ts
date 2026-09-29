import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createPokerServer } from "../src/server.js";

// Coverage for the static SPA server (server/src/static.ts): path-traversal
// containment + correct serving. Aikido flagged the file-read as a potential
// file-inclusion sink; these tests lock in that user-controlled paths can never
// escape `dist`, and that the containment guard doesn't regress legit serving.

/** An inline script like the gtag consent snippet; its hash must be in the CSP. */
const INLINE = "window.dataLayer=window.dataLayer||[];";

let server: Server;
let port: number;
let root: string;
let dist: string;

function get(
  path: string,
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            headers: res.headers as Record<string, unknown>,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "pp-static-"));
  dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>PP SPA</title>");
  writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log('app')");
  mkdirSync(join(dist, "guide"), { recursive: true });
  writeFileSync(
    join(dist, "guide", "index.html"),
    `<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>` +
      `<script>${INLINE}</script>` +
      `<script type="application/ld+json">{"@type":"Thing"}</script>` +
      "<h1>Guide page</h1>",
  );
  // A secret file OUTSIDE dist (sibling of it) — traversal must never reach it.
  writeFileSync(join(root, "secret.txt"), "TOP_SECRET_OUTSIDE_DIST");

  server = createPokerServer(dist);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(root, { recursive: true, force: true });
});

describe("static file serving containment", () => {
  it("serves the SPA index at /, never cached (a deploy's new asset hashes must load)", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.body).toContain("PP SPA");
    expect(r.headers["cache-control"]).toBe("no-cache");
  });

  it("serves a content-hashed asset with immutable caching", async () => {
    const r = await get("/assets/app-abc123.js");
    expect(r.status).toBe(200);
    expect(r.body).toContain("console.log");
    expect(String(r.headers["cache-control"])).toContain("immutable");
  });

  it("serves a prerendered clean-URL page and 301s its trailing-slash form", async () => {
    const page = await get("/guide");
    expect(page.status).toBe(200);
    expect(page.body).toContain("Guide page");
    const redirect = await get("/guide/");
    expect(redirect.status).toBe(301);
    expect(String(redirect.headers["location"])).toBe("/guide");
  });

  it("does not serve files outside dist via ../ traversal", async () => {
    const r = await get("/../secret.txt");
    // Normalized back inside dist → nonexistent → 404, never the outside file.
    expect(r.status).toBe(404);
    expect(r.body).not.toContain("TOP_SECRET_OUTSIDE_DIST");
  });

  it("answers unknown paths with a real 404, not the SPA shell (no soft 404)", async () => {
    // Rooms live in the hash (`/#/r/<id>`), so no path needs the old SPA fallback.
    for (const path of ["/room/abc123", "/nonexistent", "/assets/gone-123.js", "/guide/x"]) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(String(r.headers["content-type"])).toContain("text/html");
      expect(r.body, path).not.toContain("PP SPA");
      expect(r.body).toContain('content="noindex"');
    }
  });

  it("still serves / with a query string (e.g. ?ui=v2)", async () => {
    const r = await get("/?ui=v2");
    expect(r.status).toBe(200);
    expect(r.body).toContain("PP SPA");
  });
});

// SERBITO-361 / PKR-5: security headers on every response. The CSP is report-only
// (the consent banner and GA must keep working); framing is denied for real.
describe("security headers", () => {
  it("are sent on pages, assets, redirects and 404s", async () => {
    for (const path of ["/", "/assets/app-abc123.js", "/guide/", "/nonexistent"]) {
      const h = (await get(path)).headers;
      expect(h["strict-transport-security"], path).toBe("max-age=31536000; includeSubDomains");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["content-security-policy"], path).toBe("frame-ancestors 'none'");
      expect(String(h["permissions-policy"]), path).toContain("camera=()");
      expect(String(h["content-security-policy-report-only"]), path).toContain(
        "default-src 'self'",
      );
    }
  });

  it("the report-only CSP allows what the pages need: hashed inline gtag, GA4, CF beacon", async () => {
    const csp = String((await get("/")).headers["content-security-policy-report-only"]);
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "))!;
    const hash = createHash("sha256").update(INLINE).digest("base64");
    expect(scriptSrc).toContain(`'sha256-${hash}'`);
    expect(scriptSrc).toContain("https://*.googletagmanager.com");
    expect(scriptSrc).toContain("https://static.cloudflareinsights.com");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc.match(/'sha256-/g)).toHaveLength(1); // JSON-LD and src= scripts skipped
    expect(csp).toContain("connect-src 'self' wss://poker.serbito.rs");
    expect(csp).toContain("https://*.google-analytics.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});
