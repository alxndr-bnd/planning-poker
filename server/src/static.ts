import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, relative, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Serve the built SPA from `dist`, with SPA fallback to index.html.
 * Returns true if it handled the request.
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

  // Unknown path or directory: try a prerendered clean-URL SEO page
  // (/<slug> -> <slug>/index.html or <slug>.html) before the SPA fallback.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    const candidates = [join(filePath, "index.html"), `${filePath}.html`];
    const page = candidates.find(
      (c) => c.startsWith(dist + sep) && existsSync(c) && statSync(c).isFile(),
    );
    filePath = page ?? join(dist, "index.html");
    if (!existsSync(filePath)) return false;
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
