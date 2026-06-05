// ============================================================================================
// PROT-05 / RSLV-03 gating — unit + in-process engine tests via the injectable ask() seam (D-53).
//
// These drive the REAL engine (runProtocol) over the hermetic fake fixtures (D-49, zero credits)
// with gating threaded directly through `GatingOptions.ask` — the seam, so no real TTY is touched.
// Covers: autonomous (no prompt), gated approve, gated abort (no later-phase artifacts), gated
// feedback (note reaches the NEXT phase prompt only, no artifact edited), and gated arbitration of an
// escalated convergence (resolver:"human") vs. autonomous-escalation logged-without-prompt (D-42).
// The blocking prompt itself (parseGateAnswer) is unit-tested directly. The execa process-level
// paths (non-TTY bypass, pause-and-exit + resume) live in protocol-gating.e2e.test.ts.
// ============================================================================================

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ask } from "../src/protocol/engine.js";
import { runProtocol } from "../src/protocol/engine.js";
import { arbitrationLedgerEntry, injectFeedback, parseGateAnswer } from "../src/protocol/gating.js";
import { MarConfig } from "../src/schema/config.js";
import { createRun, readManifest } from "../src/workspace/manifest.js";

vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");

let workdir: string;
let prevCwd: string;

/** A 2-vendor roster pinned to the fake fixtures (no credits). */
function makeConfig(): MarConfig {
  return MarConfig.parse({
    agents: [
      { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
      { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
    ],
  });
}

async function newRun(): Promise<{ runDir: string; inputPath: string }> {
  const runDir = join(workdir, "runs", "20260605-gating");
  const inputPath = join(workdir, "input.md");
  writeFileSync(inputPath, "# doc under review\n\nA proposal.\n", "utf8");
  await createRun({ runDir, runId: "20260605-gating", status: "running", inputPath });
  return { runDir, inputPath };
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-gating-"));
  prevCwd = process.cwd();
  process.chdir(workdir); // runs/ is resolved relative to cwd by the layout helpers.
});

afterEach(() => {
  process.chdir(prevCwd);
  for (const k of ["MAR_EMIT_BASE", "MAR_EMIT_BASES", "MAR_ECHO_PROMPT_DIR"]) {
    delete process.env[k];
  }
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

// --------------------------------------------------------------------------------------------
// parseGateAnswer (the blocking prompt's pure parser).
// --------------------------------------------------------------------------------------------

describe("parseGateAnswer", () => {
  it("recognizes approve / abort and treats anything else as a feedback note", () => {
    expect(parseGateAnswer("approve")).toEqual({ kind: "approve" });
    expect(parseGateAnswer("  A ")).toEqual({ kind: "approve" });
    expect(parseGateAnswer("abort")).toEqual({ kind: "abort" });
    expect(parseGateAnswer("x")).toEqual({ kind: "abort" });
    expect(parseGateAnswer("feedback tighten the scope")).toEqual({
      kind: "feedback",
      note: "tighten the scope",
    });
    expect(parseGateAnswer("f: be concise")).toEqual({ kind: "feedback", note: "be concise" });
    // Unrecognized → the whole line becomes a feedback note (never a blind approve/abort).
    expect(parseGateAnswer("please reconsider section 2")).toEqual({
      kind: "feedback",
      note: "please reconsider section 2",
    });
  });
});

describe("injectFeedback", () => {
  it("prepends an attributed steering block above the unchanged thin prompt", () => {
    const base = "[phase:review] Review the peer drafts.";
    const out = injectFeedback(base, "focus on the empty-input case");
    expect(out).toContain("Human steering note");
    expect(out).toContain("focus on the empty-input case");
    expect(out.endsWith(base)).toBe(true); // the thin prompt is untouched below the note.
  });
  it("is a no-op for an empty note", () => {
    expect(injectFeedback("base", "   ")).toBe("base");
  });
});

// --------------------------------------------------------------------------------------------
// In-process engine runs through the ask() seam.
// --------------------------------------------------------------------------------------------

const PHASE_KINDS = ["draft", "review", "response", "evaluation-r1", "integration", "validation"];

describe("gated/autonomous engine runs via the ask() seam", () => {
  it("autonomous: completes all 6 phases and NEVER calls ask()", async () => {
    process.env.MAR_EMIT_BASE = "claude";
    const { runDir, inputPath } = await newRun();
    const ask = vi.fn<Ask>(async () => "approve");
    const code = await runProtocol(runDir, makeConfig(), inputPath, {
      mode: "autonomous",
      pauseAndExit: false,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    const manifest = await readManifest(runDir);
    expect(manifest.status).toBe("completed");
  });

  it("gated + approve at every boundary: completes the run", async () => {
    process.env.MAR_EMIT_BASE = "claude";
    const { runDir, inputPath } = await newRun();
    const ask = vi.fn<Ask>(async () => "approve");
    const code = await runProtocol(runDir, makeConfig(), inputPath, {
      mode: "gated",
      pauseAndExit: false,
      ask,
    });
    expect(code).toBe(0);
    // Five non-last phases → five boundary gates were asked (draft/review/response/eval/integration).
    expect(ask.mock.calls.length).toBeGreaterThanOrEqual(5);
    const manifest = await readManifest(runDir);
    expect(manifest.status).toBe("completed");
  });

  it("gated + abort at the 2nd boundary: stops the run with no response-phase artifacts", async () => {
    process.env.MAR_EMIT_BASE = "claude";
    const { runDir, inputPath } = await newRun();
    // Boundary 1 = after draft (next: review) → approve; boundary 2 = after review (next: response)
    // → abort. The run must stop with NO response (or later) artifacts.
    let call = 0;
    const ask = vi.fn<Ask>(async () => {
      call += 1;
      return call === 1 ? "approve" : "abort";
    });
    const code = await runProtocol(runDir, makeConfig(), inputPath, {
      mode: "gated",
      pauseAndExit: false,
      ask,
    });
    expect(code).toBe(1); // abort routes to failed → exit 1.
    const manifest = await readManifest(runDir);
    expect(manifest.status).toBe("failed");
    expect(manifest.failureReason ?? "").toContain("aborted by human");
    const kinds = manifest.artifacts.map((a) => a.kind);
    // draft + review were produced; response and everything after must NOT exist.
    expect(kinds).toContain("draft");
    expect(kinds).toContain("review");
    expect(kinds.filter((k) => k === "response")).toHaveLength(0);
    expect(kinds.filter((k) => k === "integration")).toHaveLength(0);
  });

  it("gated + feedback: the note reaches ONLY the next phase's prompt and edits no artifact", async () => {
    process.env.MAR_EMIT_BASE = "claude";
    const echoDir = join(workdir, "echo");
    process.env.MAR_ECHO_PROMPT_DIR = echoDir;
    const { runDir, inputPath } = await newRun();
    const NOTE = "ZZUNIQUEFEEDBACKZZ";
    // Boundary 1 (after draft, next: review) → feedback NOTE; every later boundary → approve.
    let call = 0;
    const ask = vi.fn<Ask>(async () => {
      call += 1;
      return call === 1 ? `feedback ${NOTE}` : "approve";
    });
    const code = await runProtocol(runDir, makeConfig(), inputPath, {
      mode: "gated",
      pauseAndExit: false,
      ask,
    });
    expect(code).toBe(0);

    // The echo log records every prompt each fixture received. The note must appear ONLY in the
    // review-phase prompt (the phase AFTER the boundary), and in NO other phase's prompt (D-51).
    const log = readFileSync(join(echoDir, "claude.log"), "utf8");
    const lines = log.split("\n").filter((l) => l.length > 0);
    const withNote = lines.filter((l) => l.includes(NOTE));
    expect(withNote.length).toBeGreaterThan(0);
    for (const l of withNote) expect(l).toContain("[phase:review]");
    // No response/evaluation/integration/validation prompt carries the note.
    const leaked = lines.filter((l) => l.includes(NOTE) && !l.includes("[phase:review]"));
    expect(leaked).toHaveLength(0);

    // Provenance: the note is recorded as gate feedback, NOT merged into any phase artifact.
    expect(existsSync(join(runDir, "gate-feedback", "review.md"))).toBe(true);
    const manifest = await readManifest(runDir);
    // The note must not have been written INTO any indexed artifact (steering, not artifact editing).
    for (const art of manifest.artifacts) {
      const body = readFileSync(join(runDir, art.path), "utf8");
      expect(body.includes(NOTE)).toBe(false);
    }
  });
});

// --------------------------------------------------------------------------------------------
// Gated arbitration of an escalated convergence (RSLV-03 / D-52).
// --------------------------------------------------------------------------------------------

describe("gated arbitration (RSLV-03 / D-52)", () => {
  it("arbitrationLedgerEntry records resolver:human with the rationale + escalation lineage", () => {
    const entry = arbitrationLedgerEntry(
      {
        base: "claude",
        integrator: "claude",
        rounds: 3,
        status: "escalated",
        concessions: [],
        openDecision: { reason: "convergence cap (3) reached" },
      },
      { base: "codex", rationale: "codex's evidence on the edge case is stronger" },
    );
    expect(entry.resolver).toBe("human");
    expect(entry.rationale).toBe("codex's evidence on the edge case is stronger");
    expect(entry.summary).toContain("codex");
    expect(entry.lineage.join(" ")).toContain("convergence cap");
  });

  it("gated escalation invokes ask() and records a resolver:human ruling on disk", async () => {
    // Force a 1-1 split at a low cap so convergence ESCALATES (D-60: no clear majority).
    process.env.MAR_EMIT_BASES = JSON.stringify({ claude: "claude", codex: "codex" });
    const { runDir, inputPath } = await newRun();
    const config = MarConfig.parse({
      agents: [
        { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
        { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
      ],
      defaults: { convergenceCap: 1 },
    });
    // Gate boundaries → approve; the arbitration prompt (free-form) → a human ruling.
    const RULING = "go with codex's framing — it cites the controlling case";
    const ask = vi.fn<Ask>(async (q: string) => (q.includes("ARBITRATION") ? RULING : "approve"));
    const code = await runProtocol(runDir, config, inputPath, {
      mode: "gated",
      pauseAndExit: false,
      ask,
    });
    expect(code).toBe(0);
    // The arbitration prompt was issued.
    expect(ask.mock.calls.some(([q]) => q.includes("ARBITRATION"))).toBe(true);
    // A human ruling was recorded with resolver:human and the rationale.
    const rulingPath = join(runDir, "human-ruling.md");
    expect(existsSync(rulingPath)).toBe(true);
    const ruling = readFileSync(rulingPath, "utf8");
    expect(ruling).toContain('resolver: "human"');
    expect(ruling).toContain(RULING);
  });

  it("autonomous escalation logs the open decision and NEVER prompts", async () => {
    process.env.MAR_EMIT_BASES = JSON.stringify({ claude: "claude", codex: "codex" });
    const { runDir, inputPath } = await newRun();
    const config = MarConfig.parse({
      agents: [
        { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
        { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
      ],
      defaults: { convergenceCap: 1 },
    });
    const ask = vi.fn<Ask>(async () => "approve");
    const code = await runProtocol(runDir, config, inputPath, {
      mode: "autonomous",
      pauseAndExit: false,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    const manifest = await readManifest(runDir);
    // Autonomous escalation → terminal `escalated`, the open decision logged, no human ruling file.
    expect(manifest.status).toBe("escalated");
    expect(existsSync(join(runDir, "human-ruling.md"))).toBe(false);
    expect(existsSync(join(runDir, "decision-record.md"))).toBe(true);
    // sanity: the run still produced its artifacts.
    const kinds = manifest.artifacts.map((a) => a.kind);
    for (const phase of PHASE_KINDS) {
      const expected = phase === "integration" ? 1 : 2;
      expect(kinds.filter((k) => k === phase).length).toBe(expected);
    }
  });
});
