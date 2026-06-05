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
  it("has exactly the 6 phases in order, only draft scoped, all participants 'all'", () => {
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
      expect(p.participants).toBe("all");
    }
    // Only "draft" is scoped (PROT-04 independence boundary).
    const scoped = PHASES.filter((p) => p.scoped);
    expect(scoped.map((p) => p.name)).toEqual(["draft"]);
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

  it("returns true for an empty list (vacuous)", () => {
    // The engine guarantees a non-empty written-paths array for any non-empty roster, so an
    // empty list only occurs for a phase with no participants — which the engine never produces
    // in Phase 3. `[].every(...)` is vacuously true; documenting the contract here.
    expect(requiredArtifactsExist([])).toBe(true);
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

describe("expectedParticipantCount all-mode", () => {
  it("returns roster.length for every PHASES entry across 2- and 3-agent rosters (all participants:'all' in Phase 3)", () => {
    for (const phase of PHASES) {
      expect(expectedParticipantCount(phase, ROSTER_2)).toBe(2);
      expect(expectedParticipantCount(phase, ROSTER_3)).toBe(3);
    }
  });
});
