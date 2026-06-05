// ============================================================================================
// RCRD-02 / RSLV-03 re-litigation guard e2e (Plan 05-06). The rolling shared/resolved-decisions.md
// ledger is appended as forks settle (INJECT); a later-phase position that reopens a settled decision
// is dropped with a `re-litigation` reason while the run continues (ENFORCE); per-turn prompts stay
// thin after the ledger is added (THINNESS). Hermetic — fake CLIs, zero credits (D-49).
// ============================================================================================

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import matter from "gray-matter";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DecisionRecordFrontmatter } from "../src/schema/decision-record.js";
import { ResolvedDecisionsLedger } from "../src/schema/resolved-decisions.js";

vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-relit-e2e-"));
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
  writeFileSync(
    join(workdir, "input.md"),
    "# document under review\n\nA proposal to evaluate.\n",
    "utf8",
  );
});

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

function inputPath(): string {
  return join(workdir, "input.md");
}

function onlyRunDir(): string {
  const runs = join(workdir, "runs");
  const ids = readdirSync(runs);
  expect(ids.length).toBe(1);
  return join(runs, ids[0]);
}

it("INJECT: after a fork settles, the ledger exists, validates, and is visible to a later phase", async () => {
  const echoDir = join(workdir, "echo");
  const result = await execa("npx", ["tsx", cliEntry, "run", inputPath()], {
    cwd: workdir,
    reject: false,
    env: {
      ...process.env,
      MAR_EMIT_BASE: "claude",
      // claude settles a fork at the response phase (reject-with-reason on issue 1).
      MAR_RELITIGATE_RESPONSE: "claude",
      // every later-phase invocation echoes whether the settled id is visible in the ledger.
      MAR_LEDGER_ECHO_DIR: echoDir,
      MAR_LEDGER_ECHO_ID: "response-claude-issue-1",
    },
  });
  expect(result.exitCode).toBe(0);

  const runDir = onlyRunDir();
  // The rolling ledger exists under shared/ and validates against the 05-02 schema.
  const ledgerPath = join(runDir, "shared", "resolved-decisions.md");
  expect(existsSync(ledgerPath)).toBe(true);
  const ledger = ResolvedDecisionsLedger.parse(matter(readFileSync(ledgerPath, "utf8")).data);
  const settled = ledger.decisions.find((d) => d.id === "response-claude-issue-1");
  expect(settled).toBeDefined();
  expect(settled?.resolver).toBe("convergence");

  // A later-phase fixture (integration/validation runs AFTER the response settlement) saw the id in
  // the ledger — proving the inject target is available to later phases.
  const echoFiles = readdirSync(echoDir);
  const allEchoes = echoFiles.map((f) => readFileSync(join(echoDir, f), "utf8")).join("");
  expect(allEchoes).toContain("SAW response-claude-issue-1");
});

it("ENFORCE: a later-phase position reopening a settled decision is dropped, run completes, record notes it", async () => {
  const result = await execa("npx", ["tsx", cliEntry, "run", inputPath()], {
    cwd: workdir,
    reject: false,
    env: {
      ...process.env,
      MAR_EMIT_BASE: "claude",
      // claude settles response-claude-issue-1 in the response phase…
      MAR_RELITIGATE_RESPONSE: "claude",
      // …then the integrator reopens it (addition additionRef = the settled id).
      MAR_RELITIGATE_ID: "response-claude-issue-1",
    },
  });
  // Drop + warn, NO retry — the run CONTINUES to completion (D-64).
  expect(result.exitCode).toBe(0);

  const runDir = onlyRunDir();
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("completed");

  // The re-litigation drop sidecar records the violation.
  const dropsPath = join(runDir, "shared", "relitigation-drops.json");
  expect(existsSync(dropsPath)).toBe(true);
  const drops = JSON.parse(readFileSync(dropsPath, "utf8"));
  expect(drops.length).toBeGreaterThanOrEqual(1);
  expect(drops[0].reason).toBe("re-litigation");
  expect(drops[0].relitigatedIds).toContain("response-claude-issue-1");

  // The terminal decision record notes the violation (D-64).
  const record = DecisionRecordFrontmatter.parse(
    matter(readFileSync(join(runDir, "decision-record.md"), "utf8")).data,
  );
  expect(record.relitigationViolations.length).toBeGreaterThanOrEqual(1);
  expect(record.relitigationViolations[0].reason).toBe("re-litigation");
  expect(record.relitigationViolations[0].relitigatedIds).toContain("response-claude-issue-1");
  // The settled fork's resolver reached the record (sourced from the ledger, D-61/D-63).
  const settledInRecord = record.resolvedDecisions.find((d) => d.id === "response-claude-issue-1");
  expect(settledInRecord?.resolver).toBe("convergence");
});

it("THINNESS: per-turn prompts carry no decision content after the ledger is added (D-37/D-65)", async () => {
  const echoDir = join(workdir, "prompt-echo");
  const result = await execa("npx", ["tsx", cliEntry, "run", inputPath()], {
    cwd: workdir,
    reject: false,
    env: {
      ...process.env,
      MAR_EMIT_BASE: "claude",
      MAR_RELITIGATE_RESPONSE: "claude",
      // Echo every prompt this run sends to each fixture.
      MAR_ECHO_PROMPT_DIR: echoDir,
    },
  });
  expect(result.exitCode).toBe(0);

  const prompts = readdirSync(echoDir)
    .map((f) => readFileSync(join(echoDir, f), "utf8"))
    .join("\n");
  // The ledger digest (decision summaries, rationales, the settled id) must NOT be inlined into any
  // per-turn prompt — the prompt only ever carries the thin `[phase:<name>]` tag + a pointer.
  expect(prompts).not.toContain("response-claude-issue-1");
  expect(prompts).not.toContain("rejected issue");
  expect(prompts).not.toContain("resolved-decisions.md");
  // Format vocabulary stays out of prompts too (carried-forward thin-prompt contract).
  for (const token of ["reject-with-reason", "severity", "additionRef"]) {
    expect(prompts).not.toContain(token);
  }
});
