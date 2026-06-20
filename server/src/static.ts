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

  // Directory or unknown path -> SPA fallback to index.html.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(dist, "index.html");
    if (!existsSync(filePath)) return false;
  }

  const type = MIME[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  createReadStream(filePath).pipe(res);
  return true;
}
