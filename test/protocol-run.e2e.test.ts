// ============================================================================================
// PHASE 3 RED ANCHOR — `mar run <input>` end-to-end target.
//
// This test is INTENTIONALLY RED in Plan 03-01. It defines the Phase-3 user experience: a single
// `mar run <input>` drives a 2-vendor roster through the full 6-phase protocol and lands one
// artifact per agent for EACH phase kind in the manifest, with the run marked "completed".
//
// There is NO `run` subcommand and NO protocol engine yet — Plan 03-02 (the XState engine + the
// `mar run` CLI command) is what turns this GREEN. Until then it MUST FAIL, and the failure must
// be the assertion/command-missing failure (commander rejects the unknown `run` command → nonzero
// exit), NOT a syntax/import error in this file. Do not "fix" it here.
// ============================================================================================

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import matter from "gray-matter";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { DecisionRecordFrontmatter } from "../src/schema/decision-record.js";

// Cold `npx tsx` startup (~5s) under concurrent load can exceed the default 15s; a generous
// timeout absorbs harness startup, not a hang.
vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const fakeGemini = join(here, "fixtures", "fake-gemini.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

// The 6 protocol phases, in order. The engine writes one artifact per agent per phase.
// The evaluation phase is the bounded convergence loop (04-04): with MAR_EMIT_BASE pinned (the run
// env below) every fixture proposes the SAME base with no open disagreements, so the loop AGREES on
// round 1 → one evaluation round, written with the disambiguated kind `evaluation-r1`.
const PHASE_KINDS = ["draft", "review", "response", "evaluation-r1", "integration", "validation"];

let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-run-e2e-"));
});

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

it("mar run drives a 2-vendor roster through all 6 phases (RED anchor for Plan 03-02)", async () => {
  // A roster with TWO DISTINCT vendors (claude + codex), each injecting its fake fixture bin so
  // the run burns zero credits. >=2 distinct vendors satisfies the assertReviewable gate.
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

  const inputPath = join(workdir, "input.md");
  writeFileSync(inputPath, "# document under review\n\nA proposal to evaluate.\n", "utf8");

  // Drive the CLI end-to-end through tsx: `mar run <input>`.
  const result = await execa("npx", ["tsx", cliEntry, "run", inputPath], {
    cwd: workdir,
    reject: false,
    // Pin the convergence base so the stock fixtures agree on round 1 (terminal status `completed`,
    // not `escalated`); the cap/escalation paths are exercised in converge.test.ts.
    env: { ...process.env, MAR_EMIT_BASE: "claude" },
  });

  // A full protocol run must succeed end-to-end.
  expect(result.exitCode).toBe(0);

  const runsDir = join(workdir, "runs");
  expect(existsSync(runsDir)).toBe(true);
  const runIds = readdirSync(runsDir);
  expect(runIds.length).toBe(1);
  const runDir = join(runsDir, runIds[0]);

  // The manifest marks the run completed.
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("completed");

  // One artifact per agent for each phase EXCEPT integration, which exactly ONE integrator writes
  // (REVW-04): 2 agents × 5 phases + 1 integrator = 11.
  const kinds = manifest.artifacts.map((a) => a.kind);
  for (const phase of PHASE_KINDS) {
    const expected = phase === "integration" ? 1 : 2;
    expect(kinds.filter((k) => k === phase).length).toBe(expected);
  }
});

it("mar run drives a 3-vendor roster through all 6 phases and produces a decision record (success criterion #1, D-49)", async () => {
  // The full v1 success bar, proven hermetically: THREE distinct vendors (claude + codex + gemini),
  // each injecting its fake fixture bin so the run burns zero credits. Every fixture emits
  // schema-valid structured artifacts across all 6 phases via the engine's `[phase:<name>]` tag, and
  // MAR_EMIT_BASE pins a common proposedBase so the convergence loop AGREES on round 1.
  const threeVendorDir = mkdtempSync(join(tmpdir(), "mar-run-3vendor-"));
  try {
    writeFileSync(
      join(threeVendorDir, "mar.config.json"),
      `${JSON.stringify(
        {
          agents: [
            { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
            { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
            { name: "gemini", vendor: "gemini", bin: `node ${fakeGemini}` },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const inputPath = join(threeVendorDir, "input.md");
    writeFileSync(inputPath, "# document under review\n\nA three-agent proposal.\n", "utf8");

    const result = await execa("npx", ["tsx", cliEntry, "run", inputPath], {
      cwd: threeVendorDir,
      reject: false,
      // Pin the convergence base so all three fixtures agree on round 1 (status `completed`).
      env: { ...process.env, MAR_EMIT_BASE: "claude" },
    });

    // (a) The full 3-agent run completes with status `completed`.
    expect(result.exitCode).toBe(0);

    const runsDir = join(threeVendorDir, "runs");
    const runIds = readdirSync(runsDir);
    expect(runIds.length).toBe(1);
    const runDir = join(runsDir, runIds[0]);

    const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
    expect(manifest.status).toBe("completed");

    // (b) One artifact per surviving agent per structured phase kind: 3 agents × 5 phases + 1
    // integrator (REVW-04) = 16.
    const kinds = manifest.artifacts.map((a) => a.kind);
    for (const phase of PHASE_KINDS) {
      const expected = phase === "integration" ? 1 : 3;
      expect(kinds.filter((k) => k === phase).length).toBe(expected);
    }

    // (c) The run produced a decision record that validates against DecisionRecordFrontmatter
    // (success criterion #1: the full 3-agent run yields a decision record).
    const recordPath = join(runDir, "decision-record.md");
    expect(existsSync(recordPath)).toBe(true);
    const parsed = DecisionRecordFrontmatter.safeParse(
      matter(readFileSync(recordPath, "utf8")).data,
    );
    expect(parsed.success).toBe(true);
    // The unanimous-agreement run records the merged addition + accepted responses as the tally.
    if (parsed.success) {
      expect(parsed.data.runId).toBe(manifest.runId);
      expect(parsed.data.unanimousTally).toBeGreaterThan(0);
    }
  } finally {
    rmSync(threeVendorDir, { recursive: true, force: true });
  }
});

it("refuses <2 vendors (single-vendor roster → exit 2, no run started)", async () => {
  // A single-vendor roster (two claude agents) must be refused by assertReviewable BEFORE any run
  // directory is created. `mar run` is NOT gate-exempt (unlike `mar invoke`).
  const singleVendorDir = mkdtempSync(join(tmpdir(), "mar-run-1vendor-"));
  try {
    writeFileSync(
      join(singleVendorDir, "mar.config.json"),
      `${JSON.stringify(
        {
          agents: [
            { name: "claude-a", vendor: "claude", bin: `node ${fakeClaude}` },
            { name: "claude-b", vendor: "claude", bin: `node ${fakeClaude}` },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const inputPath = join(singleVendorDir, "input.md");
    writeFileSync(inputPath, "# doc\n", "utf8");

    const result = await execa("npx", ["tsx", cliEntry, "run", inputPath], {
      cwd: singleVendorDir,
      reject: false,
      env: { ...process.env },
    });

    // (a) non-zero exit (2 — gate refusal).
    expect(result.exitCode).toBe(2);
    // (b) the >=2-distinct-vendor refusal message from assertReviewable is on stderr.
    expect(result.stderr).toContain("review needs >=2 distinct vendors");
    // (c) NO run directory was created — the gate fires BEFORE createRun.
    expect(existsSync(join(singleVendorDir, "runs"))).toBe(false);
  } finally {
    rmSync(singleVendorDir, { recursive: true, force: true });
  }
});
