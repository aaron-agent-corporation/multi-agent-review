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
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// Cold `npx tsx` startup (~5s) under concurrent load can exceed the default 15s; a generous
// timeout absorbs harness startup, not a hang.
vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

// The 6 protocol phases, in order. The engine writes one artifact per agent per phase.
const PHASE_KINDS = ["draft", "review", "response", "evaluation", "integration", "validation"];

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
    env: { ...process.env },
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

  // One artifact per agent for EACH of the 6 phase kinds (2 agents × 6 phases = 12).
  const kinds = manifest.artifacts.map((a) => a.kind);
  for (const phase of PHASE_KINDS) {
    expect(kinds.filter((k) => k === phase).length).toBe(2);
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
