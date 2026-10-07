// The site's HTML pages, for tests that check every page (SERBITO-484). One walker
// instead of a copy in each test file.
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** planning-poker/client */
export const clientDir = join(dirname(fileURLToPath(import.meta.url)), "../../../client");

/** Every client/public/**\/index.html (the prerendered guides and /privacy), sorted. */
export function publicPages(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name === "index.html"
          ? [join(dir, e.name)]
          : [],
    );
  return walk(join(clientDir, "public")).sort();
}

/** The app shell (client/index.html) first, then every public page. */
export function allPages(): string[] {
  return [join(clientDir, "index.html"), ...publicPages()];
}
