import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPokerServer } from "../src/server.js";

// Coverage for the static SPA server (server/src/static.ts): path-traversal
// containment + correct serving. Aikido flagged the file-read as a potential
// file-inclusion sink; these tests lock in that user-controlled paths can never
// escape `dist`, and that the containment guard doesn't regress legit serving.

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
  writeFileSync(join(dist, "guide", "index.html"), "<h1>Guide page</h1>");
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
  it("serves the SPA index at /", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.body).toContain("PP SPA");
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
    // Normalized back inside dist → nonexistent → SPA fallback, never the outside file.
    expect(r.body).not.toContain("TOP_SECRET_OUTSIDE_DIST");
    expect(r.body).toContain("PP SPA");
  });

  it("falls back to index.html for unknown SPA routes", async () => {
    const r = await get("/room/abc123");
    expect(r.status).toBe(200);
    expect(r.body).toContain("PP SPA");
  });
});
