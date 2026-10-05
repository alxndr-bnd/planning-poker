import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  createPokerServer,
  DEFAULT_ALLOWED_ORIGINS,
  originAllowed,
  parseAllowedOrigins,
} from "../src/server.js";
import {
  analyticsFromEnv,
  CF_BEACON_PLACEHOLDER,
  GA_PLACEHOLDER,
  renderAnalytics,
} from "../../client/src/pageAnalytics.js";

// SERBITO-513: a self-hosted copy works on its own domain. The WebSocket origins come from
// ALLOWED_ORIGINS (default: the live site only), and the pages carry GA4 and the Cloudflare
// beacon only when the build gets GA_MEASUREMENT_ID / CF_BEACON_TOKEN. The live site passes
// both in deploy.yml.

const here = dirname(fileURLToPath(import.meta.url)); // server/test
const root = join(here, "../..");
const clientDir = join(root, "client");
const LIVE_GA = "G-B5CQC4JJV0";
const LIVE_CF = "baa4373b14044e0b83a55a7d437c6019";

/** client/index.html + every client/public/**\/index.html. */
function allPages(): { file: string; html: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name === "index.html"
          ? [join(dir, e.name)]
          : [],
    );
  return [join(clientDir, "index.html"), ...walk(join(clientDir, "public")).sort()].map(
    (f) => ({ file: relative(clientDir, f), html: readFileSync(f, "utf-8") }),
  );
}

// --------------------------------------------------------------------------- #
// WebSocket origins
// --------------------------------------------------------------------------- #
describe("ALLOWED_ORIGINS", () => {
  it("defaults to the live site, so poker.serbito.rs needs no setting", () => {
    expect(DEFAULT_ALLOWED_ORIGINS).toEqual(["https://poker.serbito.rs"]);
    expect(parseAllowedOrigins(undefined)).toEqual(["https://poker.serbito.rs"]);
    expect(parseAllowedOrigins("  ")).toEqual(["https://poker.serbito.rs"]);
  });

  it("reads a comma-separated list of origins", () => {
    expect(
      parseAllowedOrigins(" https://Poker.Example.com/ ,http://127.0.0.1:8080,, https://a.example:8443"),
    ).toEqual(["https://poker.example.com", "http://127.0.0.1:8080", "https://a.example:8443"]);
  });

  it.each(["poker.example.com", "https://poker.example.com/app", "ftp://x.example", "*", "https://a.example?x=1"])(
    "refuses to start with a value that is not an origin: %s",
    (bad) => {
      expect(() => parseAllowedOrigins(bad)).toThrow(/ALLOWED_ORIGINS/);
    },
  );

  it("with the default, keeps the SERBITO-361 rules", () => {
    expect(originAllowed(undefined, true)).toBe(false);
    expect(originAllowed("https://poker.serbito.rs", true)).toBe(true);
    expect(originAllowed("https://poker.example.com", true)).toBe(false);
    expect(originAllowed("http://localhost:5173", true)).toBe(false);
    expect(originAllowed("http://localhost:5173", false)).toBe(true);
  });

  it("with a list, allows exactly those origins (scheme, host and port)", () => {
    const list = parseAllowedOrigins("https://poker.example.com,http://127.0.0.1:8080");
    expect(originAllowed("https://poker.example.com", true, list)).toBe(true);
    expect(originAllowed("http://127.0.0.1:8080", true, list)).toBe(true);
    // The live site is not in this copy's list.
    expect(originAllowed("https://poker.serbito.rs", true, list)).toBe(false);
    expect(originAllowed("http://poker.example.com", true, list)).toBe(false);
    expect(originAllowed("https://poker.example.com:8443", true, list)).toBe(false);
    expect(originAllowed("http://127.0.0.1:9999", true, list)).toBe(false);
    expect(originAllowed("https://evil.example", true, list)).toBe(false);
    expect(originAllowed("null", true, list)).toBe(false);
    // Still: no Origin is refused, and localhost is implicit only outside production.
    expect(originAllowed(undefined, true, list)).toBe(false);
    expect(originAllowed(undefined, false, list)).toBe(false);
    expect(originAllowed("http://localhost:5173", true, list)).toBe(false);
    expect(originAllowed("http://localhost:5173", false, list)).toBe(true);
  });

  describe("on a running server", () => {
    let server: Server | null = null;
    const saved = process.env.ALLOWED_ORIGINS;
    afterEach(async () => {
      if (saved === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = saved;
      if (server) await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    });

    async function openWith(origin: string): Promise<string> {
      server ??= createPokerServer("/nonexistent");
      if (!server.listening) await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
      const port = (server.address() as AddressInfo).port;
      return new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
        ws.once("open", () => {
          ws.terminate();
          resolve("open");
        });
        ws.once("error", () => resolve("refused"));
      });
    }

    it("without the variable accepts the live site only", async () => {
      delete process.env.ALLOWED_ORIGINS;
      expect(await openWith("https://poker.serbito.rs")).toBe("open");
      expect(await openWith("https://poker.example.com")).toBe("refused");
    });

    it("with the variable accepts the self-hosted origin and not the live site", async () => {
      process.env.ALLOWED_ORIGINS = "https://poker.example.com";
      expect(await openWith("https://poker.example.com")).toBe("open");
      expect(await openWith("https://poker.serbito.rs")).toBe("refused");
    });

    it("an explicit list option wins over the variable", async () => {
      process.env.ALLOWED_ORIGINS = "https://poker.example.com";
      server = createPokerServer("/nonexistent", { allowedOrigins: ["https://b.example"] });
      expect(await openWith("https://b.example")).toBe("open");
      expect(await openWith("https://poker.example.com")).toBe("refused");
    });
  });
});

// --------------------------------------------------------------------------- #
// Analytics in the pages
// --------------------------------------------------------------------------- #
describe("analytics config", () => {
  it("is off when the variables are missing or empty", () => {
    expect(analyticsFromEnv({})).toEqual({});
    expect(analyticsFromEnv({ GA_MEASUREMENT_ID: " ", CF_BEACON_TOKEN: "" })).toEqual({});
  });

  it("reads and checks the GA4 id and the beacon token", () => {
    expect(analyticsFromEnv({ GA_MEASUREMENT_ID: LIVE_GA, CF_BEACON_TOKEN: LIVE_CF })).toEqual({
      gaMeasurementId: LIVE_GA,
      cfBeaconToken: LIVE_CF,
    });
    // The values go into HTML and inline JS: anything else stops the build.
    expect(() => analyticsFromEnv({ GA_MEASUREMENT_ID: 'G-1"><script>' })).toThrow(/GA_MEASUREMENT_ID/);
    expect(() => analyticsFromEnv({ GA_MEASUREMENT_ID: "UA-12345-1" })).toThrow(/GA_MEASUREMENT_ID/);
    expect(() => analyticsFromEnv({ CF_BEACON_TOKEN: "x'y" })).toThrow(/CF_BEACON_TOKEN/);
  });
});

describe("pages without analytics config (a self-hosted build)", () => {
  const pages = allPages();

  it("covers the app shell, the guides and /privacy", () => {
    expect(pages.length).toBeGreaterThanOrEqual(38);
  });

  it("the sources hold placeholders, not the live ids", () => {
    const bad = pages.filter(
      ({ html }) =>
        !html.includes(GA_PLACEHOLDER) ||
        !html.includes(CF_BEACON_PLACEHOLDER) ||
        /gtag\/js\?id=G-|"config", "G-|"token": "[0-9a-f]{32}"/.test(html),
    );
    expect(bad.map((p) => p.file)).toEqual([]);
  });

  it("load no gtag.js, no consent banner and no Cloudflare beacon", () => {
    const bad = pages.filter(({ html }) => {
      const out = renderAnalytics(html, {});
      return /googletagmanager|gtag\(|\/consent\.js|cloudflareinsights|analytics:|__GA_|__CF_/.test(out);
    });
    expect(bad.map((p) => p.file)).toEqual([]);
  });

  it("keep everything else", () => {
    const shell = pages[0].html;
    const out = renderAnalytics(shell, {});
    expect(out).toContain('<script type="module" src="/src/main.tsx"></script>');
    expect(out).toContain("<title>");
    expect(out).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  });
});

describe("pages with the live analytics config", () => {
  const pages = allPages();
  const cfg = { gaMeasurementId: LIVE_GA, cfBeaconToken: LIVE_CF };

  it("carry the static gtag.js tag, the consent banner and the beacon, with no placeholder left", () => {
    const bad = pages.filter(({ html }) => {
      const out = renderAnalytics(html, cfg);
      return (
        !out.includes(`<script async src="https://www.googletagmanager.com/gtag/js?id=${LIVE_GA}"></script>`) ||
        !new RegExp(`gtag\\(\\s*"config",\\s*"${LIVE_GA}"`).test(out) ||
        !out.includes('<script defer src="/consent.js"></script>') ||
        !out.includes(`data-cf-beacon='{"token": "${LIVE_CF}"}'`) ||
        /__GA_|__CF_|analytics:/.test(out)
      );
    });
    expect(bad.map((p) => p.file)).toEqual([]);
  });

  it("GA4 without a beacon token, and the other way round", () => {
    const shell = pages[0].html;
    const gaOnly = renderAnalytics(shell, { gaMeasurementId: LIVE_GA });
    expect(gaOnly).toContain("googletagmanager");
    expect(gaOnly).not.toContain("cloudflareinsights");
    const cfOnly = renderAnalytics(shell, { cfBeaconToken: LIVE_CF });
    expect(cfOnly).not.toContain("googletagmanager");
    expect(cfOnly).not.toContain("/consent.js");
    expect(cfOnly).toContain("cloudflareinsights");
  });
});

// --------------------------------------------------------------------------- #
// The live site keeps its ids: the deploy passes them to the image build.
// --------------------------------------------------------------------------- #
describe("deploy config", () => {
  const deploy = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf-8");
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf-8");

  it("deploy.yml builds the image with the live GA4 id and beacon token", () => {
    expect(deploy).toMatch(new RegExp(`^ {2}GA_MEASUREMENT_ID: ${LIVE_GA}$`, "m"));
    expect(deploy).toMatch(new RegExp(`^ {2}CF_BEACON_TOKEN: ${LIVE_CF}$`, "m"));
    const args = /build-args: \|\n((?: {12}.*\n)+)/.exec(deploy)![1];
    expect(args).toContain("GA_MEASUREMENT_ID=${{ env.GA_MEASUREMENT_ID }}");
    expect(args).toContain("CF_BEACON_TOKEN=${{ env.CF_BEACON_TOKEN }}");
  });

  it("the Dockerfile hands both to npm run build", () => {
    const build = dockerfile.slice(0, dockerfile.indexOf("FROM node:24-slim AS runtime"));
    const run = build.indexOf("RUN npm run build");
    expect(run).toBeGreaterThan(-1);
    for (const name of ["GA_MEASUREMENT_ID", "CF_BEACON_TOKEN"]) {
      const arg = build.search(new RegExp(`^ARG ${name}\\b`, "m"));
      expect(arg, name).toBeGreaterThan(-1);
      expect(arg, name).toBeLessThan(run);
    }
  });
});
