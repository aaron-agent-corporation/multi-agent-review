// ============================================================================================
// D-40 bounded evaluation CONVERGENCE LOOP (REVW-03). runConvergence fans the surviving roster
// through repeated evaluation rounds, reads each round's evaluation artifacts back from disk, and
// exits on agreement / iteration cap / unresolvable deadlock — designating exactly ONE integrator
// (the agreed/fallback base's author, D-44). These tests drive the REAL loop over hermetic fixtures
// (zero credits, D-49) that emit per-author evaluation frontmatter with a steerable proposedBase and
// remainingDisagreements, so agreement is observed from artifact fields (A3), never model prose.
// ============================================================================================

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runConvergence } from "../src/protocol/converge.js";
import type { MarConfig } from "../src/schema/config.js";
import { createRun } from "../src/workspace/manifest.js";

let workdir: string;
let runDir: string;
let inputPath: string;

beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), "mar-converge-"));
  runDir = join(workdir, "runs", "20260605-converge");
  inputPath = join(workdir, "input.md");
  writeFileSync(inputPath, "# document under review\n\nA proposal.\n", "utf8");
  await createRun({ runDir, runId: "20260605-converge", status: "running" });
});

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

/**
 * Emit `body` in the vendor-native success envelope so the matching adapter parses it: claude emits
 * a single JSON object on stdout; codex emits the verified NDJSON success sequence whose
 * agent_message text is the body. (Mirrors validation-retry.test.ts's envelopeSnippet.)
 */
function envelopeSnippet(vendor: "claude" | "codex"): string {
  if (vendor === "codex") {
    return `process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "t" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { id: "i0", type: "agent_message", text: body } }) + "\\n");
process.stdout.write(JSON.stringify({ type: "turn.completed", usage: {} }) + "\\n");
process.exit(0);`;
  }
  return `process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: body, session_id: "x", total_cost_usd: 0, duration_ms: 5, usage: {}, modelUsage: {} }));
process.exit(0);`;
}

/**
 * Write an evaluation-emitting fixture CLI. For ANY invocation it emits a schema-valid
 * EvaluationFrontmatter whose `proposedBase` and `remainingDisagreements` are fixed by the args
 * below — every round emits the SAME stance (so the loop's exit is driven by stance, not noise). The
 * frontmatter `round` is a constant 1 (the schema only requires a positive int; the loop
 * disambiguates rounds by artifact KIND on disk, not the frontmatter round field). The body is
 * wrapped in the agent's vendor-native success envelope so the matching adapter parses it.
 */
function writeEvalFixture(
  dir: string,
  author: string,
  vendor: "claude" | "codex",
  proposedBase: string,
  disagreements: string[],
): string {
  const path = join(dir, `eval-${author}.mjs`);
  const dis = JSON.stringify(disagreements);
  const front = [
    "phase: evaluation",
    `author: ${author}`,
    "round: 1",
    `proposedBase: ${proposedBase}`,
    `remainingDisagreements: ${dis}`,
  ].join("\\n");
  writeFileSync(
    path,
    `const body = \`---\\n${front}\\n---\\n\\n# Evaluation by ${author}\\n\`;
${envelopeSnippet(vendor)}
`,
    "utf8",
  );
  return path;
}

function baseConfig(agents: MarConfig["agents"], convergenceCap: number): MarConfig {
  return {
    agents,
    defaults: { timeoutMs: 30_000, retries: 0, convergenceCap },
  } as MarConfig;
}

function input(config: MarConfig) {
  return { runDir, config, inputPath };
}

it("agreement round 1: all survivors share proposedBase, no disagreements -> agreed, integrator = base author", async () => {
  // Both agents propose 'claude' as the base with NO open disagreements -> the agreement guard (A3)
  // fires on round 1; the integrator is the base's author (D-44).
  const claudeFix = writeEvalFixture(workdir, "claude", "claude", "claude", []);
  const codexFix = writeEvalFixture(workdir, "codex", "codex", "claude", []);
  const config = baseConfig(
    [
      { name: "claude", vendor: "claude", bin: `node ${claudeFix}` },
      { name: "codex", vendor: "codex", bin: `node ${codexFix}` },
    ],
    10,
  );

  const result = await runConvergence(config.agents, input(config));
  expect(result.status).toBe("agreed");
  expect(result.base).toBe("claude");
  expect(result.integrator).toBe("claude"); // D-44: integrator IS the base author
  expect(result.rounds).toBe(1);
  expect(result.openDecision).toBeUndefined();
});

it("cap reached: agents never agree (distinct bases, no open disagreements) -> escalate with fallback base + open decision", async () => {
  // Each agent proposes ITSELF as base with NO disagreements: never unanimous (distinct bases), but
  // no open disagreement means the unresolvable-deadlock guard never fires -> the loop runs to the
  // cap and escalates (O-2 (a)): a fallback base is chosen and an open decision is logged.
  const cap = 3;
  const claudeFix = writeEvalFixture(workdir, "claude", "claude", "claude", []);
  const codexFix = writeEvalFixture(workdir, "codex", "codex", "codex", []);
  const config = baseConfig(
    [
      { name: "claude", vendor: "claude", bin: `node ${claudeFix}` },
      { name: "codex", vendor: "codex", bin: `node ${codexFix}` },
    ],
    cap,
  );

  const result = await runConvergence(config.agents, input(config));
  expect(result.status).toBe("escalated");
  expect(result.rounds).toBe(cap); // ran to the cap, never agreed
  expect(["claude", "codex"]).toContain(result.base); // most-supported fallback base (O-2 (a))
  expect(result.integrator).toBe(result.base); // fallback integrator IS the fallback base author
  expect(result.openDecision?.reason).toMatch(/cap/i); // fork flagged for human review (D-42)
});

it("unresolvable deadlock: agents split on conflicting bases with a stable open disagreement -> escalate before the cap", async () => {
  // Each agent proposes ITSELF and carries a non-empty, STABLE disagreement that never shrinks. Two
  // consecutive stuck rounds trip the unresolvable-deadlock guard (D-41b) and escalate BEFORE the
  // cap — proving the explicit-deadlock exit is distinct from the cap backstop.
  const cap = 10; // high cap so the deadlock guard (not the cap) is what exits
  const claudeFix = writeEvalFixture(workdir, "claude", "claude", "claude", ["scope-of-section-3"]);
  const codexFix = writeEvalFixture(workdir, "codex", "codex", "codex", ["scope-of-section-3"]);
  const config = baseConfig(
    [
      { name: "claude", vendor: "claude", bin: `node ${claudeFix}` },
      { name: "codex", vendor: "codex", bin: `node ${codexFix}` },
    ],
    cap,
  );

  const result = await runConvergence(config.agents, input(config));
  expect(result.status).toBe("escalated");
  expect(result.rounds).toBeLessThan(cap); // exited via deadlock, not the cap
  expect(result.openDecision?.reason).toMatch(/unresolvable|deadlock/i);
  expect(["claude", "codex"]).toContain(result.base); // still yields a usable fallback base
});
