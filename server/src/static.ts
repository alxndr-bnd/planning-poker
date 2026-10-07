import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  // JPEG matters beyond the browser: og-image.jpg is fetched by Slack, Discord and
  // the other unfurlers, and they reject a share image served as octet-stream.
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

// Unknown paths get a real 404 (SERBITO-305). The old SPA fallback answered every URL
// with 200 + the app shell — a soft 404 that kept removed pages in search indexes. The
// app routes rooms with `#/r/<id>` (the hash never reaches the server), so it needs no
// fallback: only `/` and real files are served. Inline on purpose — a 404.html in dist
// would itself be reachable as /404 and /404.html with a 200.
const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Page not found · Planning Poker</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-content:center;text-align:center;background:#15603b;color:#fff}a{color:#fff}</style>
</head>
<body>
<h1>Page not found</h1>
<p><a href="/">Start a Planning Poker room</a></p>
</body>
</html>
`;

// --- Security headers on every HTTP response (SERBITO-361 / PKR-5) ---

/** Third parties the pages load: GA4 (gtag.js behind the consent banner) and
 *  Cloudflare Web Analytics. Anything else shows up as a CSP report. */
const GA = "https://*.googletagmanager.com";
const GA_COLLECT = "https://*.google-analytics.com https://*.analytics.google.com";
const CF_BEACON = "https://static.cloudflareinsights.com";

/** Bodies of the inline <script>s (not src=, not JSON-LD data blocks) in `html`. */
export function inlineScripts(html: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const open = html.indexOf("<script", at);
    if (open < 0) return out;
    const tagEnd = html.indexOf(">", open);
    const close = html.indexOf("</script", tagEnd);
    if (tagEnd < 0 || close < 0) return out;
    const tag = html.slice(open, tagEnd + 1).toLowerCase();
    if (!/\ssrc\s*=/.test(tag) && !tag.includes("application/ld+json")) {
      out.push(html.slice(tagEnd + 1, close));
    }
    at = close + 1;
  }
}

/** CSP source list with the sha256 of every inline script in the built pages. */
function inlineScriptHashes(dist: string): string[] {
  const hashes = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".html")) {
        for (const body of inlineScripts(readFileSync(p, "utf-8"))) {
          hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
        }
      }
    }
  };
  if (existsSync(dist)) walk(dist);
  return [...hashes].sort();
}

/**
 * Headers for every response. The CSP is REPORT-ONLY for now: it lists what the pages
 * are known to need (own scripts + hashed inline gtag snippet, GA4, Cloudflare beacon),
 * so violations surface in the browser console without breaking the consent banner or
 * GA. Enforce it once it has run clean. Framing is enforced right away: frame-ancestors
 * only works in an enforced policy, so it gets its own one-directive CSP.
 * Built once per dist (the pages don't change while the server runs).
 */
export function securityHeaders(dist: string): Record<string, string> {
  const reportOnly = [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(dist).join(" ")} ${GA} ${CF_BEACON}`.replace(/ +/g, " "),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${GA} ${GA_COLLECT}`,
    `connect-src 'self' wss://poker.serbito.rs ${GA} ${GA_COLLECT} https://cloudflareinsights.com`,
    "font-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
    "content-security-policy-report-only": reportOnly,
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), " +
      "accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()",
    "cross-origin-opener-policy": "same-origin",
  };
}

function notFound(res: ServerResponse): true {
  res.writeHead(404, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-cache",
  });
  res.end(NOT_FOUND_PAGE);
  return true;
}

/**
 * Serve the built SPA from `dist`: real files, `/` (index.html) and prerendered
 * clean-URL pages; anything else is a 404. Returns false only when there is no `dist`.
 */
export function serveStatic(
  dist: string,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (!existsSync(dist)) return false;

  const [urlPath, query = ""] = (req.url ?? "/").split("?");
  // Prevent path traversal; resolve within dist.
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(dist, safe);

  // Containment: filePath must be dist itself or strictly inside it. The `+ sep`
  // guard stops a sibling dir that merely shares the prefix (e.g. `${dist}-other`).
  if (filePath !== dist && !filePath.startsWith(dist + sep)) {
    res.writeHead(403).end("Forbidden");
    return true;
  }

  // `/room` is only the GA virtual page for a room (client/src/analytics.ts), but Google
  // reads the string in the inline gtag snippet and crawls it (SERBITO-527: a 404 in
  // Search Console). Send it, and a person who types it, to the app.
  if (urlPath === "/room" || urlPath === "/room/") {
    res.writeHead(301, { location: "/" }).end();
    return true;
  }

  // A guide language root (/ru, /ru/) has no page of its own: open the app in that
  // language (SERBITO-355; it was a 404). Only for a language that has guides in dist.
  const langRoot = /^\/([a-z]{2})\/?$/.exec(urlPath)?.[1];
  if (langRoot) {
    const dir = join(dist, langRoot);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      res.writeHead(302, { location: `/?lang=${langRoot}`, "cache-control": "no-cache" }).end();
      return true;
    }
  }

  // Normalize a trailing slash on a prerendered clean-URL page (/slug/ -> /slug):
  // the canonical is the no-slash form, so 301 to it rather than serving a second
  // crawlable variant. Skips the site root ("/") and anything without an index.html.
  if (urlPath.length > 1 && urlPath.endsWith("/")) {
    const dirIndex = join(dist, safe, "index.html");
    if (dirIndex.startsWith(dist + sep) && existsSync(dirIndex)) {
      // Build the target from the sanitized in-dist path (never the raw req.url), so the
      // Location is always a single-origin absolute path — no open-redirect surface.
      const target = "/" + relative(dist, join(dist, safe)).split(sep).join("/");
      res.writeHead(301, { location: query ? `${target}?${query}` : target }).end();
      return true;
    }
  }

  // Unknown path or directory: try a prerendered clean-URL page (/ -> index.html,
  // /<slug> -> <slug>/index.html or <slug>.html); nothing there is a 404.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    const candidates = [join(filePath, "index.html"), `${filePath}.html`];
    const page = candidates.find(
      (c) => c.startsWith(dist + sep) && existsSync(c) && statSync(c).isFile(),
    );
    if (!page) return notFound(res);
    filePath = page;
  }

  const type = MIME[extname(filePath)] ?? "application/octet-stream";
  // Vite emits content-hashed files under /assets — safe to cache forever.
  // HTML must stay fresh so a new deploy's hashed asset refs are picked up.
  const isHashedAsset = /[/\\]assets[/\\]/.test(filePath) && !filePath.endsWith(".html");
  const cacheControl = isHashedAsset
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, { "content-type": type, "cache-control": cacheControl });
  createReadStream(filePath).pipe(res);
  return true;
}
