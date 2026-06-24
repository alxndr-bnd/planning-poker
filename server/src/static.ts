import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
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

  const urlPath = (req.url ?? "/").split("?")[0];
  // Prevent path traversal; resolve within dist.
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(dist, safe);

  if (!filePath.startsWith(dist)) {
    res.writeHead(403).end("Forbidden");
    return true;
  }

  // Unknown path or directory: try a prerendered clean-URL SEO page
  // (/<slug> -> <slug>/index.html or <slug>.html) before the SPA fallback.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    const candidates = [join(filePath, "index.html"), `${filePath}.html`];
    const page = candidates.find(
      (c) => c.startsWith(dist) && existsSync(c) && statSync(c).isFile(),
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
