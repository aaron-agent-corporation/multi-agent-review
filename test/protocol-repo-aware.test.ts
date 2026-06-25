import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runProtocol } from "../src/protocol/engine.js";
import type { MarConfig } from "../src/schema/config.js";
import { createRun } from "../src/workspace/manifest.js";

vi.setConfig({ testTimeout: 60_000 });

let repo: string;
let runDir: string;
let inputPath: string;

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "mar-repo-aware-"));
  git(["init", "-q"]);
  git(["config", "user.email", "a@example.com"]);
  git(["config", "user.name", "A"]);
  writeFileSync(join(repo, "README.md"), "# repo\n", "utf8");
  git(["add", "README.md"]);
  git(["commit", "-qm", "init"]);
  runDir = join(repo, "runs", "repo-aware-test");
  inputPath = join(repo, "plan.md");
  writeFileSync(inputPath, "# plan\n\nReview this plan against the repo.\n", "utf8");
  await createRun({
    runDir,
    runId: "repo-aware-test",
    status: "running",
    inputPath,
    execution: {
      repoAware: true,
      sourceRepoRoot: repo,
      sourceCommit: git(["rev-parse", "HEAD"]),
      terminalMode: "headless",
      worktrees: [],
    },
  });
  process.env.MAR_EMIT_BASE = "claude";
});

afterEach(() => {
  delete process.env.MAR_EMIT_BASE;
  if (repo) rmSync(repo, { recursive: true, force: true });
});

it("runs draft turns from isolated git worktrees while shared phases stay in the run dir", async () => {
  const cwdLog = join(repo, "cwd.log");
  const fixture = join(repo, "fixture.mjs");
  writeFileSync(
    fixture,
    `
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const text = args.join("\\n");
const phase = /\\[phase:([a-z]+)\\]/.exec(text)?.[1] ?? "unknown";
const isCodex = args[0] === "exec";
const author = isCodex ? "codex" : "claude";
appendFileSync(process.env.CWD_LOG, \`\${author}|\${phase}|\${process.cwd()}\\n\`, "utf8");
if (phase === "draft") {
  writeFileSync(join(process.cwd(), \`\${author}-touch.txt\`), "isolated write\\n", "utf8");
}

function artifact(kind) {
  if (kind === "review") {
    return \`---\\nphase: review\\nauthor: \${author}\\ntargets: peer\\nissues:\\n  - n: 1\\n    severity: P1\\n    question: "Question?"\\n---\\n\\n# Review\\n\`;
  }
  if (kind === "response") {
    return \`---\\nphase: response\\nauthor: \${author}\\nreviewOf: peer-review\\nresponses:\\n  - issueRef: 1\\n    verdict: accept\\n---\\n\\n# Response\\n\`;
  }
  if (kind === "evaluation") {
    return \`---\\nphase: evaluation\\nround: 1\\nauthor: \${author}\\nproposedBase: claude\\nremainingDisagreements: []\\ncitations: []\\n---\\n\\n# Evaluation\\n\`;
  }
  if (kind === "integration") {
    return \`---\\nphase: integration\\nauthor: \${author}\\nbase: claude\\nadditions:\\n  - verdict: merged\\n    additionRef: issue-1\\n---\\n\\n# Integrated\\n\`;
  }
  return \`\${author}:\${kind}\\n\`;
}

const body = artifact(phase);
if (isCodex) {
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: body } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n");
} else {
  process.stdout.write(JSON.stringify({ is_error: false, result: body, duration_ms: 1 }));
}
`,
    "utf8",
  );
  git(["add", "fixture.mjs", "plan.md"]);
  git(["commit", "-qm", "add fixture and plan"]);
  const commit = git(["rev-parse", "HEAD"]);

  const config = {
    agents: [
      { name: "claude", vendor: "claude", bin: `node ${fixture}` },
      { name: "codex", vendor: "codex", bin: `node ${fixture}` },
    ],
    defaults: { timeoutMs: 30_000, retries: 0, convergenceCap: 10 },
  } as MarConfig;

  process.env.CWD_LOG = cwdLog;
  const exit = await runProtocol(runDir, config, inputPath, undefined, {
    env: { CWD_LOG: cwdLog, MAR_EMIT_BASE: "claude" },
    terminalMode: "headless",
    repoAware: { sourceRepoRoot: repo, sourceCommit: commit },
  });
  delete process.env.CWD_LOG;

  expect(exit).toBe(0);
  expect(existsSync(join(repo, "claude-touch.txt"))).toBe(false);
  expect(existsSync(join(repo, "codex-touch.txt"))).toBe(false);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.execution.repoAware).toBe(true);
  expect(manifest.execution.worktrees).toHaveLength(2);
  const worktrees = new Map<string, string>(
    manifest.execution.worktrees.map((entry: { agent: string; path: string }) => [
      entry.agent,
      entry.path,
    ]),
  );
  expect(existsSync(join(worktrees.get("claude") as string, "claude-touch.txt"))).toBe(true);
  expect(existsSync(join(worktrees.get("codex") as string, "codex-touch.txt"))).toBe(true);

  const rows = readFileSync(cwdLog, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const [author, phase, cwd] = line.split("|");
      return { author, phase, cwd };
    });
  const draftCwds = rows
    .filter((row) => row.phase === "draft")
    .map((row) => realpathSync(row.cwd))
    .sort();
  expect(draftCwds).toEqual(
    [worktrees.get("claude") as string, worktrees.get("codex") as string]
      .map((path) => realpathSync(path))
      .sort(),
  );
  expect(
    rows
      .filter((row) => row.phase !== "draft")
      .every((row) => realpathSync(row.cwd) === realpathSync(runDir)),
  ).toBe(true);
});
