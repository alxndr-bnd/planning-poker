// IndexNow (SERBITO-558): tells Bing, Yandex and the other IndexNow engines about every URL in
// the live sitemap.xml. Google does not use IndexNow; it reads the sitemap and Search Console.
//
// The deploy workflow runs it after a tag deploy passes the smoke check, so the new pages and
// the key file are already live. The key is the name of client/public/<32 hex>.txt, served at
// /<key>.txt; IndexNow keys are public by design.
//
// Never fatal: a network error or a non-2xx answer prints a warning, and the exit code is 0.
// Plain JavaScript (not .ts): the deploy runner's Node cannot run TypeScript.
//
// Usage:  node scripts/indexnow.mjs [--base https://poker.serbito.rs] [--dry-run]
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ENDPOINT = "https://api.indexnow.org/indexnow";
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "client", "public");
const UA = "poker-indexnow/1.0 (+https://github.com/alxndr-bnd/planning-poker)";

/** The key: the one client/public/<32 hex>.txt file. */
export function indexNowKey(dir = PUBLIC_DIR) {
  const found = readdirSync(dir).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  if (found.length !== 1) throw new Error(`expected one <32 hex>.txt IndexNow key file, found ${found}`);
  return found[0].slice(0, -4);
}

/** <loc> URLs of the sitemap, own host only: IndexNow rejects other hosts. */
export function sitemapUrls(xml, host) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => new URL(u).host === host);
}

export function payload(base, key, urls) {
  return { host: new URL(base).host, key, keyLocation: `${base}/${key}.txt`, urlList: urls };
}

export async function main(argv = process.argv.slice(2), log = console) {
  const at = argv.indexOf("--base");
  const base = (at >= 0 ? argv[at + 1] : "https://poker.serbito.rs").replace(/\/$/, "");
  try {
    const key = indexNowKey();
    const res = await fetch(`${base}/sitemap.xml`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`sitemap.xml: HTTP ${res.status}`);
    const urls = sitemapUrls(await res.text(), new URL(base).host);
    const body = payload(base, key, urls);
    if (argv.includes("--dry-run")) {
      log.log(JSON.stringify(body, null, 2));
      return 0;
    }
    const sent = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!sent.ok) throw new Error(`IndexNow answered HTTP ${sent.status}`);
    log.log(`IndexNow: ${urls.length} URLs sent, HTTP ${sent.status}`);
  } catch (e) {
    log.warn(`::warning::IndexNow ping failed (not fatal): ${e instanceof Error ? e.message : e}`);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
