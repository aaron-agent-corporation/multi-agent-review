---
phase: 03-protocol-engine-independence-enforcement
verified: 2026-06-05T02:25:48Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
human_verification:
  - test: "All-timeout terminal status maps to 'timeout' (CR-01 branch), not 'failed'"
    expected: "A run where every surviving agent times out (dropping below 2 distinct vendors) records manifest.status === 'timeout' with a failureReason naming the timeouts — not a generic 'failed'."
    why_human: "The CR-01 fix (commit 2061208) implements failedTimedOut -> setStatus(runDir, 'timeout', reason), but NO automated test exercises the all-timeout -> 'timeout' status branch. Engine failure tests cover only the non-timeout '<2 vendors -> failed' path (test/protocol-engine.test.ts:114). The fixer explicitly flagged this path for human verification. The branch logic is internally sound on inspection but unverified by a regression test. A fixture --hang mode exists and could back such a test in a follow-up."
---

# Phase 3: Protocol Engine + Independence Enforcement Verification Report

**Phase Goal:** A user can start a run on any input document and watch it progress through all 6 phases with enforced turn-taking and gates, where an agent physically cannot see a peer's draft before the cross-review phase.
**Verified:** 2026-06-05T02:25:48Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can start a run on any input document and it advances through all 6 phases with enforced turn-taking | ✓ VERIFIED | `mar run <input>` wired in cli.ts (run subcommand line 411, delegates to `runProtocol` line 372). Engine drives 6 phases in series via XState v5 machine built from `PHASES` (engine.ts buildMachine, states programmatically chained draft→promote→review→…→validation). Engine test "drives a 2-vendor roster through all 6 phases -> status completed, one artifact per agent per kind" passes; e2e anchor `test/protocol-run.e2e.test.ts` green. Live human-verified run (plan 03-03 checkpoint): real claude+codex completed all 6 phases, manifest status "completed", 12 artifacts. |
| 2 | Phase N+1 cannot begin until all required phase-N artifacts exist on disk | ✓ VERIFIED | Gate `requiredArtifactsExist(writtenPaths)` (gate.ts:20) uses `isDone` (exists AND size>0), judged against the EXACT paths the fan-out wrote (gated==written, engine.ts:274-276) plus a count check `writtenPaths.length === expectedParticipantCount(phase, survivors)` catching short writes. Guard advances only on `survivors` outcome else routes to `failed` final state. Tests: "gates each phase on EXACTLY the paths the fan-out wrote", "a failed agent leaving <2 distinct vendors fails the run -> status failed, does NOT advance" (asserts no "review" kind written). 0-byte guard tested in protocol-gate.test.ts ("empty artifact"). |
| 3 | During drafting an agent's context provably excludes peer drafts (workspace-scoped); drafts promoted to shared only at the 1→2 boundary | ✓ VERIFIED | `scopedWorkdir` (scope.ts:38) creates `work/<agent>/` seeded with ONLY input.md; draft artifact written into that scoped cwd (engine.ts:116-117,151), so no peer can read it from a shared location during drafting. `promoteDrafts` (scope.ts:56) is the SOLE writer of drafts to `shared/`, invoked only as a transient `promote` state between draft and review (engine.ts states.promote, onDone→review). Agent-name charset guard (`/^[A-Za-z0-9_-]+$/`) prevents path escape. Tests: scope-independence.test.ts (cross-agent listing exclusion + promotion boundary + escape throw); engine "draft phase scopes each agent's cwd; drafts promoted to shared/ only after draft". Live run confirmed work/<agent>/ held only input.md. |
| 4 | A planted-error catch test confirms independent drafts surface errors a shared-context run would mask | ✓ VERIFIED | `test/planted-error.test.ts` — falsifiable A/B (CR-02 fix, commit 03059b6). CONTROL arm runs `MAR_SHARED_CONTEXT=1` genuinely bypassing isolation; both arms handed the SAME divergent values (99 vs 42). Control: divergent values converge off shared disk → no DISCREPANCY, asserts AGREED (masked). Treatment: real scoped isolation → DISCREPANCY surfaced naming both values. Falsifiability hook: each agent records peer drafts visible in its own cwd to work/<agent>/peer-visibility.json; treatment asserts these are EMPTY, so a scope.ts leak would FAIL the test. Both `it` blocks pass. Hermetic (node <fixture> bins, zero credits). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/workspace/scope.ts` | scopedWorkdir + promoteDrafts + draftFileName (PROT-04) | ✓ VERIFIED | All three exported; charset guard; promoteDrafts sole shared/ writer. Wired into engine.ts (imports + draft cwd + boundary promote). |
| `src/adapters/{claude,codex,gemini}.ts` | conditional cwd pass-through | ✓ VERIFIED | `...(req.cwd ? { cwd } : {})` present; pinned codex flags untouched (adapter-cwd.test.ts green). |
| `src/protocol/phases.ts` | frozen PHASES descriptor (6 entries) | ✓ VERIFIED | 6 entries in order; scoped:true only for draft; participants:"all". |
| `src/protocol/gate.ts` | requiredArtifactsExist + expectedPhaseArtifacts + expectedParticipantCount (PROT-03) | ✓ VERIFIED | All exported; gate uses isDone; no seq derivation (single source of truth). |
| `src/protocol/engine.ts` | runProtocol XState v5 engine (PROT-01) | ✓ VERIFIED | Exported; reuses withRetry/makeAdapter turn seam; bare Promise.allSettled (no p-limit); wires scope + gate + D-30 skip-failed; CR-01 timeout/failureReason mapping. |
| `src/cli.ts` | `mar run <input>` subcommand | ✓ VERIFIED | run subcommand + thin runRun delegate; assertReviewable gate (NOT exempt); input size cap. |
| `test/planted-error.test.ts` | A/B independence proof | ✓ VERIFIED | Falsifiable control+treatment arms (CR-02). |
| `src/schema/manifest.ts` | failureReason (CR-01) + droppedAgents (D-30) | ✓ VERIFIED | failureReason optional; droppedAgents defaulted; timeout status kept distinct from failed. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| engine.ts | turn seam | withRetry(makeAdapter().invoke()) | ✓ WIRED | Reused, not reimplemented (engine.ts:107-142). |
| engine.ts | scope.ts | scopedWorkdir (draft) / promoteDrafts (boundary) | ✓ WIRED | scopedWorkdir at engine.ts:116; promoteDrafts in transient promote state. |
| engine.ts | gate.ts | requiredArtifactsExist over written paths + expectedParticipantCount | ✓ WIRED | engine.ts:274-276 gated==written + short-write count. |
| cli.ts | runProtocol | thin run subcommand action | ✓ WIRED | runRun delegates (cli.ts:372). |
| cli.ts | assertReviewable | run path gate (NOT exempt) | ✓ WIRED | cli.ts:344; e2e "refuses <2 vendors" passes; live single-vendor refusal exited 2. |
| engine.ts | setStatus failureReason/timeout (CR-01) | terminal status mapping | ⚠️ WIRED, untested branch | timeout-vs-failed mapping implemented (engine.ts:435-448); all-timeout→"timeout" branch has NO automated test (see Human Verification). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| manifest.json | status / artifacts / droppedAgents / failureReason | engine fan-out → writeArtifact/addArtifact/setStatus | ✓ Real (live run produced 12 real artifacts; fixtures produce per-phase markers) | ✓ FLOWING |
| per-phase artifacts | turn.text from adapter invoke | real CLI / fake fixture stdout | ✓ Real | ✓ FLOWING (per-phase prompt is a documented placeholder — structured review CONTENT is the Phase-4 boundary, IN-03; not a stub for Phase-3 scope) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `npx vitest run` | 198 passed (24 files) | ✓ PASS |
| Typecheck | `npx tsc --noEmit` | exit 0, clean | ✓ PASS |
| 6-phase happy path | engine test enumerating all 6 kinds | passed | ✓ PASS |
| Planted-error A/B | `test/planted-error.test.ts` | 2 passed (control + treatment) | ✓ PASS |
| All-timeout→"timeout" status | (no test exists) | n/a | ? SKIP — routed to human verification |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PROT-01 | 03-01, 03-02, 03-03 | Run progresses through all 6 phases with enforced turn-taking | ✓ SATISFIED | Truth 1; engine + mar run + live run. |
| PROT-03 | 03-02 | Phase N+1 cannot start until all required phase-N artifacts exist | ✓ SATISFIED | Truth 2; gate over written paths + isDone + count. |
| PROT-04 | 03-01, 03-02, 03-03 | Drafting context physically cannot include a peer's draft; promote only at boundary | ✓ SATISFIED | Truths 3 & 4; scoped workdirs + sole-writer promotion + falsifiable A/B. |

All three phase requirement IDs (PROT-01, PROT-03, PROT-04) are declared in PLAN frontmatter and mapped to Phase 3 in REQUIREMENTS.md traceability (lines 97-99). No orphaned requirements: REQUIREMENTS.md maps exactly these three IDs to Phase 3, and all three are claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/protocol/engine.ts | 110 | Placeholder per-phase prompt embeds input path not content (IN-03) | ℹ️ Info | Documented Phase-4 boundary (structured review CONTENT is REVW-*); not a Phase-3 stub. Real artifacts still produced. |
| src/protocol/gate.ts | 50-53 | expectedParticipantCount both branches return roster.length (IN-02) | ℹ️ Info | Intentional future branch point for Phase-4 integrator mode; advisory. |
| (engine/cli/scope) | — | No TBD/FIXME/XXX debt markers found in phase-modified source | — | Clean; no unreferenced debt markers. |

No blocker anti-patterns. The 6 open warnings (WR-01..06) and 4 info items in 03-REVIEW.md are advisory (race-condition hardening, atomicity of the .md/.raw.json pair, gemini stderr redaction, vacuous-empty-list edge). None block the Phase-3 goal; several touch concurrency/resume paths the engine does not exercise in its single-process flow and are appropriately deferred.

### Human Verification Required

#### 1. All-timeout terminal status maps to "timeout" (CR-01 branch)

**Test:** Construct a run where every surviving agent times out such that the roster drops below 2 distinct vendors (e.g. point both vendor bins at the fixture `--hang` mode with a short timeoutMs, or run live with an induced hang).
**Expected:** `manifest.status === "timeout"` (NOT "failed"), with `failureReason` naming the timeout(s). This is the D-17 observability signal CR-01 was fixed to preserve from the `mar run` path.
**Why human:** The CR-01 fix (commit 2061208) implements `failedTimedOut` → `setStatus(runDir, "timeout", reason)` and the schema keeps `timeout` distinct from `failed`. The branch logic is internally consistent on inspection (reason "timeout" set in runPhase, propagated through PhaseFailure.timedOut to runProtocol). However NO automated test exercises the all-timeout → "timeout" status mapping — engine failure tests cover only the non-timeout `<2 vendors → failed` case. The fixer explicitly flagged this path for human verification. A `--hang` fixture mode exists and a regression test backing this branch is recommended as cheap follow-up.

### Gaps Summary

No blocking gaps. All 4 success criteria are observably true in the codebase: the 6-phase engine runs end-to-end (`mar run` → runProtocol, live-verified), phase gating is enforced over the exact written paths with a 0-byte/short-write guard, draft isolation is a tested filesystem fact (scoped workdirs + sole-writer promotion + a falsifiable A/B that fails on a leak), and the planted-error A/B proves independence with a genuine shared-context control. Both code-review criticals (CR-01, CR-02) are fixed and present in the source, not merely claimed. The full suite is green (198 tests) and tsc is clean.

The single item routing this phase to `human_needed` is a verification-coverage gap, not a functional defect: the CR-01 all-timeout → "timeout" terminal-status branch is implemented and internally sound but has no automated regression test, and the fixer flagged exactly this path. Recommend a one-time human confirmation (or a `--hang`-backed regression test) before relying on the D-17 timeout signal from `mar run`.

---

_Verified: 2026-06-05T02:25:48Z_
_Verifier: Claude (gsd-verifier)_

---
*Update 2026-06-05: the single human-verification item (all-timeout → `timeout` status branch, CR-01) was resolved — regression test added in `test/protocol-engine.test.ts` and user-approved. Status upgraded human_needed → passed.*
