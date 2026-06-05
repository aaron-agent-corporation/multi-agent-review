import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runProtocol } from "../src/protocol/engine.js";
import * as gate from "../src/protocol/gate.js";
import type { MarConfig } from "../src/schema/config.js";
import { createRun } from "../src/workspace/manifest.js";

vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");

const PHASE_KINDS = ["draft", "review", "response", "evaluation", "integration", "validation"];

let workdir: string;
let runDir: string;
let inputPath: string;

function baseConfig(agents: MarConfig["agents"]): MarConfig {
  return {
    agents,
    defaults: { timeoutMs: 30_000, retries: 0 },
  } as MarConfig;
}

beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), "mar-engine-"));
  runDir = join(workdir, "runs", "20260604-test01");
  inputPath = join(workdir, "input.md");
  writeFileSync(inputPath, "# document under review\n\nA proposal.\n", "utf8");
  // The engine's contract: the run is already created (the CLI does this before delegating).
  await createRun({ runDir, runId: "20260604-test01", status: "running" });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

it("drives a 2-vendor roster through all 6 phases -> status completed, one artifact per agent per kind", async () => {
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
    { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
  ]);

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).toBe(0);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("completed");

  const kinds = manifest.artifacts.map((a: { kind: string }) => a.kind);
  // REVW-04: every phase writes one artifact per surviving agent (2) EXCEPT integration, which is
  // written by exactly ONE integrator. So 2×5 + 1 = 11 artifacts.
  for (const phase of PHASE_KINDS) {
    const expected = phase === "integration" ? 1 : 2;
    expect(kinds.filter((k: string) => k === phase).length).toBe(expected);
  }
  expect(manifest.artifacts.length).toBe(11);
});

it("gates each phase on EXACTLY the paths the fan-out wrote (gated == written, source of truth)", async () => {
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
    { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
  ]);

  const calls: string[][] = [];
  const spy = vi.spyOn(gate, "requiredArtifactsExist").mockImplementation((paths: string[]) => {
    calls.push([...paths]);
    return paths.every((p) => existsSync(p) && readFileSync(p).length > 0);
  });

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).toBe(0);
  expect(spy).toHaveBeenCalledTimes(6); // one gate check per phase

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  // Group manifest artifact ABSOLUTE paths by kind, in phase order.
  for (let i = 0; i < PHASE_KINDS.length; i++) {
    const kind = PHASE_KINDS[i];
    const writtenForPhase = manifest.artifacts
      .filter((a: { kind: string }) => a.kind === kind)
      .map((a: { path: string }) => join(runDir, a.path))
      .sort();
    const gated = [...calls[i]].sort();
    expect(gated).toEqual(writtenForPhase); // gated == written, same length, same paths
    for (const p of gated) expect(existsSync(p)).toBe(true);
  }
});

it("draft phase scopes each agent's cwd; drafts promoted to shared/ only after draft", async () => {
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
    { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
  ]);

  await runProtocol(runDir, config, inputPath);

  // Each agent got its own scoped workdir seeded with input.md.
  expect(existsSync(join(runDir, "work", "claude", "input.md"))).toBe(true);
  expect(existsSync(join(runDir, "work", "codex", "input.md"))).toBe(true);
  // A peer's draft must NOT appear in the other agent's workdir during drafting.
  const claudeDir = readdirSync(join(runDir, "work", "claude"));
  expect(claudeDir).not.toContain("001-codex-draft.md");
  // After draft, shared/ contains BOTH promoted drafts.
  const shared = readdirSync(join(runDir, "shared"));
  expect(shared).toContain("001-claude-draft.md");
  expect(shared).toContain("001-codex-draft.md");
});

it("a failed agent leaving <2 distinct vendors fails the run -> status failed, does NOT advance", async () => {
  // Two agents, codex points at a non-existent binary: its turn fails, leaving only claude — a
  // SINGLE distinct vendor. applySkipFailed re-asserts the >=2-distinct-vendor invariant over the
  // survivors and throws, so the run fails (dropping must NEVER produce a single-vendor review).
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
    { name: "codex", vendor: "codex", bin: "/nonexistent/definitely-not-here-xyz" },
  ]);

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).not.toBe(0);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("failed");
  // Only the survivor's draft was written; the run did NOT advance to review.
  const kinds = manifest.artifacts.map((a: { kind: string }) => a.kind);
  expect(kinds.filter((k: string) => k === "draft").length).toBe(1);
  expect(kinds).not.toContain("review");
});

it("D-30 skip-failed: a draft-phase failure with >=2 survivors completes on the surviving roster", async () => {
  // Three agents: gemini fails (its bin does not exist), claude+codex succeed. applySkipFailed
  // drops gemini (2 distinct vendors survive), the run advances, and ALL 6 phases complete over
  // the surviving 2-agent roster. This is the live-checkpoint defect fixed: a headless-auth gemini
  // failure must no longer doom the whole run.
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
    { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
    { name: "gemini", vendor: "gemini", bin: "/nonexistent/definitely-not-here-xyz" },
  ]);

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).toBe(0);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("completed");

  // The drop is recorded in the audit trail (never silent): gemini, in the draft phase.
  expect(manifest.droppedAgents.length).toBe(1);
  expect(manifest.droppedAgents[0].agent).toBe("gemini");
  expect(manifest.droppedAgents[0].vendor).toBe("gemini");
  expect(manifest.droppedAgents[0].phase).toBe("draft");

  // All 6 kinds present over the surviving 2-agent roster — gemini never appears. 2 per kind except
  // integration (1 integrator, REVW-04): 2×5 + 1 = 11.
  const kinds = manifest.artifacts.map((a: { kind: string }) => a.kind);
  for (const phase of PHASE_KINDS) {
    const expected = phase === "integration" ? 1 : 2;
    expect(kinds.filter((k: string) => k === phase).length).toBe(expected);
  }
  expect(manifest.artifacts.length).toBe(11);
  expect(manifest.artifacts.some((a: { agent: string }) => a.agent === "gemini")).toBe(false);
  // gemini's draft was never promoted to shared/ (only the 2 survivors').
  const shared = readdirSync(join(runDir, "shared"));
  expect(shared).not.toContain("001-gemini-draft.md");
  expect(shared.filter((n: string) => n.endsWith("-draft.md")).length).toBe(2);
});

it("CR-01: an all-timeout phase failure -> status timeout (D-17, not generic failed) + failureReason", async () => {
  // Both agents hang past timeoutMs (a never-exiting script), so EVERY failing agent's per-turn
  // reason is the literal "timeout". The terminal mapping must preserve the distinct D-17
  // `timeout` status — not collapse it into `failed` — and persist a failureReason so the
  // manifest records WHY the run died, not just that it did.
  // NOTE: a dedicated hang script (not `node fixture.mjs --hang`) because splitBin treats
  // everything after the first space as ONE preArg — a multi-arg bin string cannot work.
  const hangScript = join(workdir, "hang.mjs");
  writeFileSync(hangScript, "setInterval(() => {}, 1e9);\n", "utf8");
  const config = {
    agents: [
      { name: "claude", vendor: "claude", bin: `node ${hangScript}` },
      { name: "codex", vendor: "codex", bin: `node ${hangScript}` },
    ],
    defaults: { timeoutMs: 1_000, retries: 0 },
  } as MarConfig;

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).not.toBe(0);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("timeout"); // distinct D-17 signal, NOT "failed"
  expect(typeof manifest.failureReason).toBe("string");
  expect(manifest.failureReason.length).toBeGreaterThan(0);
  // The run never advanced: no drafts survived, nothing was promoted.
  expect(manifest.artifacts.length).toBe(0);
  expect(existsSync(join(runDir, "shared"))).toBe(false);
});
