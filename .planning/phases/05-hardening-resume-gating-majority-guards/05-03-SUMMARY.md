---
phase: 05-hardening-resume-gating-majority-guards
plan: 03
subsystem: convergence-majority
status: complete
tags: [convergence, majority, tie-break, resolver, anti-anchoring, wave-2]
requires:
  - "converge.ts:118-124 tallyBases/mostSupportedBase tally primitives (escalate fallback stays mostSupportedBase)"
  - "converge.ts:221-249 cap + deadlock escalate guards (the two insert points)"
  - "schema/resolved-decisions.ts Resolver enum (05-02) — vocabulary single-sourced; ConvergenceResult.resolver mirrors its members"
provides:
  - "clearMajority(signals, rosterSize) helper — bestCount > rosterSize/2 (D-59), null on tie/plurality (Pitfall 3)"
  - "ConvergenceResult.resolver optional field (convergence | majority | integrator | human) (D-61)"
  - "majority tie-break BEFORE both escalate guards; unanimous return tagged resolver:convergence"
affects:
  - "05-06 decision-record sources ConvergenceResult.resolver as the per-resolution provenance"
commits:
  - "af65a8e feat(05-03): add clearMajority tie-break before both escalate guards + resolver field (RSLV-02, D-59/D-61)"
  - "e4007c4 test(05-03): majority convergence tests — 2-1 resolves, 1-1-1/2-vendor-1-1 escalate, unanimous tagged convergence (D-60, Pitfall 3)"
key-files:
  created: []
  modified:
    - "src/protocol/converge.ts"
    - "test/converge.test.ts"
deviations: []
self-check: PASSED
metrics:
  duration: "~6 minutes"
  completed: "2026-06-05"
  tasks: 2
  tests_added: 5
  tests_total: 280
---

# Phase 05 Plan 03: Majority Tie-Break Vertical Slice Summary

RSLV-02 + the no-clear-majority routing half of RSLV-03: a `clearMajority` helper and two guard
inserts in `converge.ts`. After the evidence-grounded convergence loop exhausts its rounds (cap) or
detects a stable deadlock, a CLEAR majority of the surviving roster on one base now resolves the fork
`agreed` with `resolver: "majority"` INSTEAD of escalating (D-59). No clear majority still escalates
exactly as before (D-60). The unanimous-agreement return is tagged `resolver: "convergence"` (D-61).
The tally is computed ONLY at the exit boundary — never injected into a round prompt (D-59
anti-anchoring; the loop never injected it and still doesn't).

## What Was Built

### Task 1 — clearMajority helper + resolver field + tie-break before both escalate guards
`src/protocol/converge.ts`:
- **`ConvergenceResult.resolver`** — additive optional field, type union
  `"convergence" | "majority" | "integrator" | "human"`, mirroring `schema/resolved-decisions.ts`
  `Resolver` (the vocabulary is single-sourced there as a zod enum; this is the structural TS union of
  the same members). Documented in the existing optional-field doc-comment style alongside
  `openDecision`.
- **`clearMajority(signals: RoundSignal[], rosterSize: number): string | null`** — pure helper that
  reuses `tallyBases`, finds the highest-count base, and returns it ONLY when its count is strictly
  `> rosterSize / 2`, else `null`. Deliberately NOT `mostSupportedBase` (which returns the leader even
  on a 1-1 tie — a plurality; reusing it would mis-resolve the D-60 escalate cases — Pitfall 3).
  `rosterSize` is the SURVIVING roster size (`roster.length` threaded from `runConvergence`).
- **Unanimous return tagged** `resolver: "convergence"` (Guard 1).
- **Tie-break inserted BEFORE both `escalate(...)` calls** — the cap guard (`round === cap`) and the
  deadlock guard (`stableStuckRounds >= UNRESOLVABLE_STABLE_ROUNDS`): each computes
  `const majorityBase = clearMajority(signals, roster.length)` and, when non-null, returns
  `{ base: majorityBase, integrator: integratorFor(majorityBase, signals), rounds: round,
  status: "agreed", concessions, resolver: "majority" }`. When null, falls through to the existing
  `escalate(...)` unchanged.
- **`escalate` / `mostSupportedBase` untouched** — `mostSupportedBase` remains the escalate-only
  fallback base picker; the escalate path leaves `resolver` UNSET (no clear majority settled it).

### Task 2 — majority convergence tests (D-60, Pitfall 3)
`test/converge.test.ts` (+5 net assertions across new + extended cases), all driven through the
existing hermetic `writeEvalFixture` harness with DIVERGENT per-author `proposedBase` values and NO
open disagreements (so the deadlock guard never trips and the loop runs deterministically to a low
`convergenceCap`):
1. **3-vendor 2-1 at the cap** → `status:"agreed"`, `resolver:"majority"`, `base` is the 2-supported
   base, `integrator` is its author, no `openDecision`.
2. **3-vendor 1-1-1 at the cap** → `status:"escalated"`, `resolver` undefined, `openDecision` with a
   `cap` reason (1 is not `> 3/2` — a plurality is not a majority).
3. **2-vendor 1-1 at the cap** → `status:"escalated"`, `resolver` undefined, `openDecision` (D-60:
   1 is not `> 2/2`).
4. **Unanimous (extended existing happy-path test)** → asserts `resolver:"convergence"`.

The existing cap/deadlock tests continue to pass unchanged.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | clearMajority + resolver field + tie-break before both escalate guards | af65a8e | src/protocol/converge.ts |
| 2 | majority convergence tests (2-1 / 1-1-1 / 2-vendor-1-1 / unanimous tag) | e4007c4 | test/converge.test.ts |

## Exported / Changed Signatures (for downstream plans)

```ts
// src/protocol/converge.ts — ConvergenceResult gains an additive optional field:
export interface ConvergenceResult {
  base: string;
  integrator: string;
  rounds: number;
  status: "agreed" | "escalated";
  concessions: string[];
  openDecision?: { reason: string };
  resolver?: "convergence" | "majority" | "integrator" | "human"; // NEW (D-61)
}
```

`resolver` semantics for **05-06** (decision-record sourcing):
- `"convergence"` — set on the unanimous-agreement return (Guard 1).
- `"majority"` — set on the post-cap/deadlock clear-majority tie-break return (`status:"agreed"`).
- `undefined` — the escalate fallback path (`status:"escalated"`) leaves it UNSET (no clear majority
  settled it; `mostSupportedBase` picked a provisional fallback only).
- `"integrator"` / `"human"` are reserved members of the union (sourced by other resolution paths in
  05-06), not produced by `converge.ts`.

So 05-06 can branch: `status:"agreed" && resolver === "convergence"` vs `=== "majority"` for the
ledger provenance, and treat `status:"escalated"` (resolver undefined) as the human-review fork.

## Verification

- Per-task: `npx vitest run test/converge.test.ts` green after each commit (6 tests); `npx tsc
  --noEmit` clean.
- Full suite: `npx vitest run` → **280 passed (35 files)** — 275 baseline + 5 new. No regressions.
  (The `protocol error: ... >=2 distinct vendors` line in output is an EXPECTED negative-path test's
  stderr, not a failure — Test Files 35 passed.)
- `npx tsc --noEmit`: clean.
- Anti-anchoring grep: no `tally`/`clearMajority`/`mostSupportedBase` call appears in any
  `runPhase`/prompt/input path — the tally is computed only at the exit boundary (D-59).
- `npx biome check .`: only the ONE PRE-EXISTING finding (`engine.ts:212 noNonNullAssertion`, the
  `phase.validate!` assertion noted in 05-02-SUMMARY) — not in any file this plan touched. Both
  touched files (converge.ts, converge.test.ts) are clean.

## Deviations from Plan

None. The plan's preferred design (tie-break at BOTH the cap and deadlock guards, cap path used to
drive the divergent-base tests deterministically) was followed exactly.

## Self-Check: PASSED

`clearMajority` present in `src/protocol/converge.ts` (returns a base only when count `> rosterSize/2`,
else null); `ConvergenceResult.resolver` optional field present; unanimous return tagged
`resolver:"convergence"`, majority return `resolver:"majority"`; `mostSupportedBase` used ONLY inside
`escalate`; both task commits (af65a8e, e4007c4) verified in git log; full suite 280 green; tsc clean;
no STATE.md/ROADMAP.md modifications.
