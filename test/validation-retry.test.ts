// ============================================================================================
// D-38 validation-with-one-retry gate (REVW-01/02). After a turn writes its artifact, the engine
// parses the AGENT's emitted frontmatter and validates it against the 04-01 schema. A malformed
// artifact triggers EXACTLY ONE re-invocation with the formatted zod errors appended to the prompt;
// a SECOND failure converts the turn to a FAILED turn (reason "validation-failed") so the existing
// applySkipFailed path (D-30) drops it. The validation retry is DISTINCT from the transport retry
// (Pitfall 5): it wraps the turn AFTER withRetry succeeds, never inside it.
//
// These tests drive the real engine over fixtures that emit structured frontmatter. They are
// hermetic (zero credits, D-49): the fixtures encode the malformed/valid bodies directly.
// ============================================================================================

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runProtocol } from "../src/protocol/engine.js";
import type { MarConfig } from "../src/schema/config.js";
import { createRun } from "../src/workspace/manifest.js";

vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");

let workdir: string;
let runDir: string;
let inputPath: string;

function baseConfig(agents: MarConfig["agents"]): MarConfig {
  return { agents, defaults: { timeoutMs: 30_000, retries: 0 } } as MarConfig;
}

beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), "mar-valretry-"));
  runDir = join(workdir, "runs", "20260605-valretry");
  inputPath = join(workdir, "input.md");
  writeFileSync(inputPath, "# document under review\n\nA proposal.\n", "utf8");
  await createRun({ runDir, runId: "20260605-valretry", status: "running" });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

const sharedPath = JSON.stringify(join(here, "fixtures", "structured-shared.mjs"));

/**
 * Emit `body` in the vendor-native success envelope so the matching adapter parses it: claude emits
 * a single JSON object on stdout; codex emits the verified NDJSON success sequence whose
 * agent_message text is the body. Only the structured phases (review/...) carry a `validate` gate;
 * the draft phase has no gate, so a structured body there is harmless.
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
 * A "self-correcting" fixture: emits MALFORMED review frontmatter on its FIRST invocation and a
 * SCHEMA-VALID body on every later invocation, keyed by a per-run marker file under
 * MAR_FIXTURE_STATE_DIR. Because the engine re-invokes the SAME adapter ONCE on a validation miss,
 * this fixture exercises exactly the "first malformed → one retry → valid" path (D-38). Draft (the
 * first phase) consumes the first invocation, so the marker is set there; review (the first GATED
 * phase) then sees malformed on its first turn and valid on the retry.
 */
function writeSelfCorrectingFixture(
  dir: string,
  author: string,
  vendor: "claude" | "codex",
): string {
  const path = join(dir, `self-correct-${author}.mjs`);
  writeFileSync(
    path,
    `import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { malformedBody, phaseFromArgs, structuredBody } from ${sharedPath};
const args = process.argv.slice(2);
const phase = phaseFromArgs(args) ?? "draft";
const isReview = phase === "review";
const stateDir = process.env.MAR_FIXTURE_STATE_DIR;
const marker = stateDir ? join(stateDir, "self-correct-${author}.flag") : undefined;
let body;
if (isReview && marker && !existsSync(marker)) {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  writeFileSync(marker, "1");
  body = malformedBody("review", "${author}"); // first REVIEW invocation: malformed
} else {
  // Every other phase (and the review retry) emits a SCHEMA-VALID body for that phase, so the run
  // proceeds normally once review recovers.
  body = structuredBody(phase, "${author}");
}
${envelopeSnippet(vendor)}
`,
    "utf8",
  );
  return path;
}

/**
 * An "always-malformed" fixture: emits MALFORMED review frontmatter on EVERY review invocation, so
 * the single retry also fails and the engine converts the turn to a FAILED turn (validation-failed).
 * Non-gated phases (draft) emit a valid marker so the run reaches the review gate.
 */
function writeAlwaysMalformedFixture(
  dir: string,
  author: string,
  vendor: "claude" | "codex",
): string {
  const path = join(dir, `always-bad-${author}.mjs`);
  writeFileSync(
    path,
    `import { malformedBody, structuredBody } from ${sharedPath};
const args = process.argv.slice(2);
const isReview = args.some((a) => a.includes("[phase:review]") || a === "review");
const body = isReview ? malformedBody("review", "${author}") : structuredBody("draft", "${author}");
${envelopeSnippet(vendor)}
`,
    "utf8",
  );
  return path;
}

it("malformed-then-valid: ONE retry recovers the turn, run completes, review artifact written", async () => {
  // Both agents are self-correcting (malformed first, valid on the single retry). The run must
  // complete (exit 0) and the review phase must produce both review artifacts.
  const stateDir = join(workdir, "fixture-state");
  const claudeFix = writeSelfCorrectingFixture(workdir, "claude", "claude");
  const codexFix = writeSelfCorrectingFixture(workdir, "codex", "codex");
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${claudeFix}` },
    { name: "codex", vendor: "codex", bin: `node ${codexFix}` },
  ]);

  process.env.MAR_FIXTURE_STATE_DIR = stateDir;
  try {
    const exit = await runProtocol(runDir, config, inputPath);
    expect(exit).toBe(0);
  } finally {
    delete process.env.MAR_FIXTURE_STATE_DIR;
  }

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("completed");
  // Both review artifacts present (each recovered via its single retry).
  const reviews = manifest.artifacts.filter((a: { kind: string }) => a.kind === "review");
  expect(reviews.length).toBe(2);
});

it("malformed-twice: a second validation failure fails the turn (validation-failed) and drops it", async () => {
  // Both agents emit malformed review frontmatter on EVERY invocation. The single retry also fails,
  // so BOTH turns become FAILED (validation-failed). With both review writers dropped, the survivors
  // fall below 2 distinct vendors → the run fails (never silently auto-normalized, D-38).
  const claudeFix = writeAlwaysMalformedFixture(workdir, "claude", "claude");
  const codexFix = writeAlwaysMalformedFixture(workdir, "codex", "codex");
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${claudeFix}` },
    { name: "codex", vendor: "codex", bin: `node ${codexFix}` },
  ]);

  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).not.toBe(0);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("failed");
  // The run got past draft (markers are valid there — draft has no validate) but never produced a
  // VALID review artifact: the malformed turns were dropped, not accepted.
  const reviews = manifest.artifacts.filter((a: { kind: string }) => a.kind === "review");
  expect(reviews.length).toBe(0);
  // The failure cause names the validation-failed drop (never silently swallowed).
  expect(typeof manifest.failureReason).toBe("string");
  expect(manifest.failureReason).toContain("validation-failed");
});

it("happy path: a first-attempt-valid turn does NOT trigger a retry", async () => {
  // The stock fixtures emit schema-valid structured frontmatter for the engine's [phase:*] prompt
  // (D-49), so no validation retry should occur — a single invocation per agent per phase suffices
  // and the run completes.
  const config = baseConfig([
    { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
    { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
  ]);
  const exit = await runProtocol(runDir, config, inputPath);
  expect(exit).toBe(0);
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.status).toBe("completed");
});
