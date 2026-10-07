import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, request, type Server } from "node:http";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createPokerServer, directOriginHost } from "../src/server.js";
import { REPO_ROOT } from "../../scripts/changelog.js";

// SERBITO-348 (PLT-4): the run.app URL skips Cloudflare, so it must not open the WebSocket.
// Plus the post-deploy security-header check (scripts/check_security_headers.sh).

const RUN_APP = "planning-poker-aay5lcpxha-ew.a.run.app";
const ORIGIN = "http://localhost:5173";
const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) {
    // Drop the keep-alive socket from get(): without it close() waits ~4 s for it to time out.
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});

async function listen(s: Server): Promise<number> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return (s.address() as AddressInfo).port;
}

function dist(): string {
  const d = mkdtempSync(join(tmpdir(), "pp-dist-"));
  writeFileSync(join(d, "index.html"), "<!doctype html><title>Planning Poker</title>");
  return d;
}

/** Open a WS with the given Host; resolves "open" or the HTTP status of the refusal. */
function openWs(port: number, host?: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: ORIGIN,
      headers: host ? { host } : {},
    });
    ws.once("open", () => {
      ws.terminate();
      resolve("open");
    });
    ws.once("unexpected-response", (_req, res) => resolve(String(res.statusCode)));
    ws.once("error", (e) => resolve(`error: ${e.message}`));
  });
}

function get(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path: "/", headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
}

describe("directOriginHost", () => {
  it.each([
    [RUN_APP, true],
    ["planning-poker-488744139718.europe-west1.run.app", true],
    ["PLANNING-POKER-X.A.RUN.APP:443", true],
    [`${RUN_APP}.`, true],
    ["poker.serbito.rs", false],
    ["localhost:8090", false],
    ["127.0.0.1", false],
    ["[::1]:8090", false],
    ["run.app.evil.example", false],
    ["notrun.app", false],
    [undefined, false],
    ["", false],
  ])("%s -> %s", (host, expected) => {
    expect(directOriginHost(host)).toBe(expected);
  });

  it("takes the suffix list as a parameter", () => {
    expect(directOriginHost("a.example.test", [".example.test"])).toBe(true);
    expect(directOriginHost(RUN_APP, [])).toBe(false);
  });
});

describe("run.app host on the server", () => {
  it("refuses the WebSocket on run.app with 403 and still serves the page there", async () => {
    const port = await listen(createPokerServer(dist()));
    expect(await openWs(port, RUN_APP)).toBe("403");
    expect(await openWs(port, `${RUN_APP}:443`)).toBe("403");
    // Through Cloudflare (or locally) the WebSocket opens as before.
    expect(await openWs(port)).toBe("open");
    // The deploy smoke check loads / from the run.app URL.
    expect(await get(port, RUN_APP)).toBe(200);
  });

  it("uses the configured suffix list", async () => {
    const port = await listen(createPokerServer(dist(), { directOriginHostSuffixes: [".localtest"] }));
    expect(await openWs(port, "x.localtest")).toBe("403");
    expect(await openWs(port, RUN_APP)).toBe("open");
  });
});

// --- scripts/check_security_headers.sh ---------------------------------------------------

const SCRIPT = join(REPO_ROOT, "scripts/check_security_headers.sh");

/** Async: the test servers answer on this event loop while the script runs. */
function sh(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("bash", args, { cwd: opts.cwd, env: opts.env ?? process.env }, (err, stdout, stderr) => {
      const raw: unknown = err ? (err as { code?: unknown }).code : 0;
      resolve({ code: typeof raw === "number" ? raw : 1, out: stdout + stderr });
    });
  });
}

/** A server that sends only the given headers. */
async function bare(headers: Record<string, string>): Promise<number> {
  return listen(
    createServer((_req, res) => {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.end("ok");
    }),
  );
}

describe("check_security_headers.sh", () => {
  it("passes on the poker server", async () => {
    const port = await listen(createPokerServer(dist()));
    const r = await sh([SCRIPT, `http://127.0.0.1:${port}/`]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Security headers OK");
  });

  it("lists every missing header and exits 1", async () => {
    const port = await bare({ "X-Content-Type-Options": "sniff-me" });
    const r = await sh([SCRIPT, `http://127.0.0.1:${port}/`]);
    expect(r.code, r.out).toBe(1);
    for (const name of [
      "strict-transport-security",
      "x-content-type-options: nosniff",
      "x-frame-options or frame-ancestors",
      "referrer-policy",
      "content-security-policy",
    ]) {
      expect(r.out).toContain(`  - ${name}`);
    }
  });

  it("counts frame-ancestors only in an enforced CSP; names and values in any case", async () => {
    const port = await bare({
      "STRICT-TRANSPORT-SECURITY": "max-age=31536000",
      "X-Content-Type-Options": "NoSniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy-Report-Only": "default-src 'self'; Frame-Ancestors 'none'",
    });
    let r = await sh([SCRIPT, `http://127.0.0.1:${port}/`]);
    // frame-ancestors only counts in an ENFORCED policy (browsers ignore it in report-only).
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("x-frame-options or frame-ancestors");
    const port2 = await bare({
      "Strict-Transport-Security": "max-age=31536000",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "frame-ancestors 'none'",
    });
    r = await sh([SCRIPT, `http://127.0.0.1:${port2}/`]);
    expect(r.code, r.out).toBe(0);
  });

  it("exits 2 when the request fails", async () => {
    const r = await sh([SCRIPT, "http://127.0.0.1:1/"]);
    expect(r.code, r.out).toBe(2);
  });
});

// --- the deploy step ------------------------------------------------------------------------

const LINES = readFileSync(join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf-8").split("\n");

function stepScript(name: string): string {
  const start = LINES.indexOf(`      - name: ${name}`);
  expect(start, `no step "${name}"`).toBeGreaterThan(-1);
  const runAt = LINES.indexOf("        run: |", start);
  const body: string[] = [];
  for (const l of LINES.slice(runAt + 1)) {
    if (l.trim() && !l.startsWith(" ".repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join("\n");
}

/** Step env with a fake gcloud that reports `url` as the service URL; no inherited GIT_*. */
function stepEnv(url: string): NodeJS.ProcessEnv {
  const bin = mkdtempSync(join(tmpdir(), "pp-bin-"));
  writeFileSync(join(bin, "gcloud"), `#!/bin/sh\necho "${url}"\n`);
  chmodSync(join(bin, "gcloud"), 0o755);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  return { ...env, PATH: `${bin}:${process.env.PATH}`, SERVICE: "planning-poker", REGION: "europe-west1", RELEASE_TAG: "v9.9.9" };
}

describe("deploy.yml: Security headers check", () => {
  it("runs after the smoke check", () => {
    const smoke = LINES.indexOf("      - name: Smoke check (roll back on failure)");
    const check = LINES.indexOf("      - name: Security headers check");
    expect(smoke).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(smoke);
  });

  it("passes on good headers and fails with ::error:: on missing ones", async () => {
    const good = await listen(createPokerServer(dist()));
    let r = await sh(["-eo", "pipefail", "-c", stepScript("Security headers check")], {
      cwd: REPO_ROOT,
      env: stepEnv(`http://127.0.0.1:${good}`),
    });
    expect(r.code, r.out).toBe(0);

    const badPort = await bare({});
    r = await sh(["-eo", "pipefail", "-c", stepScript("Security headers check")], {
      cwd: REPO_ROOT,
      env: stepEnv(`http://127.0.0.1:${badPort}`),
    });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("::error::");
    expect(r.out).not.toContain("update-traffic"); // no rollback
  });

  it("skips with a warning when the deployed tag has no script", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-oldtag-"));
    mkdirSync(join(dir, "scripts"));
    const r = await sh(["-eo", "pipefail", "-c", stepScript("Security headers check")], {
      cwd: dir,
      env: stepEnv("http://127.0.0.1:1"),
    });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("::warning::");
  });
});
