import type { AgentEntry } from "./schema/config.js";

/**
 * Pure run-start gates enforcing the ORCH-04 diversity invariant. No I/O, no side effects
 * (mirrors the layout.ts pure-derivation style) — Phase 3's `mar run` reuses these directly.
 */

/** The distinct set of vendors across a roster. */
export function distinctVendors(agents: { vendor: string }[]): Set<string> {
  return new Set(agents.map((a) => a.vendor));
}

/**
 * Hard gate (D-29): refuse to run a review unless >=2 distinct vendors are present. There is NO
 * override path — single-vendor review is out of scope (PROJECT.md: same model reviewing itself
 * shares blind spots). The error names the vendors found ("none" for an empty roster).
 */
export function assertReviewable(agents: { vendor: string }[]): void {
  const v = distinctVendors(agents);
  if (v.size < 2) {
    throw new Error(`review needs >=2 distinct vendors; found: ${[...v].join(", ") || "none"}`);
  }
}

/**
 * Partial-failure handling (D-30): drop failing agents and proceed with the healthy set ONLY if
 * >=2 distinct vendors remain. `assertReviewable` runs over the survivors so the diversity
 * invariant is never compromised — dropping agents can never silently produce a single-vendor run.
 */
export function applySkipFailed(healthy: AgentEntry[], _failed: AgentEntry[]): AgentEntry[] {
  assertReviewable(healthy);
  return healthy;
}
