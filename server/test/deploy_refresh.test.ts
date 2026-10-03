import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../../scripts/changelog.js";

// SERBITO-401: a weekly rebuild + redeploy of the newest release tag. Debian security fixes
// reached prod only with a release. Now a schedule (Wednesday 03:00 UTC) and a manual run check
// out the newest vX.Y.Z tag and run the same build -> Trivy -> deploy path with today's
// APT_REFRESH; the image tag is <sha>-r<YYYYMMDD>. Every deploy ends with a smoke check of the
// main page; a failure routes traffic back to the previous revision. The step scripts run here
// as-is (bash -e -o pipefail, as on GitHub) against a throwaway repo and fake gcloud/curl/sleep.

const TEXT = readFileSync(join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf-8");
const LINES = TEXT.split("\n");
const CODE = LINES.filter((l) => !l.trimStart().startsWith("#")).join("\n");
const AR_IMAGE = /^ {2}AR_IMAGE: (\S+)$/m.exec(TEXT)![1];
const STEPS_AT = LINES.indexOf("    steps:");
const STEPS = LINES.flatMap((l, i) => (i > STEPS_AT && /^ {6}- /.test(l) ? [i] : []));

function stepAt(name: string): number {
  const at = LINES.indexOf(`      - name: ${name}`);
  expect(at, `no step "${name}"`).toBeGreaterThan(-1);
  return STEPS.indexOf(at);
}

/** The step's run script, with ${{ env.X }} written as $X (the shell sees the env). */
function script(name: string): string {
  const start = LINES.indexOf(`      - name: ${name}`);
  const runAt = LINES.indexOf("        run: |", start);
  const body: string[] = [];
  for (const l of LINES.slice(runAt + 1)) {
    if (l.trim() && !l.startsWith(" ".repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join("\n").replace(/\$\{\{\s*env\.(\w+)\s*\}\}/g, "${$1}");
}

// No inherited GIT_*: inside a git hook they point at the REAL repository.
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  return {
    ...env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    ...extra,
  };
}

function run(name: string, cwd: string, env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "pp-step-"));
  const out = join(dir, "out");
  const genv = join(dir, "env");
  writeFileSync(out, "");
  writeFileSync(genv, "");
  const r = spawnSync("bash", ["-eo", "pipefail", "-c", script(name)], {
    cwd,
    env: cleanEnv({ GITHUB_OUTPUT: out, GITHUB_ENV: genv, GITHUB_STEP_SUMMARY: "/dev/null", ...env }),
    encoding: "utf-8",
  });
  const vars: Record<string, string> = {};
  for (const f of [out, genv]) {
    for (const line of readFileSync(f, "utf-8").split("\n").filter(Boolean)) {
      const i = line.indexOf("=");
      vars[line.slice(0, i)] = line.slice(i + 1);
    }
  }
  return { status: r.status, log: r.stdout + r.stderr, stdout: r.stdout, vars };
}

describe("deploy.yml triggers", () => {
  it("runs on a tag, weekly on Wednesday and by hand", () => {
    expect(TEXT).toMatch(/^ {2}push:\n {4}tags:\n {6}- "v\*\.\*\.\*"$/m);
    // Wednesday 03:00 UTC: Cloud SQL maintenance is Tuesday 02:00 UTC.
    expect(TEXT).toMatch(/^ {2}schedule:\n {4}- cron: "0 3 \* \* 3"$/m);
    expect(TEXT).toMatch(/^ {2}workflow_dispatch:$/m);
  });

  it("never runs a refresh and a release deploy at the same time", () => {
    expect(TEXT).toMatch(/^concurrency:\n {2}group: deploy-production\n {2}cancel-in-progress: false$/m);
  });

  it("fetches the tags for a refresh and uses the picked tag afterwards", () => {
    expect(TEXT).toContain("fetch-depth: ${{ github.event_name == 'push' && 1 || 0 }}");
    expect(stepAt("Pick the release tag")).toBe(1);
    // On a schedule run both point at main, not at the deployed tag.
    expect(CODE).not.toMatch(/github\.sha|GITHUB_SHA/);
    expect(CODE.match(/GITHUB_REF_NAME/g)).toHaveLength(1); // only the tag pick, for a tag push
  });
});

describe("Pick the release tag", () => {
  function repo() {
    const work = realpathSync(mkdtempSync(join(tmpdir(), "pp-repo-")));
    const env = cleanEnv();
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: work, env, encoding: "utf-8" }).trim();
    const commit = (text: string) => {
      writeFileSync(join(work, "app.ts"), text);
      git("add", "-A");
      git("commit", "-qm", text);
      return git("rev-parse", "HEAD");
    };
    git("init", "-q", "-b", "main");
    expect(git("rev-parse", "--absolute-git-dir")).toBe(join(work, ".git")); // never the real repo
    return { work, git, commit };
  }

  it("deploys the pushed tag's own commit", () => {
    const { work, git, commit } = repo();
    const sha = commit("release");
    git("tag", "v0.2.0");
    const r = run("Pick the release tag", work, {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF_NAME: "v0.2.0",
      AR_IMAGE,
    });
    expect(r.status, r.log).toBe(0);
    expect(r.vars).toMatchObject({ mode: "release", RELEASE_TAG: "v0.2.0", IMAGE: `${AR_IMAGE}:${sha}` });
  });

  it.each(["schedule", "workflow_dispatch"])("a %s run rebuilds the newest release tag", (event) => {
    const { work, git, commit } = repo();
    commit("old");
    git("tag", "v0.9.0");
    const newest = commit("newest release");
    git("tag", "v0.10.0"); // version order, not text order
    commit("candidate");
    git("tag", "v0.11.0-rc1"); // not a vX.Y.Z release tag
    commit("work on main");
    const r = run("Pick the release tag", work, { GITHUB_EVENT_NAME: event, AR_IMAGE });
    expect(r.status, r.log).toBe(0);
    expect(git("rev-parse", "HEAD")).toBe(newest);
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    expect(r.vars).toMatchObject({
      mode: "refresh",
      RELEASE_TAG: "v0.10.0",
      IMAGE: `${AR_IMAGE}:${newest}-r${day}`,
    });
  });

  it("fails a refresh when there is no release tag", () => {
    const { work, commit } = repo();
    commit("never released");
    const r = run("Pick the release tag", work, { GITHUB_EVENT_NAME: "schedule", AR_IMAGE });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("::error::No vX.Y.Z tag");
  });
});

describe("smoke check and rollback", () => {
  const FAKE_GCLOUD = `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case "$*" in
  "run services describe"*"--format=json"*) [ -n "$FAKE_JSON" ] && echo "$FAKE_JSON" ;;
  "run services describe"*"status.url"*) echo "https://planning-poker-x.a.run.app" ;;
  "run services update-traffic"*) exit 0 ;;
  *) exit 2 ;;
esac
`;

  function fakes() {
    const dir = mkdtempSync(join(tmpdir(), "pp-fakes-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const files: Record<string, string> = {
      gcloud: FAKE_GCLOUD,
      curl: '#!/bin/sh\nprintf "%s" "$FAKE_CODE"\n',
      sleep: "#!/bin/sh\nexit 0\n",
    };
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(bin, name), body);
      chmodSync(join(bin, name), 0o755);
    }
    const log = join(dir, "gcloud.log");
    writeFileSync(log, "");
    // jq: /usr/bin on macOS and the GitHub runner; Homebrew as a fallback.
    const PATH = [bin, "/usr/bin", "/bin", "/opt/homebrew/bin", "/usr/local/bin"].join(":");
    return { env: { PATH, FAKE_LOG: log, SERVICE: "planning-poker", REGION: "europe-west1" }, log, dir };
  }

  it("reads the serving revision before the deploy and smoke-checks after it", () => {
    const prev = stepAt("Remember the serving revision");
    const deploy = stepAt("Deploy to Cloud Run");
    const smoke = stepAt("Smoke check (roll back on failure)");
    expect(stepAt("Trivy image scan")).toBeLessThan(prev);
    expect(prev).toBeLessThan(deploy);
    expect(deploy).toBeLessThan(smoke);
    expect(TEXT).toContain("PREV_REVISION: ${{ steps.prev.outputs.revision }}");
    // A rollback pins traffic to the old revision by name; the next deploy unpins it.
    expect(script("Deploy to Cloud Run")).toContain('--region "$REGION" --to-latest');
    expect(script("Deploy to Cloud Run")).toContain('SENTRY_RELEASE="planning-poker@${RELEASE_TAG#v}"');

    const { env, dir } = fakes();
    const traffic = { status: { traffic: [{ latestRevision: true, percent: 100, revisionName: "pp-00056" }] } };
    let r = run("Remember the serving revision", dir, { ...env, FAKE_JSON: JSON.stringify(traffic) });
    expect(r.status, r.log).toBe(0);
    expect(r.vars.revision).toBe("pp-00056");
    r = run("Remember the serving revision", dir, { ...env, FAKE_JSON: "" });
    expect(r.status, r.log).toBe(0);
    expect(r.vars.revision).toBe("");
  });

  it.each([
    ["200", "pp-00056", true, false],
    ["500", "pp-00056", false, true],
    ["000", "", false, false],
  ])("main page %s, previous revision '%s'", (code, prev, ok, rollback) => {
    const { env, log, dir } = fakes();
    const r = run("Smoke check (roll back on failure)", dir, { ...env, FAKE_CODE: code, PREV_REVISION: prev });
    expect(r.status === 0, r.log).toBe(ok);
    expect(readFileSync(log, "utf-8").includes("--to-revisions pp-00056=100")).toBe(rollback);
    if (!ok) expect(r.stdout).toContain("::error::");
  });
});
