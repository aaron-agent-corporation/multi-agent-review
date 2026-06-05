import type { AgentEntry } from "../schema/config.js";
import { isDone } from "../workspace/artifacts.js";
import { artifactPath } from "../workspace/layout.js";
import type { Phase } from "./phases.js";

/**
 * The artifacts-on-disk phase gate (PROT-03). PURE except for `isDone`'s stat — no spawn, no
 * mutation. Mirrors the pure-gate style of src/gates.ts.
 *
 * SINGLE SOURCE OF TRUTH (see 03-02-PLAN <objective>): this gate judges ONLY the exact path list
 * the caller hands it — the engine's fan-out actor resolves with the EXACT paths it wrote, and
 * that array is what is checked here. The gate performs NO seq computation and NO path derivation
 * of its own, so it can never check an unwritten path (no false pass/fail). It calls `isDone`
 * (exists AND size>0), never a bare existence check, so a 0-byte artifact fails (Pitfall 3).
 *
 * Empty list -> vacuously true: the engine guarantees a non-empty written-paths array for any
 * non-empty roster, so an empty list only occurs for a participant-less phase, which Phase 3
 * never produces.
 */
export function requiredArtifactsExist(writtenPaths: string[]): boolean {
  return writtenPaths.every((p) => isDone(p));
}

/**
 * DERIVATION HELPER for tests/diagnostics ONLY — NOT the live gate input. Builds the expected
 * artifact path per agent for a phase as `<seq>-<agent>-<phase.kind>.md`, taking the
 * seq-per-agent map as an EXPLICIT parameter. It deliberately does NOT compute seqs itself; the
 * engine owns seq assignment (via nextSeq) and the live gate consumes the engine's collected
 * written paths, not this derivation.
 */
export function expectedPhaseArtifacts(
  phase: Phase,
  roster: AgentEntry[],
  seqByAgent: Record<string, number>,
  runDir: string,
): string[] {
  return roster.map((a) => artifactPath(runDir, seqByAgent[a.name], a.name, phase.kind));
}

/**
 * The EXPECTED number of agents that should write `phase` (the short-write count). PURE — derives
 * NO paths and NO seqs; it answers only "how many agents are expected to write this phase". The
 * engine guard compares `writtenPaths.length` against this so a failed agent (fewer written paths
 * than expected) fails the gate.
 *
 * In Phase 3 every phase is participants==="all", so the count is unconditionally roster.length.
 * The "all" branch is explicit, leaving room for a future non-"all" count branch (e.g. a single
 * integrator in Phase 4) without touching the live gate.
 */
export function expectedParticipantCount(phase: Phase, roster: AgentEntry[]): number {
  if (phase.participants === "all") return roster.length;
  // No non-"all" mode exists in Phase 3; this is the future branch point.
  return roster.length;
}
