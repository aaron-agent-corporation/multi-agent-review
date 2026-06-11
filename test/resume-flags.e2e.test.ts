// ============================================================================================
// `mar resume` non-interactive gate-decision flags (Claude Code plugin spec, 2026-06-11).
// The flags are the relay surface a driver (e.g. the /mar-review skill) uses to mediate gates
// without a TTY: `--step` resumes gated with pause-and-exit (run exactly ONE phase, pause again),
// `--feedback <note>` threads a D-51 steering note into the resumed phase's prompt (persisted to
// gate-feedback/ with attribution), `--abort` ends a gate-paused run (status `failed` with a
// human-attributed cause, mirroring the interactive abort path). Also proves the arbitration
// pause-and-exit bypass: an escalated convergence under `--step` ends terminal `escalated`
// instead of blocking on a stdin ruling. Harness mirrors protocol-gating.e2e.test.ts.
// ============================================================================================

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

const PHASE_KINDS = ["draft", "review", "response", "evaluation-r1", "integration", "validation"];

let workdir: string;

function writeRoster(dir: string, defaults?: Record<string, unknown>): void {
  writeFileSync(
    join(dir, "mar.config.json"),
    `${JSON.stringify(
      {
        agents: [
          { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
          { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
        ],
        ...(defaults ? { defaults } : {}),
      },
      null,
      2,
    )}\n`,
  );
}

function writeInput(dir: string): string {
  const inputPath = join(dir, "input.md");
  writeFileSync(inputPath, "# doc under review\n\nA proposal to evaluate.\n", "utf8");
  return inputPath;
}

const RUN_ENV = { ...process.env, MAR_EMIT_BASE: "claude" };

async function mar(dir: string, args: string[], env = RUN_ENV) {
  return execa("npx", ["tsx", cliEntry, ...args], {
    cwd: dir,
    reject: false,
    env,
    stdin: "ignore",
  });
}

function singleRunDir(dir: string): string {
  const runsDir = join(dir, "runs");
  const runIds = readdirSync(runsDir);
  expect(runIds.length).toBe(1);
  return join(runsDir, runIds[0]);
}

function readManifest(runDir: string) {
  return JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
}

/** Start a gated run that pauses at the first boundary (after draft). */
async function startPausedRun(dir: string, env = RUN_ENV): Promise<string> {
  const inputPath = writeInput(dir);
  const paused = await mar(dir, ["run", inputPath, "--gated", "--pause-and-exit"], env);
  expect(paused.exitCode).toBe(0);
  const runDir = singleRunDir(dir);
  expect(readManifest(runDir).status).toBe("paused-awaiting-approval");
  return runDir;
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-resume-flags-e2e-"));
});

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

it("--step runs exactly one phase then pauses again; repeated --step walks the run to completion", async () => {
  writeRoster(workdir);
  const runDir = await startPausedRun(workdir);

  // First --step: the review phase runs (draft was completed before the pause), then the run pauses
  // again at the next boundary instead of continuing autonomously to completion.
  const stepped = await mar(workdir, ["resume", "--last", "--step"]);
  expect(stepped.exitCode).toBe(0);
  const m1 = readManifest(runDir);
  expect(m1.status).toBe("paused-awaiting-approval");
  const kinds1 = m1.artifacts.map((a: { kind: string }) => a.kind);
  expect(kinds1.filter((k: string) => k === "review")).toHaveLength(2);
  expect(kinds1.filter((k: string) => k === "response")).toHaveLength(0);

  // Walk the remaining boundaries with --step; the run must reach `completed` within the phase
  // count (bounded loop: a regression that never terminates fails the iteration cap, not the suite).
  let status = m1.status;
  for (let i = 0; i < PHASE_KINDS.length && status === "paused-awaiting-approval"; i++) {
    const r = await mar(workdir, ["resume", "--last", "--step"]);
    expect(r.exitCode).toBe(0);
    status = readManifest(runDir).status;
  }
  expect(status).toBe("completed");
  const kinds = readManifest(runDir).artifacts.map((a: { kind: string }) => a.kind);
  for (const phase of PHASE_KINDS) {
    const expected = phase === "integration" ? 1 : 2;
    expect(kinds.filter((k: string) => k === phase).length).toBe(expected);
  }
  expect(existsSync(join(runDir, "decision-record.md"))).toBe(true);
});

it("--feedback persists the D-51 note to gate-feedback/ and injects it into the resumed phase's prompt", async () => {
  writeRoster(workdir);
  const echoDir = join(workdir, "prompt-echo");
  const env = { ...RUN_ENV, MAR_ECHO_PROMPT_DIR: echoDir };
  const runDir = await startPausedRun(workdir, env);

  const note = "Focus the review on section 3 cost assumptions";
  const stepped = await mar(workdir, ["resume", "--last", "--step", "--feedback", note], env);
  expect(stepped.exitCode).toBe(0);

  // Persisted with attribution (auditable), keyed by the phase the note steered (review).
  const fbPath = join(runDir, "gate-feedback", "review.md");
  expect(existsSync(fbPath)).toBe(true);
  const fb = readFileSync(fbPath, "utf8");
  expect(fb).toContain("source: human-gate-feedback");
  expect(fb).toContain(note);

  // Injected into the resumed phase's prompt (the fixtures echo the prompt argv they received).
  const claudeLog = readFileSync(join(echoDir, "claude.log"), "utf8");
  expect(claudeLog).toContain(note);
});

it("--abort ends a gate-paused run as `failed` with a human-attributed cause; refuses non-paused runs", async () => {
  writeRoster(workdir);
  const runDir = await startPausedRun(workdir);

  const aborted = await mar(workdir, ["resume", "--last", "--abort"]);
  expect(aborted.exitCode).toBe(0);
  const m = readManifest(runDir);
  expect(m.status).toBe("failed");
  expect(m.failureReason).toContain("mar resume --abort");

  // The run is no longer paused → a second --abort must refuse (only a gate pause is abortable).
  const runId = runDir.split("/").pop() as string;
  const again = await mar(workdir, ["resume", runId, "--abort"]);
  expect(again.exitCode).toBe(2);
  expect(again.stderr).toContain("paused-awaiting-approval");
});

it("rejects --abort combined with --step/--feedback, and an empty --feedback note", async () => {
  const combo = await mar(workdir, ["resume", "--last", "--abort", "--step"]);
  expect(combo.exitCode).toBe(2);
  expect(combo.stderr).toContain("--abort cannot be combined");

  const empty = await mar(workdir, ["resume", "--last", "--feedback", "   "]);
  expect(empty.exitCode).toBe(2);
  expect(empty.stderr).toContain("non-empty note");
});

it("an escalated convergence under --step bypasses the interactive ruling and ends terminal `escalated`", async () => {
  // Each agent proposes ITSELF as base (1-1 split, no clear majority) at convergenceCap 1 → the
  // convergence loop escalates (the proven gating.test.ts recipe). Under --step (pause-and-exit,
  // no ask seam) the arbitration boundary must bypass the human ruling (like autonomous) instead
  // of throwing/blocking.
  writeRoster(workdir, { convergenceCap: 1 });
  const env = {
    ...process.env,
    MAR_EMIT_BASES: JSON.stringify({ claude: "claude", codex: "codex" }),
  };
  const runDir = await startPausedRun(workdir, env);

  let status = readManifest(runDir).status;
  // evaluation runs extra convergence rounds; allow generous headroom over the phase count.
  for (let i = 0; i < PHASE_KINDS.length + 4 && status === "paused-awaiting-approval"; i++) {
    const r = await mar(workdir, ["resume", "--last", "--step"], env);
    expect(r.exitCode).toBe(0);
    status = readManifest(runDir).status;
  }
  expect(status).toBe("escalated");
  // The decision record must keep the open decision across the post-integration pause (the
  // persisted convergence.json re-derivation): a record claiming "converged without escalation"
  // for an escalated run is the exact regression this guards.
  const record = readFileSync(join(runDir, "decision-record.md"), "utf8");
  expect(record).not.toContain("openDecisions: []");
});
