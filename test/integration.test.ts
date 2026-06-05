// ============================================================================================
// REVW-04 / REVW-05 / RSLV-01: the integration phase fans out over EXACTLY the convergence-
// designated integrator (the agreed base's author, D-44) — exactly ONE writer — and that integrator
// emits a per-addition verdict (merged / merged-with-change / dropped) BEFORE patching, NEVER an
// auto-merge (case-study #1 anti-pattern). A proposed addition that conflicts with a resolved
// decision is DROPPED with a rationale, not merged. These tests drive the REAL engine over hermetic
// fixtures (zero credits, D-49): the convergence loop agrees on a base, the integrator fixture emits
// a mixed-verdict integration artifact, and we assert the single-writer gate + the per-addition
// verdict trail on disk.
// ============================================================================================

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runProtocol } from "../src/protocol/engine.js";
import * as gate from "../src/protocol/gate.js";
import type { MarConfig } from "../src/schema/config.js";
import { IntegrationFrontmatter } from "../src/schema/integration.js";
import { createRun } from "../src/workspace/manifest.js";

vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");

let workdir: string;
let runDir: string;
let inputPath: string;

function baseConfig(agents: MarConfig["agents"]): MarConfig {
  return { agents, defaults: { timeoutMs: 30_000, retries: 0, convergenceCap: 10 } } as MarConfig;
}

beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), "mar-integration-"));
  runDir = join(workdir, "runs", "20260605-integration");
  inputPath = join(workdir, "input.md");
  writeFileSync(inputPath, "# document under review\n\nA proposal.\n", "utf8");
  await createRun({ runDir, runId: "20260605-integration", status: "running" });
  // Pin the convergence base to "claude" so the loop AGREES on round 1 and designates the claude
  // agent as the single integrator (D-44). The integrator fixture below emits the merge artifact.
  process.env.MAR_EMIT_BASE = "claude";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MAR_EMIT_BASE;
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

/**
 * Read the integration artifact's agent frontmatter from disk. The on-disk `.md` carries the
 * engine-metadata wrapper FIRST, so we strip it (matter) and parse the agent's frontmatter from the
 * inner body (matter again, trimStart so the inner `---` is at the start) — the same double-parse the
 * convergence loop uses to read the agent's emitted frontmatter, not the engine wrapper.
 */
function readIntegrationFrontmatter(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  const outer = matter(raw);
  const inner = matter(outer.content.trimStart());
  return inner.data;
}

/**
 * An integrator fixture (claude vendor) that, for the [phase:integration] turn, emits an integration
 * artifact carrying MIXED per-addition verdicts: one `merged`, one `merged-with-change`, and one
 * `dropped` whose reason flags a conflict with an already-resolved decision (the REVW-05
 * review-before-patching contract — a conflicting addition is rejected, not auto-merged). For every
 * other phase it emits the stock schema-valid body so the run reaches integration. claude envelope
 * (single JSON object on stdout).
 */
function writeIntegratorFixture(dir: string): string {
  const path = join(dir, "integrator-claude.mjs");
  const sharedPath = JSON.stringify(join(here, "fixtures", "structured-shared.mjs"));
  writeFileSync(
    path,
    `import { phaseFromArgs, structuredBody } from ${sharedPath};
const args = process.argv.slice(2);
const phase = phaseFromArgs(args) ?? "draft";
let body;
if (phase === "integration") {
  // A reviewed merge with a per-addition verdict trail (REVW-04/05): two additions patched, one
  // DROPPED because it conflicts with a decision already resolved earlier in the run (RSLV-01: the
  // rejection carries a rationale). NOT an auto-merge — each addition is judged before patching.
  const front = [
    "phase: integration",
    "author: claude",
    "base: claude",
    "additions:",
    "  - verdict: merged",
    "    additionRef: issue-1",
    "  - verdict: merged-with-change",
    "    additionRef: issue-2",
    "    change: narrowed the scope to the empty-input case only",
    "  - verdict: dropped",
    "    additionRef: issue-3",
    "    reason: conflicts-with-resolved decision on section-3 scope",
  ].join("\\n");
  body = \`---\\n\${front}\\n---\\n\\n# Integrated document by claude\\n\\nMerged the reviewed additions into the base.\\n\`;
} else {
  body = structuredBody(phase, "claude");
}
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: body, session_id: "x", total_cost_usd: 0, duration_ms: 5, usage: {}, modelUsage: {} }));
process.exit(0);
`,
    "utf8",
  );
  return path;
}

it("integration fans out over EXACTLY the designated integrator: one writer, gate passes with 1", async () => {
  const integratorFix = writeIntegratorFixture(workdir);
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${integratorFix}` },
    { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
  ]);

  // Spy on the artifacts gate so we can confirm the integration gate ran over EXACTLY one path.
  const calls: string[][] = [];
  vi.spyOn(gate, "requiredArtifactsExist").mockImplementation((paths: string[]) => {
    calls.push([...paths]);
    return paths.every((p) => readFileSync(p).length > 0);
  });

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).toBe(0);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  // Exactly ONE integration artifact (the single integrator wrote it) — no redundant merge (REVW-04).
  const integrations = manifest.artifacts.filter((a: { kind: string }) => a.kind === "integration");
  expect(integrations.length).toBe(1);
  expect(integrations[0].agent).toBe("claude"); // the converged base author (D-44)

  // The integration gate call saw exactly one written path (Pitfall 4: the gate expects 1 writer).
  const integrationGateCall = calls.find((c) =>
    c.some((p) => p.endsWith("-claude-integration.md")),
  );
  expect(integrationGateCall).toBeDefined();
  expect(integrationGateCall?.length).toBe(1);
});

it("the integration artifact carries per-addition verdicts + a merged body (REVW-04, RSLV-01)", async () => {
  const integratorFix = writeIntegratorFixture(workdir);
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${integratorFix}` },
    { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
  ]);

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).toBe(0);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const integration = manifest.artifacts.find((a: { kind: string }) => a.kind === "integration");
  expect(integration).toBeDefined();
  const front = readIntegrationFrontmatter(join(runDir, integration.path));
  const parsed = IntegrationFrontmatter.parse(front); // schema-valid per-addition verdict trail
  expect(parsed.base).toBe("claude");
  expect(parsed.additions.length).toBe(3);
  // Each addition carries a verdict (the auditable merge decision trail, RSLV-01).
  const verdicts = parsed.additions.map((a) => a.verdict).sort();
  expect(verdicts).toEqual(["dropped", "merged", "merged-with-change"]);
});

it("an addition conflicting with a resolved decision is DROPPED with a rationale, not auto-merged", async () => {
  const integratorFix = writeIntegratorFixture(workdir);
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${integratorFix}` },
    { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
  ]);

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).toBe(0);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const integration = manifest.artifacts.find((a: { kind: string }) => a.kind === "integration");
  const parsed = IntegrationFrontmatter.parse(
    readIntegrationFrontmatter(join(runDir, integration.path)),
  );
  // The conflicting addition was REJECTED (dropped), never silently auto-merged (case-study #1
  // anti-pattern, REVW-05), and the rejection carries a rationale (RSLV-01).
  const dropped = parsed.additions.find((a) => a.verdict === "dropped");
  expect(dropped).toBeDefined();
  if (dropped?.verdict === "dropped") {
    expect(dropped.reason).toMatch(/conflicts-with-resolved/);
  }
});
