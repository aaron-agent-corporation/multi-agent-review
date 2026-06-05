// ============================================================================================
// PROT-05 gating — process-level e2e via execa (the `mar run` flag surface + the non-TTY bypass).
//
// The interactive gate prompts (approve/abort/feedback/arbitration) are proven hermetically in
// gating.test.ts through the ask() seam. This file proves the PROCESS-LEVEL contracts that need a
// real spawned `mar`: (1) `--autonomous` drives all 6 phases unattended; (2) a bare `mar run` with a
// NON-TTY stdin and no mode flag NEVER prompts and completes autonomous (Pitfall 5 / T-05-15);
// (3) `--gated --pause-and-exit` writes `paused-awaiting-approval` + exits 0, and `mar resume`
// continues it to completion (D-50/D-55). Mirrors the protocol-run.e2e harness.
// ============================================================================================

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 90_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

const PHASE_KINDS = ["draft", "review", "response", "evaluation-r1", "integration", "validation"];

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

function singleRunDir(dir: string): string {
  const runsDir = join(dir, "runs");
  const runIds = readdirSync(runsDir);
  expect(runIds.length).toBe(1);
  return join(runsDir, runIds[0]);
}

function readManifest(runDir: string) {
  return JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-gating-e2e-"));
});

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

it("--autonomous drives all 6 phases unattended without prompting", async () => {
  writeRoster(workdir);
  const inputPath = writeInput(workdir);
  const result = await execa("npx", ["tsx", cliEntry, "run", inputPath, "--autonomous"], {
    cwd: workdir,
    reject: false,
    env: RUN_ENV,
    // stdin closed: if ANY prompt were issued the run would hang or EOF — proving it never prompts.
    stdin: "ignore",
  });
  expect(result.exitCode).toBe(0);
  // No mode-selection prompt was printed to stdout.
  expect(result.stdout).not.toContain("execution mode?");
  const runDir = singleRunDir(workdir);
  const manifest = readManifest(runDir);
  expect(manifest.status).toBe("completed");
  const kinds = manifest.artifacts.map((a: { kind: string }) => a.kind);
  for (const phase of PHASE_KINDS) {
    const expected = phase === "integration" ? 1 : 2;
    expect(kinds.filter((k: string) => k === phase).length).toBe(expected);
  }
});

it("non-TTY bare `mar run` (no mode flag, stdin ignored) defaults autonomous and never prompts (Pitfall 5)", async () => {
  writeRoster(workdir);
  const inputPath = writeInput(workdir);
  // NO mode flag + non-TTY stdin → must default autonomous and complete without ever prompting.
  const result = await execa("npx", ["tsx", cliEntry, "run", inputPath], {
    cwd: workdir,
    reject: false,
    env: RUN_ENV,
    stdin: "ignore",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("execution mode?");
  const runDir = singleRunDir(workdir);
  expect(readManifest(runDir).status).toBe("completed");
});

it("--gated --pause-and-exit writes paused-awaiting-approval + exits 0; `mar resume` completes it", async () => {
  writeRoster(workdir);
  const inputPath = writeInput(workdir);

  // Pause-and-exit short-circuits the gate BEFORE any prompt, so stdin can be ignored safely.
  const paused = await execa(
    "npx",
    ["tsx", cliEntry, "run", inputPath, "--gated", "--pause-and-exit"],
    { cwd: workdir, reject: false, env: RUN_ENV, stdin: "ignore" },
  );
  expect(paused.exitCode).toBe(0);

  const runDir = singleRunDir(workdir);
  const m1 = readManifest(runDir);
  expect(m1.status).toBe("paused-awaiting-approval");
  // It paused at the FIRST boundary: draft (+ no promote yet → no review). Only draft artifacts exist.
  const kinds1 = m1.artifacts.map((a: { kind: string }) => a.kind);
  expect(kinds1).toContain("draft");
  expect(kinds1.filter((k: string) => k === "review")).toHaveLength(0);

  // Resume continues it to completion (autonomous continuation — the human approved by resuming).
  const resumed = await execa("npx", ["tsx", cliEntry, "resume", "--last"], {
    cwd: workdir,
    reject: false,
    env: RUN_ENV,
    stdin: "ignore",
  });
  expect(resumed.exitCode).toBe(0);
  const m2 = readManifest(runDir);
  expect(m2.status).toBe("completed");
  const kinds2 = m2.artifacts.map((a: { kind: string }) => a.kind);
  for (const phase of PHASE_KINDS) {
    const expected = phase === "integration" ? 1 : 2;
    expect(kinds2.filter((k: string) => k === phase).length).toBe(expected);
  }
  expect(existsSync(join(runDir, "decision-record.md"))).toBe(true);
});
