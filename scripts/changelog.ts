// CHANGELOG.md: what changed for players, version by version (SERBITO-389, after gtd's
// changelog.py). Keep a Changelog format, English only. One parser serves the format test
// (server/test/changelog.test.ts) and scripts/release_minor.sh:
//
//   node scripts/changelog.ts release X.Y.Z [YYYY-MM-DD]  [Unreleased] -> [X.Y.Z] - date, or refuse
//                                                          when [Unreleased] has no entries
//   node scripts/changelog.ts notes X.Y.Z                 the notes for the GitHub Release
//   node scripts/changelog.ts check                       parse and check the format only
//
// Format (the CHANGELOG.md header describes it too). Free text until the first "## ", then:
//   ## [Unreleased]                    first; new entries go here before a release (may be empty)
//   ## [0.56.0] - 2026-10-04           releases, newest first
//   ### Added | Changed | Fixed | Security
//   - English text                     an entry, one line
//   [0.56.0]: https://github.com/...   compare links at the very end (release rebuilds them)
// Any other line is a parse error with its line number, so the format cannot drift silently.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CHANGELOG_PATH = join(REPO_ROOT, "CHANGELOG.md");
export const REPO_URL = "https://github.com/alxndr-bnd/planning-poker";
export const UNRELEASED = "Unreleased";
/** Allowed sections, in the order of the release notes. */
export const SECTIONS = ["Added", "Changed", "Fixed", "Security"] as const;

const RE_VERSION = /^## \[(Unreleased|\d+\.\d+\.\d+)\](?: - (\d{4}-\d{2}-\d{2}))?$/;
const RE_SECTION = /^### (.+)$/;
const RE_ENTRY = /^- (\S.*)$/;
const RE_LINK = /^\[(Unreleased|\d+\.\d+\.\d+)\]: (\S+)$/;

export class ChangelogError extends Error {}

export interface Release {
  version: string; // "0.56.0" or "Unreleased"
  date: string | null; // "2026-10-04"; null for Unreleased
  sections: Map<string, string[]>;
}

/** All entries of a release, in section order. */
export function entries(r: Release): string[] {
  return SECTIONS.flatMap((name) => r.sections.get(name) ?? []);
}

export function vkey(version: string): number[] {
  return version.split(".").map(Number);
}

function cmp(a: string, b: string): number {
  const [x, y] = [vkey(a), vkey(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function validDate(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

export function released(releases: Release[]): Release[] {
  return releases.filter((r) => r.version !== UNRELEASED);
}

/** Versions top to bottom, as in the file. A format error throws ChangelogError with the line. */
export function parse(text: string): Release[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((s) => s.startsWith("## "));
  if (start < 0) throw new ChangelogError("CHANGELOG.md: no '## [version]' headings");
  const releases: Release[] = [];
  let sec: string[] | null = null;
  let links = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const fail = (why: string): never => {
      throw new ChangelogError(`CHANGELOG.md:${i + 1}: ${why}: ${JSON.stringify(line)}`);
    };
    if (!line.trim()) continue;
    if (RE_LINK.test(line)) {
      links = true;
      continue;
    }
    if (links) fail("only link definitions may follow the link definitions");
    let m = RE_VERSION.exec(line);
    if (m) {
      const [, ver, day] = m;
      if (ver === UNRELEASED) {
        if (day || releases.length) fail("[Unreleased] goes first and has no date");
      } else {
        if (!day) fail("a released version needs a date: '## [X.Y.Z] - YYYY-MM-DD'");
        if (!validDate(day)) fail("bad date");
      }
      releases.push({ version: ver, date: day ?? null, sections: new Map() });
      sec = null;
      continue;
    }
    const current = releases.at(-1) ?? fail("expected a version heading");
    m = RE_SECTION.exec(line);
    if (m) {
      const name = m[1];
      if (!(SECTIONS as readonly string[]).includes(name)) {
        fail(`unknown section, use one of ${SECTIONS.join(", ")}`);
      }
      if (current.sections.has(name)) fail("duplicate section");
      sec = [];
      current.sections.set(name, sec);
      continue;
    }
    m = RE_ENTRY.exec(line);
    if (m) {
      if (!sec) fail("an entry must be under '### Added/Changed/Fixed/Security'");
      sec!.push(m[1]);
      continue;
    }
    fail("unexpected line");
  }
  for (const r of releases) {
    for (const [name, items] of r.sections) {
      if (!items.length) throw new ChangelogError(`CHANGELOG.md: [${r.version}] ### ${name} is empty`);
    }
  }
  const done = released(releases);
  for (const r of done) {
    if (!entries(r).length) throw new ChangelogError(`CHANGELOG.md: [${r.version}] has no entries`);
  }
  for (let i = 0; i + 1 < done.length; i++) {
    const [newer, older] = [done[i], done[i + 1]];
    if (cmp(newer.version, older.version) <= 0 || newer.date! < older.date!) {
      throw new ChangelogError(
        `CHANGELOG.md: [${newer.version}] must be newer than [${older.version}] below it`,
      );
    }
  }
  return releases;
}

/** Keep a Changelog compare links: [Unreleased] from the latest tag to HEAD, each version from
 *  the one before it. The oldest version links to its tag. */
export function linkLines(releases: Release[]): string[] {
  const done = released(releases).map((r) => r.version);
  const out = done.length ? [`[${UNRELEASED}]: ${REPO_URL}/compare/v${done[0]}...HEAD`] : [];
  done.forEach((ver, i) => {
    const prev = done[i + 1];
    out.push(
      prev
        ? `[${ver}]: ${REPO_URL}/compare/v${prev}...v${ver}`
        : `[${ver}]: ${REPO_URL}/releases/tag/v${ver}`,
    );
  });
  return out;
}

/** The text with the link block at the end rebuilt. */
export function withLinks(text: string, releases: Release[]): string {
  const lines = text.replace(/\n+$/, "").split("\n");
  while (lines.length && (!lines.at(-1)!.trim() || RE_LINK.test(lines.at(-1)!))) lines.pop();
  return [...lines, "", ...linkLines(releases)].join("\n") + "\n";
}

/** The entries under [Unreleased] become "## [version] - day", with a new empty [Unreleased] on
 *  top. If the version is already in the file (a re-run after a failed gate), the text stays as
 *  it is. No entries: ChangelogError that says what to add. */
export function release(text: string, version: string, day: string): string {
  const releases = parse(text);
  if (releases.some((r) => r.version === version)) return text;
  const done = released(releases);
  if (done.length && cmp(version, done[0].version) <= 0) {
    throw new ChangelogError(
      `CHANGELOG.md: ${version} is not newer than the latest entry [${done[0].version}]`,
    );
  }
  const top = releases[0].version === UNRELEASED ? releases[0] : null;
  if (!top || !entries(top).length) {
    throw new ChangelogError(
      `CHANGELOG.md has no entry for ${version}. Add what players get under '## [${UNRELEASED}]' ` +
        `(### Added / Changed / Fixed / Security, one English '- ' line per entry), then run the ` +
        `release again. It turns [${UNRELEASED}] into [${version}] - ${day}.`,
    );
  }
  if (!validDate(day)) throw new ChangelogError(`bad date: ${day}`);
  const head = `## [${UNRELEASED}]\n`;
  const out = text.replace(head, `${head}\n## [${version}] - ${day}\n`);
  return withLinks(out, parse(out));
}

/** GitHub Release body: the entries of the version. */
export function notes(text: string, version: string): string {
  const r = parse(text).find((r) => r.version === version);
  if (!r || !entries(r).length) throw new ChangelogError(`CHANGELOG.md has no entries for ${version}`);
  const out: string[] = [];
  for (const name of SECTIONS) {
    const items = r.sections.get(name);
    if (items) out.push(`### ${name}`, ...items.map((e) => `- ${e}`), "");
  }
  out.push(`Full history: [CHANGELOG.md](${REPO_URL}/blob/main/CHANGELOG.md)`);
  return out.join("\n") + "\n";
}

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function main(argv: string[], path: string = CHANGELOG_PATH): number {
  const [cmd = "check", ...args] = argv;
  try {
    const text = readFileSync(path, "utf-8");
    if (cmd === "check" && !args.length) {
      parse(text);
    } else if (cmd === "release" && (args.length === 1 || args.length === 2)) {
      const out = release(text, args[0], args[1] ?? localDate(new Date()));
      if (out !== text) writeFileSync(path, out);
    } else if (cmd === "notes" && args.length === 1) {
      process.stdout.write(notes(text, args[0]));
    } else {
      console.error("Usage: node scripts/changelog.ts release X.Y.Z [YYYY-MM-DD] | notes X.Y.Z | check");
      return 2;
    }
  } catch (e) {
    if (!(e instanceof ChangelogError)) throw e;
    console.error(`ERROR: ${e.message}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
