import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expectedParticipantCount,
  expectedPhaseArtifacts,
  requiredArtifactsExist,
} from "../src/protocol/gate.js";
import { PHASES, type Phase } from "../src/protocol/phases.js";
import type { AgentEntry } from "../src/schema/config.js";

const ROSTER_2: AgentEntry[] = [
  { name: "claude", vendor: "claude" },
  { name: "codex", vendor: "codex" },
];
const ROSTER_3: AgentEntry[] = [
  { name: "claude", vendor: "claude" },
  { name: "codex", vendor: "codex" },
  { name: "gemini", vendor: "gemini" },
];

describe("PHASES descriptor", () => {
  it("has exactly the 6 phases in order, only draft scoped, only integration 'integrator'", () => {
    expect(PHASES.map((p) => p.name)).toEqual([
      "draft",
      "review",
      "response",
      "evaluation",
      "integration",
      "validation",
    ]);
    // kind === name for every phase (the kind feeds artifactName(seq, agent, kind)).
    for (const p of PHASES) {
      expect(p.kind).toBe(p.name);
    }
    // Every phase EXCEPT integration is participants:"all"; integration flips to "integrator".
    for (const p of PHASES) {
      if (p.name === "integration") expect(p.participants).toBe("integrator");
      else expect(p.participants).toBe("all");
    }
    // Only "draft" is scoped (PROT-04 independence boundary).
    const scoped = PHASES.filter((p) => p.scoped);
    expect(scoped.map((p) => p.name)).toEqual(["draft"]);
  });

  it("every phase carries a thin prompt; format tokens live in the instruction file, not prompts", () => {
    for (const p of PHASES) {
      const prompt = p.prompt({ inputPath: "/runs/x/input.md", phaseName: p.name });
      expect(prompt.length).toBeGreaterThan(0);
      // Anti-Pattern: the format contract (severities, verdicts, frontmatter keys) must NOT be
      // stuffed into the prompt — it lives in the seeded instruction file (04-02).
      for (const token of [
        "P1",
        "P2",
        "P3",
        "severity",
        "accept",
        "reject-with-reason",
        "refine",
      ]) {
        expect(prompt).not.toContain(token);
      }
    }
  });

  it("structured phases (review/response/evaluation/integration) carry a validate; draft/validation omit it", () => {
    const byName = Object.fromEntries(PHASES.map((p) => [p.name, p]));
    for (const name of ["review", "response", "evaluation", "integration"]) {
      expect(typeof byName[name].validate).toBe("function");
    }
    expect(byName.draft.validate).toBeUndefined();
    expect(byName.validation.validate).toBeUndefined();
  });

  it("review validate accepts schema-valid frontmatter and rejects malformed with formatted errors", () => {
    const review = PHASES.find((p) => p.name === "review");
    if (!review?.validate) throw new Error("review phase must define validate");
    expect(
      review.validate({
        phase: "review",
        author: "claude",
        targets: "codex",
        issues: [{ n: 1, severity: "P1", question: "why?" }],
      }),
    ).toEqual({ ok: true });
    const bad = review.validate({
      phase: "review",
      author: "claude",
      targets: "codex",
      issues: [{ n: 1, severity: "P9", question: "why?" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toMatch(/severity/);
  });
});

describe("requiredArtifactsExist", () => {
  let dir: string;
  let full: string;
  let empty: string;
  let missing: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mar-gate-"));
    full = join(dir, "001-claude-draft.md");
    empty = join(dir, "002-codex-draft.md");
    missing = join(dir, "003-gemini-draft.md");
    writeFileSync(full, "# content\n", "utf8");
    writeFileSync(empty, "", "utf8"); // 0-byte
    // `missing` deliberately not written.
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("returns true only when EVERY supplied path isDone (exists AND non-empty)", () => {
    expect(requiredArtifactsExist([full])).toBe(true);
  });

  it("returns false when a supplied path is missing", () => {
    expect(requiredArtifactsExist([full, missing])).toBe(false);
  });

  it("empty artifact: a 0-byte path in the list returns false (size>0 belt-and-suspenders, Pitfall 3)", () => {
    expect(requiredArtifactsExist([full, empty])).toBe(false);
  });

  it("WR-03: returns FALSE for an empty list (fails closed, not vacuously true)", () => {
    // A zero-survivor / zero-written-path phase must NOT satisfy the gate. `[].every(...)` would be
    // vacuously true and let an agent-less run advance (`true && 0 === 0`); the explicit non-empty
    // guard makes a degenerate empty phase fail closed.
    expect(requiredArtifactsExist([])).toBe(false);
  });
});

describe("expectedPhaseArtifacts (derivation helper — tests/diagnostics only)", () => {
  it("returns one path per agent named <seq>-<agent>-<phase.kind>.md from an explicit seq map", () => {
    const phase: Phase = PHASES[1]; // review
    const seqByAgent: Record<string, number> = { claude: 4, codex: 5 };
    const runDir = "/runs/abc";
    expect(expectedPhaseArtifacts(phase, ROSTER_2, seqByAgent, runDir)).toEqual([
      join(runDir, "004-claude-review.md"),
      join(runDir, "005-codex-review.md"),
    ]);
  });
});

describe("expectedParticipantCount", () => {
  it("returns roster.length for every 'all' phase across 2- and 3-agent rosters", () => {
    for (const phase of PHASES.filter((p) => p.participants === "all")) {
      expect(expectedParticipantCount(phase, ROSTER_2)).toBe(2);
      expect(expectedParticipantCount(phase, ROSTER_3)).toBe(3);
    }
  });

  it("returns 1 for the integrator phase regardless of roster size (REVW-04 single writer)", () => {
    const integration = PHASES.find((p) => p.name === "integration");
    if (!integration) throw new Error("integration phase must exist");
    expect(integration.participants).toBe("integrator");
    expect(expectedParticipantCount(integration, ROSTER_2)).toBe(1);
    expect(expectedParticipantCount(integration, ROSTER_3)).toBe(1);
  });

  it("returns 1 for a synthetic participants:'integrator' phase and roster.length for 'all'", () => {
    const synthAll = { ...PHASES[1], participants: "all" } as Phase;
    const synthIntegrator = { ...PHASES[1], participants: "integrator" } as Phase;
    expect(expectedParticipantCount(synthAll, ROSTER_3)).toBe(3);
    expect(expectedParticipantCount(synthIntegrator, ROSTER_3)).toBe(1);
  });
});
