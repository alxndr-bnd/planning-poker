import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";
import {
  CHANGELOG_PATH,
  ChangelogError,
  REPO_ROOT,
  UNRELEASED,
  entries,
  notes,
  parse,
  release,
  released,
  vkey,
  withLinks,
} from "../../scripts/changelog.js";

// SERBITO-389: CHANGELOG.md parses, entries are English and for players, versions go newest
// first, every tag from the first entry on has a section with its date, the release script
// does not release without entries, and the deploy stops a tag without its section.

const TEXT = readFileSync(CHANGELOG_PATH, "utf-8");
const CYRILLIC = /[Ѐ-ӿ]/;

function git(args: string[], cwd = REPO_ROOT, env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf-8" }).trim();
}

const newer = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

describe("CHANGELOG.md", () => {
  it("parses, with the link block exactly as release rebuilds it", () => {
    const releases = parse(TEXT);
    expect(releases[0].version).toBe(UNRELEASED);
    expect(released(releases).length).toBeGreaterThanOrEqual(5);
    expect(withLinks(TEXT, releases)).toBe(TEXT);
  });

  it("has English entries for players, without ticket numbers", () => {
    for (const r of parse(TEXT)) {
      for (const e of entries(r)) {
        expect(CYRILLIC.test(e), `${r.version}: ${e}`).toBe(false);
        expect(/SERBITO-\d+/.test(e), `${r.version}: ${e}`).toBe(false);
      }
    }
  });

  it("has a section with its date for every tag since the first entry", () => {
    const done = new Map(released(parse(TEXT)).map((r) => [r.version, r.date]));
    const oldest = [...done.keys()].map(vkey).sort(newer)[0];
    const tags = git(["tag", "--list", "v*.*.*"])
      .split("\n")
      .filter((t) => t && newer(vkey(t.slice(1)), oldest) >= 0);
    for (const tag of tags) {
      expect(done.has(tag.slice(1)), `${tag}: no section in CHANGELOG.md`).toBe(true);
      const day = git(["log", "-1", "--format=%cs", tag]);
      expect(done.get(tag.slice(1)), `${tag}: wrong date`).toBe(day);
    }
    // Only the newest section may lack a tag: the release script runs the tests before it
    // tags. A shallow checkout has at most the pushed tag, so this needs the full tag list.
    if (tags.some((t) => newer(vkey(t.slice(1)), oldest) === 0)) {
      const untagged = [...done.keys()].filter((v) => !tags.includes(`v${v}`));
      const newestTag = tags.map((t) => vkey(t.slice(1))).sort(newer).at(-1)!;
      expect(untagged.length).toBeLessThanOrEqual(1);
      for (const v of untagged) expect(newer(vkey(v), newestTag)).toBeGreaterThan(0);
    }
  });
});

const GOOD = `# Changelog

Free text.

## [Unreleased]

## [0.2.0] - 2026-09-26

### Added
- Two

## [0.1.0] - 2026-09-25

### Fixed
- One
`;

describe("changelog.ts", () => {
  it.each([
    [GOOD.replace("- Two", "- Two\n  - RU: Два"), "unexpected"], // English only
    [GOOD.replace("### Added", "### Improved"), "unknown section"],
    [GOOD.replace("## [0.2.0] - 2026-09-26", "## [0.2.0]"), "date"],
    [GOOD.replace("2026-09-26", "2026-02-30"), "bad date"],
    [GOOD.replace("0.2.0", "0.0.9"), "newer"], // version order
    [GOOD.replace("## [Unreleased]\n", "") + "\n## [Unreleased]\n", "Unreleased"],
    [GOOD.replace("- One", "* One"), "unexpected"],
    [GOOD.replace("### Fixed\n- One\n", ""), "no entries"],
    [GOOD.replace("### Added\n- Two\n", "### Added\n\n"), "is empty"],
    [GOOD + "\n[0.1.0]: https://example.com\n\nmore text\n", "link"],
  ])("rejects a malformed file (%#: %s)", (bad, why) => {
    expect(() => parse(bad)).toThrow(ChangelogError);
    expect(() => parse(bad)).toThrow(why);
  });

  it("release turns [Unreleased] into the version and notes print it", () => {
    const src = GOOD.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Changed\n- Three\n");
    const out = release(src, "0.3.0", "2026-09-28");
    const [top, rel] = parse(out);
    expect([top.version, entries(top)]).toEqual([UNRELEASED, []]);
    expect([rel.version, rel.date, entries(rel)]).toEqual(["0.3.0", "2026-09-28", ["Three"]]);
    const repo = "https://github.com/alxndr-bnd/planning-poker";
    expect(out.trimEnd().endsWith(`[0.1.0]: ${repo}/releases/tag/v0.1.0`)).toBe(true);
    expect(out).toContain(`[Unreleased]: ${repo}/compare/v0.3.0...HEAD`);
    expect(out).toContain(`[0.3.0]: ${repo}/compare/v0.2.0...v0.3.0`);
    expect(release(out, "0.3.0", "2026-09-29")).toBe(out); // a re-run after a failed gate
    expect(notes(out, "0.3.0")).toBe(
      `### Changed\n- Three\n\nFull history: [CHANGELOG.md](${repo}/blob/main/CHANGELOG.md)\n`,
    );
  });

  it("release refuses without entries or with an old version", () => {
    expect(() => release(GOOD, "0.3.0", "2026-09-28")).toThrow(
      /no entry for 0\.3\.0.*\[Unreleased\]/,
    );
    const fixed = GOOD.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n- X\n");
    expect(() => release(fixed, "0.1.5", "2026-09-28")).toThrow("not newer");
  });
});

// --- The release script in a throwaway repo: its own bare origin; npm and gh are stubs ---

function throwawayRepo() {
  const tmp = mkdtempSync(join(tmpdir(), "pp-release-"));
  const [work, remote, bin] = ["work", "remote.git", "bin"].map((d) => join(tmp, d));
  mkdirSync(join(work, "scripts"), { recursive: true });
  mkdirSync(bin);
  for (const f of ["release_minor.sh", "changelog.ts"]) {
    copyFileSync(join(REPO_ROOT, "scripts", f), join(work, "scripts", f));
  }
  writeFileSync(join(work, "CHANGELOG.md"), withLinks(GOOD, parse(GOOD)));
  writeFileSync(join(bin, "npm"), `#!/bin/sh\necho "$@" >> "${tmp}/npm-calls"\n`); // gate passes
  writeFileSync(join(bin, "gh"), `#!/bin/sh\nprintf "%s\\n" "$@" > "${tmp}/gh-args"\n`);
  for (const f of ["npm", "gh"]) chmodSync(join(bin, f), 0o755);
  // No GIT_* from the caller: in a pre-commit hook GIT_DIR and GIT_INDEX_FILE point at this
  // repo, and git commands in the throwaway repo would then write here.
  const clean = Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"));
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(clean),
    PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  git(["init", "-q", "--bare", remote], tmp, env);
  git(["init", "-q", "-b", "main"], work, env);
  for (const d of [work, remote]) {
    // git writes to the throwaway repos, never to this one
    const gitDir = realpathSync(git(["rev-parse", "--absolute-git-dir"], d, env));
    expect(gitDir.startsWith(realpathSync(tmp) + sep), gitDir).toBe(true);
  }
  git(["add", "."], work, env);
  git(["commit", "-qm", "init"], work, env);
  git(["tag", "v0.2.0"], work, env);
  git(["remote", "add", "origin", remote], work, env);
  git(["push", "-qu", "origin", "main", "v0.2.0"], work, env);
  const run = () =>
    spawnSync("bash", ["scripts/release_minor.sh", "Release"], {
      cwd: work,
      env,
      encoding: "utf-8",
      timeout: 60_000,
    });
  return { tmp, work, remote, env, run };
}

describe("scripts/release_minor.sh", () => {
  it("refuses without a CHANGELOG entry, before the gate, the commit and the tag", () => {
    const { tmp, work, env, run } = throwawayRepo();
    const head = git(["rev-parse", "HEAD"], work, env);
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toContain("no entry for 0.3.0");
    expect(r.stderr).toContain("## [Unreleased]");
    expect(existsSync(join(tmp, "npm-calls"))).toBe(false);
    expect(git(["rev-parse", "HEAD"], work, env)).toBe(head);
    expect(git(["tag"], work, env)).not.toContain("v0.3.0");
    expect(git(["status", "--porcelain"], work, env)).toBe("");
    expect(existsSync(join(tmp, "gh-args"))).toBe(false);
  }, 60_000);

  it("dates the entry in the release commit and uses it for the GitHub Release", () => {
    const { tmp, work, remote, env, run } = throwawayRepo();
    const log = join(work, "CHANGELOG.md");
    writeFileSync(
      log,
      readFileSync(log, "utf-8").replace("## [Unreleased]\n", "## [Unreleased]\n\n### Added\n- Three\n"),
    );
    git(["commit", "-qam", "entry"], work, env);
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(join(tmp, "npm-calls"), "utf-8")).toContain("test");
    const rel = parse(readFileSync(log, "utf-8"))[1];
    const d = new Date();
    const today = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
      .map((n) => String(n).padStart(2, "0"))
      .join("-");
    expect([rel.version, rel.date, entries(rel)]).toEqual(["0.3.0", today, ["Three"]]);
    expect(git(["status", "--porcelain"], work, env)).toBe(""); // in the release commit
    expect(git(["tag"], remote, env).split("\n")).toContain("v0.3.0");
    const args = readFileSync(join(tmp, "gh-args"), "utf-8").split("\n");
    expect(args.slice(0, 7)).toEqual([
      "release",
      "create",
      "v0.3.0",
      "--verify-tag",
      "--title",
      "v0.3.0",
      "--notes",
    ]);
    expect(args.slice(7).join("\n").startsWith("### Added\n- Three")).toBe(true);
  }, 60_000);
});

// --- deploy.yml: a tag without its CHANGELOG.md section stops before the build ---

function guardStep(): { script: string; stepNames: string[]; condition: string } {
  const lines = readFileSync(join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf-8").split("\n");
  const stepNames = lines
    .map((l) => /^ {6}- (?:name: (.+)|uses: (\S+)|id: (\S+))/.exec(l))
    .filter((m) => m !== null)
    .map((m) => m[1] ?? m[2] ?? m[3]);
  const start = lines.indexOf("      - name: CHANGELOG.md has this version");
  const runAt = lines.indexOf("        run: |", start);
  const condition = lines.slice(start, runAt).find((l) => l.includes("if:")) ?? "";
  const body: string[] = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() && !l.startsWith("          ")) break;
    body.push(l.slice(10));
  }
  return { script: body.join("\n"), stepNames, condition };
}

describe("deploy.yml CHANGELOG guard", () => {
  const { script, stepNames, condition } = guardStep();

  it("runs right after checkout and the tag pick, on every run", () => {
    expect(stepNames[0]).toMatch(/^actions\/checkout@/);
    // SERBITO-401: it checks the tag that deploys (a weekly refresh redeploys the newest tag).
    expect(stepNames[1]).toBe("Pick the release tag");
    expect(stepNames[2]).toBe("CHANGELOG.md has this version");
    expect(stepNames.indexOf("Build & push image")).toBeGreaterThan(2);
    expect(condition).toBe("");
  });

  it.each([
    ["v0.2.0", 0],
    ["v0.3.0", 1],
    ["v0x2x0", 1], // the dots in the version are literal
    ["v0.2", 1],
  ])("tag %s exits %i", (tag, code) => {
    const dir = mkdtempSync(join(tmpdir(), "pp-guard-"));
    writeFileSync(join(dir, "CHANGELOG.md"), GOOD);
    const r = spawnSync("bash", ["-e", "-c", script], {
      cwd: dir,
      env: { RELEASE_TAG: tag, PATH: "/usr/bin:/bin" },
      encoding: "utf-8",
    });
    expect(r.status, r.stdout + r.stderr).toBe(code);
    if (code) expect(r.stdout).toContain(`::error file=CHANGELOG.md::No '## [${tag.slice(1)}]`);
  });
});
