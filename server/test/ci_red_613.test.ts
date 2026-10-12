import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { REPO_ROOT } from "../../scripts/changelog.js";

// SERBITO-613: a red run on main or on a release tag opens (or updates) ONE Jira issue in
// SERBITO. ci-red.yml listens to the other workflows by name, so the list must follow
// .github/workflows. Its step script runs here as-is against fake gh and curl.

const DIR = join(REPO_ROOT, ".github/workflows");
const FILES = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const TEXT = readFileSync(join(DIR, "ci-red.yml"), "utf-8");
const LINES = TEXT.split("\n");

/** The workflow's name and the top-level keys of its `on:` block. */
function workflow(file: string): { name: string; triggers: string[] } {
  const text = readFileSync(join(DIR, file), "utf-8");
  const name = /^name: (.+)$/m.exec(text)![1].trim();
  const lines = text.split("\n");
  const triggers: string[] = [];
  for (const l of lines.slice(lines.indexOf("on:") + 1)) {
    if (/^\S/.test(l)) break;
    const m = /^ {2}(\w+):/.exec(l);
    if (m) triggers.push(m[1]);
  }
  return { name, triggers };
}

describe("ci-red.yml", () => {
  it("listens to every workflow that runs outside pull requests", () => {
    const listed = /^ {4}workflows: \[(.+)\]$/m
      .exec(TEXT)![1]
      .split(",")
      .map((s) => s.trim());
    const expected = FILES.filter((f) => f !== "ci-red.yml")
      .map(workflow)
      .filter((w) => w.triggers.some((t) => t !== "pull_request"))
      .map((w) => w.name);
    expect(new Set(listed)).toEqual(new Set(expected));
    expect(listed).toHaveLength(expected.length);
    expect(listed).toEqual(expect.arrayContaining(["CI", "Deploy to Cloud Run"]));
    expect(workflow("ci-red.yml").triggers).toEqual(["workflow_run"]);
  });

  it("CI runs on pushes to main: the release gate needs a run for the released commit", () => {
    const ci = readFileSync(join(DIR, "ci.yml"), "utf-8");
    expect(workflow("ci.yml").triggers).toEqual(["pull_request", "push"]);
    expect(ci).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
  });

  it("alerts only on failures of main and tag runs, not on pull requests", () => {
    const cond = /^ {4}if: >-\n((?: {6}.+\n)+)/m.exec(TEXT)![1];
    for (const part of [
      "github.event.workflow_run.conclusion == 'failure'",
      "github.event.workflow_run.event != 'pull_request'",
      "github.event.workflow_run.head_repository.full_name == github.repository",
      "github.event.workflow_run.head_branch == 'main'",
      "startsWith(github.event.workflow_run.head_branch, 'v')",
    ]) {
      expect(cond).toContain(part);
    }
  });

  it("runs no third-party code and reads only the run's jobs and logs", () => {
    expect(TEXT).not.toMatch(/^\s*(-\s+)?uses:/m);
    expect(TEXT).toMatch(/^permissions: \{\}$/m);
    expect(TEXT).toMatch(/^ {4}permissions:\n {6}actions: read # .+\n {4}steps:$/m);
  });
});

/** The step's run script (indented 10 spaces under `run: |`). */
function script(): string {
  const runAt = LINES.indexOf("        run: |");
  const body: string[] = [];
  for (const l of LINES.slice(runAt + 1)) {
    if (l.trim() && !l.startsWith(" ".repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join("\n");
}

/** Runs the step with fake gh / curl. `search` is the Jira search answer. */
function runStep(env: Record<string, string>, search = '{"issues": []}') {
  const dir = mkdtempSync(join(tmpdir(), "pp-cired-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "search.json"), search);
  // gh api ... --jq: the answer after the filter; gh run view --log-failed: "job<TAB>step<TAB>line".
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh
case "$1" in
  api) printf '%s\\n' "$*" >> "${dir}/gh-calls"; echo "verify / npm test" ;;
  run) printf '%s\\n' "$*" >> "${dir}/gh-calls"
       printf 'verify\\tnpm test\\t2026-10-12T10:00:00.0000000Z setup ok\\n'
       printf 'verify\\tnpm test\\t2026-10-12T10:00:01.0000000Z \\033[31mFAIL\\033[0m test/x.test.ts > boom\\n'
       printf 'verify\\tnpm test\\t2026-10-12T10:00:02.0000000Z AssertionError: expected 1 to be 2\\n' ;;
esac
`,
  );
  // curl: records the URL and the JSON body, answers by endpoint.
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
for a in "$@"; do url="$a"; done
n=$(ls "${dir}" | grep -c '^req-.*url$' || true)
cat > "${dir}/req-$n.json"
echo "$url" > "${dir}/req-$n.url"
case "$url" in
  */search/jql) cat "${dir}/search.json" ;;
  */comment) echo '{"id": "1"}' ;;
  */issue) echo '{"key": "SERBITO-999"}' ;;
esac
`,
  );
  for (const f of ["gh", "curl"]) chmodSync(join(bin, f), 0o755);
  const step = join(dir, "step.sh");
  writeFileSync(step, script());
  const r = spawnSync("bash", ["-e", "-o", "pipefail", step], {
    cwd: dir,
    encoding: "utf-8",
    env: {
      PATH: [bin, process.env.PATH].join(delimiter),
      JIRA_SITE: "https://serbito.atlassian.net",
      JIRA_EMAIL: "bot@example.com",
      JIRA_API_TOKEN: "t0ken",
      GH_TOKEN: "x",
      REPO: "alxndr-bnd/planning-poker",
      RUN_ID: "42",
      RUN_ATTEMPT: "1",
      RUN_URL: "https://github.com/alxndr-bnd/planning-poker/actions/runs/42",
      WORKFLOW: "CI",
      HEAD_BRANCH: "main",
      HEAD_SHA: "0123456789abcdef0123456789abcdef01234567",
      EVENT: "push",
      ...env,
    },
  });
  const req = (i: number) => ({
    url: readFileSync(join(dir, `req-${i}.url`), "utf-8").trim(),
    body: JSON.parse(readFileSync(join(dir, `req-${i}.json`), "utf-8")),
  });
  return { r, dir, req };
}

describe("ci-red.yml step script", () => {
  it("without the Jira secrets: a notice and a green end, no calls", () => {
    const { r, dir } = runStep({ JIRA_EMAIL: "", JIRA_API_TOKEN: "" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("::notice::JIRA_EMAIL / JIRA_API_TOKEN are not set");
    expect(existsSync(join(dir, "gh-calls"))).toBe(false);
    expect(existsSync(join(dir, "req-0.url"))).toBe(false);
  });

  it("no open issue: creates one Bug, Highest, labels ci-red + bug, with the error lines", () => {
    const { r, req } = runStep({});
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const search = req(0);
    expect(search.url).toBe("https://serbito.atlassian.net/rest/api/3/search/jql");
    expect(search.body.jql).toContain('labels = "ci-red"');
    expect(search.body.jql).toContain("statusCategory != Done");
    const create = req(1);
    expect(create.url).toBe("https://serbito.atlassian.net/rest/api/2/issue");
    const f = create.body.fields;
    expect([f.project.key, f.issuetype.name, f.priority.name]).toEqual([
      "SERBITO",
      "Bug",
      "Highest",
    ]);
    expect(f.labels).toEqual(["ci-red", "bug"]);
    expect(f.summary).toBe("CI red: planning-poker / CI");
    expect(f.description).toContain(
      "[CI #42|https://github.com/alxndr-bnd/planning-poker/actions/runs/42]",
    );
    expect(f.description).toContain("verify / npm test");
    expect(f.description).toContain("FAIL test/x.test.ts > boom"); // no timestamp, no colour
    expect(f.description).toContain("AssertionError: expected 1 to be 2");
    expect(f.description).not.toContain("setup ok");
    expect(f.description).not.toContain("\u001b[");
    expect(r.stdout).toContain(
      "::notice::Red run opened https://serbito.atlassian.net/browse/SERBITO-999",
    );
  });

  it("an open issue for the same repo + workflow: a comment, no new issue", () => {
    const search = JSON.stringify({
      issues: [
        { key: "SERBITO-7", fields: { summary: "CI red: planning-poker / Deploy to Cloud Run" } },
        { key: "SERBITO-8", fields: { summary: "CI red: planning-poker / CI" } },
      ],
    });
    const { r, dir, req } = runStep({}, search);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const comment = req(1);
    expect(comment.url).toBe("https://serbito.atlassian.net/rest/api/2/issue/SERBITO-8/comment");
    expect(comment.body.body).toMatch(/^Red again\.\n\n\*Red run:\*/);
    expect(existsSync(join(dir, "req-2.url"))).toBe(false);
  });
});
