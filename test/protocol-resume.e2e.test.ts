// ============================================================================================
// PROT-06 resume e2e (Plan 05-04). `mar resume <run-id>` / `mar resume --last` continues an
// interrupted/failed/paused run from its last completed phase by RE-DERIVING from the manifest
// (D-14/D-54) — never an XState snapshot (Pitfall 2). Covers: (1) interrupted resume (no phase ≤N
// artifact rewritten — seq monotonicity), (2) --last selects the most-recent resumable run,
// (3) D-56 refusals (corrupt artifact / missing artifact / preflight failure), and (4) D-57
// failed-run resume restores the FULL roster (a previously-dropped agent rejoins, Pitfall 10).
//
// Hermetic via the fake fixtures (D-49); the execa-via-tsx harness mirrors protocol-run.e2e.test.ts.
// ============================================================================================

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 240_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

let workdir: string;

function writeRoster(dir: string): void {
  writeFileSync(
    join(dir, "mar.config.json"),
    `${JSON.stringify(
      {
        agents: [
          { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
          { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
        ],
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

async function marRun(dir: string, inputPath: string, env = RUN_ENV) {
  return execa("npx", ["tsx", cliEntry, "run", inputPath], { cwd: dir, reject: false, env });
}

async function marResume(dir: string, args: string[], env = RUN_ENV) {
  return execa("npx", ["tsx", cliEntry, "resume", ...args], { cwd: dir, reject: false, env });
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

function writeManifest(runDir: string, manifest: unknown): void {
  writeFileSync(join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-resume-e2e-"));
});

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

it("resumes an interrupted run from the last completed phase without rewriting prior artifacts (D-54, seq monotonicity)", async () => {
  writeRoster(workdir);
  const inputPath = writeInput(workdir);

  // 1. Drive a full run to produce a valid artifact trail + manifest.
  const first = await marRun(workdir, inputPath);
  expect(first.exitCode).toBe(0);
  const runDir = singleRunDir(workdir);

  // 2. Simulate interruption: truncate the run back to the end of `response` — drop the
  //    evaluation/integration/validation artifacts + the decision record, and reset status to
  //    `running`. The kept phases (draft/review/response) are the "phase ≤ N" trail resume must NOT
  //    rewrite.
  const manifest = readManifest(runDir);
  const keepKinds = new Set(["draft", "review", "response"]);
  const dropped = manifest.artifacts.filter((a: { kind: string }) => !keepKinds.has(a.kind));
  manifest.artifacts = manifest.artifacts.filter((a: { kind: string }) => keepKinds.has(a.kind));
  manifest.status = "running";
  writeManifest(runDir, manifest);
  for (const a of dropped) rmSync(join(runDir, a.path), { force: true });
  rmSync(join(runDir, "decision-record.md"), { force: true });

  // Snapshot the kept artifacts' mtimes (seq-monotonicity proof: resume must not touch them).
  const keptPaths = manifest.artifacts.map((a: { path: string }) => join(runDir, a.path));
  const before = keptPaths.map((p: string) => statSync(p).mtimeMs);

  // 3. Resume — should re-run evaluation→integration→validation and complete.
  const runId = runDir.split("/").pop() as string;
  const resumed = await marResume(workdir, [runId]);
  expect(resumed.exitCode).toBe(0);

  const after = readManifest(runDir);
  expect(after.status).toBe("completed");
  expect(existsSync(join(runDir, "decision-record.md"))).toBe(true);

  // No phase ≤ N artifact was rewritten (mtimes unchanged).
  const afterMtimes = keptPaths.map((p: string) => statSync(p).mtimeMs);
  expect(afterMtimes).toEqual(before);

  // The completed run carries the full set of phase kinds again.
  const kinds = after.artifacts.map((a: { kind: string }) => a.kind);
  expect(kinds.filter((k: string) => k === "integration").length).toBe(1);
  expect(kinds.filter((k: string) => k === "validation").length).toBe(2);
});

it("`mar resume --last` selects the most-recent resumable run", async () => {
  writeRoster(workdir);
  const inputPath = writeInput(workdir);

  // Run A: complete then truncate to `running` (resumable).
  const a = await marRun(workdir, inputPath);
  expect(a.exitCode).toBe(0);
  const runDirA = singleRunDir(workdir);
  const mA = readManifest(runDirA);
  const keep = new Set(["draft", "review", "response"]);
  const droppedA = mA.artifacts.filter((x: { kind: string }) => !keep.has(x.kind));
  mA.artifacts = mA.artifacts.filter((x: { kind: string }) => keep.has(x.kind));
  mA.status = "running";
  // Force A older than B so "most recent" is unambiguous.
  mA.updatedAt = "2020-01-01T00:00:00.000Z";
  writeManifest(runDirA, mA);
  for (const x of droppedA) rmSync(join(runDirA, x.path), { force: true });
  rmSync(join(runDirA, "decision-record.md"), { force: true });

  // Run B: complete then truncate to `running`, with a NEWER updatedAt → --last must pick B.
  const b = await marRun(workdir, inputPath);
  expect(b.exitCode).toBe(0);
  const runIdsAfter = readdirSync(join(workdir, "runs"));
  const runIdB = runIdsAfter.find((id) => join(workdir, "runs", id) !== runDirA) as string;
  const runDirB = join(workdir, "runs", runIdB);
  const mB = readManifest(runDirB);
  const droppedB = mB.artifacts.filter((x: { kind: string }) => !keep.has(x.kind));
  mB.artifacts = mB.artifacts.filter((x: { kind: string }) => keep.has(x.kind));
  mB.status = "running";
  mB.updatedAt = "2030-01-01T00:00:00.000Z";
  writeManifest(runDirB, mB);
  for (const x of droppedB) rmSync(join(runDirB, x.path), { force: true });
  rmSync(join(runDirB, "decision-record.md"), { force: true });

  const resumed = await marResume(workdir, ["--last"]);
  expect(resumed.exitCode).toBe(0);
  // B (most recent) is now completed; A is untouched (still running).
  expect(readManifest(runDirB).status).toBe("completed");
  expect(readManifest(runDirA).status).toBe("running");
});

it("D-56: refuses resume when a completed-phase artifact's frontmatter is corrupted (specific error)", async () => {
  writeRoster(workdir);
  const inputPath = writeInput(workdir);
  const first = await marRun(workdir, inputPath);
  expect(first.exitCode).toBe(0);
  const runDir = singleRunDir(workdir);

  // Keep the FULL artifact trail (so the resume phase is the last phase, `validation`, and every
  // structured phase is "completed" → re-validated), set status to `running` (an interrupted-right-
  // before-finish run), then CORRUPT a completed review artifact's frontmatter so it fails
  // re-validation against the review schema.
  const manifest = readManifest(runDir);
  manifest.status = "running";
  writeManifest(runDir, manifest);

  const review = manifest.artifacts.find((a: { kind: string }) => a.kind === "review") as {
    path: string;
  };
  // Replace with a wrapper-then-INVALID-review-frontmatter artifact (severity P9 is out of enum).
  writeFileSync(
    join(runDir, review.path),
    "---\nagent: claude\nkind: review\n---\n\n---\nphase: review\nauthor: claude\ntargets: peer\nissues:\n  - n: 1\n    severity: P9\n    question: bad\n---\n\nbody\n",
    "utf8",
  );

  const runId = runDir.split("/").pop() as string;
  const resumed = await marResume(workdir, [runId]);
  expect(resumed.exitCode).toBe(2);
  expect(resumed.stderr).toContain("failed re-validation against the review schema");
  expect(resumed.stderr).toContain(review.path);
});

it("D-56: refuses resume when a required completed-phase artifact is missing (specific error)", async () => {
  writeRoster(workdir);
  const inputPath = writeInput(workdir);
  const first = await marRun(workdir, inputPath);
  expect(first.exitCode).toBe(0);
  const runDir = singleRunDir(workdir);

  // Keep the FULL trail recorded in the manifest, set status `running`, then DELETE a recorded
  // completed-phase artifact FILE (the manifest still lists it). Resume phase is the last phase
  // (`validation`); the missing review file belongs to a phase BEFORE it → resume must refuse.
  const manifest = readManifest(runDir);
  manifest.status = "running";
  writeManifest(runDir, manifest);

  const review = manifest.artifacts.find((a: { kind: string }) => a.kind === "review") as {
    path: string;
  };
  rmSync(join(runDir, review.path), { force: true });

  const runId = runDir.split("/").pop() as string;
  const resumed = await marResume(workdir, [runId]);
  expect(resumed.exitCode).toBe(2);
  expect(resumed.stderr).toContain("missing or empty");
  expect(resumed.stderr).toContain(review.path);
});

it("D-56: refuses resume when roster preflight fails (auth decayed) — names the agent", async () => {
  // Roster whose codex bin does not exist on PATH → preflight reports it not installed → resume
  // refuses naming it.
  writeFileSync(
    join(workdir, "mar.config.json"),
    `${JSON.stringify(
      {
        agents: [
          { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
          { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const inputPath = writeInput(workdir);
  const first = await marRun(workdir, inputPath);
  expect(first.exitCode).toBe(0);
  const runDir = singleRunDir(workdir);

  // Keep the full trail, just mark the run interrupted (`running`).
  const manifest = readManifest(runDir);
  manifest.status = "running";
  writeManifest(runDir, manifest);

  // Point codex at a non-existent bin so preflight tier-1 (install) fails.
  writeFileSync(
    join(workdir, "mar.config.json"),
    `${JSON.stringify(
      {
        agents: [
          { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
          { name: "codex", vendor: "codex", bin: "node /nonexistent/fake-codex-missing.mjs" },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const runId = runDir.split("/").pop() as string;
  const resumed = await marResume(workdir, [runId]);
  expect(resumed.exitCode).toBe(2);
  expect(resumed.stderr).toContain("preflight failed");
  expect(resumed.stderr).toContain("codex");
});

it("D-57: a failed run resumes with the FULL roster — a previously-dropped agent rejoins (Pitfall 10)", async () => {
  writeRoster(workdir);
  const inputPath = writeInput(workdir);

  // Arm the fail-once mechanism: codex emits malformed turns while the marker exists, so it is
  // dropped at the review phase → the 2-vendor floor is breached → the run FAILS.
  const marker = join(workdir, "fail-once.flag");
  writeFileSync(marker, "1");
  const failEnv = {
    ...RUN_ENV,
    MAR_FAIL_ONCE: "codex",
    MAR_FAIL_ONCE_MARKER: marker,
  };

  const first = await marRun(workdir, inputPath, failEnv);
  // Dropping codex leaves a single-vendor roster → assertReviewable floor breach → non-zero exit.
  expect(first.exitCode).not.toBe(0);
  const runDir = singleRunDir(workdir);
  const failedManifest = readManifest(runDir);
  expect(failedManifest.status).toBe("failed");

  // Disarm fail-once (delete the marker) → on resume codex emits valid turns and REJOINS with the
  // FULL roster (D-57: failed-run resume restores config.agents, dropped agents get another chance).
  rmSync(marker, { force: true });
  const runId = runDir.split("/").pop() as string;
  const resumed = await marResume(workdir, [runId], failEnv);
  expect(resumed.exitCode).toBe(0);

  const after = readManifest(runDir);
  expect(after.status).toBe("completed");
  // Pitfall 10: the re-run review phase expected the LARGER (full) roster — both agents wrote review
  // artifacts on the resumed attempt, so the completed run carries 2 validation artifacts.
  const kinds = after.artifacts.map((a: { kind: string }) => a.kind);
  expect(kinds.filter((k: string) => k === "validation").length).toBe(2);
});
