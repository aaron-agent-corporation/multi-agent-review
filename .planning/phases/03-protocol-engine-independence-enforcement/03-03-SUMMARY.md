---
phase: 03-protocol-engine-independence-enforcement
plan: 03
subsystem: testing + protocol-engine
tags: [PROT-04, PROT-01, independence, planted-error, ab-test, skip-failed, D-30, live-verified]
requires:
  - phase: 03-02
    provides: "runProtocol XState engine, mar run, gate (requiredArtifactsExist/expectedParticipantCount)"
  - phase: 03-01
    provides: "scopedWorkdir/promoteDrafts (PROT-04), --emit fixture mode, e2e harness pattern"
  - phase: 02
    provides: "applySkipFailed/assertReviewable (gates.ts, D-29/D-30) — built but un-wired until now"
provides:
  - "test/planted-error.test.ts: A/B independence proof (success criterion #4) — control masks, treatment surfaces"
  - "Env-activated planted-error fixture mode (MAR_PLANTED_MODE/MAR_PLANTED_VALUES) in fake-claude/fake-codex"
  - "D-30 partial-failure handling WIRED into runProtocol: a failed agent is dropped while >=2 distinct vendors survive"
  - "manifest droppedAgents[] audit list + addDroppedAgent writer"
affects: [phase-4, REVW, structured-review-content]
tech-stack:
  added: []
  patterns:
    - "A/B hermetic proof: both arms drive the REAL engine; only the agents' held values differ (control: shared consensus / treatment: independent divergence)"
    - "Fixture value channel via env (MAR_PLANTED_MODE + JSON MAR_PLANTED_VALUES keyed by scoped cwd basename) because splitBin can't carry extra bin flags"
    - "Live roster in XState context shrinks monotonically across phases; runPhaseGated = fan-out + applySkipFailed + gate as one decision"
key-files:
  created:
    - test/planted-error.test.ts
  modified:
    - test/fixtures/fake-claude.mjs
    - test/fixtures/fake-codex.mjs
    - src/protocol/engine.ts
    - src/schema/manifest.ts
    - src/workspace/manifest.ts
    - test/protocol-engine.test.ts
key-decisions:
  - "Control arm faithfully models shared-context by giving every agent the SAME planted value (identical drafts = what a single consensus draft yields); treatment gives divergent values. Both run through runProtocol, satisfying the key_link."
  - "Planted-error mode is ENV-activated (not an argv flag): splitBin splits bin on first whitespace only, so extra bin flags can't survive — env is the reliable per-run channel."
  - "Discrepancy is computed by the fixture reading promoted drafts from shared/ at review (independence is observable on the filesystem), not asserted by the test harness inspecting internals."
  - "[Checkpoint fix] applySkipFailed wired into the run path: drop failed agents, re-assert >=2 distinct vendors over survivors, record drops, gate on survivors — never silently single-vendor."
patterns-established:
  - "Hermetic A/B independence proof with a real control arm (RESEARCH Pitfall 2)"
  - "Graceful partial-failure degradation: live roster shrinks, run completes on survivors, drops audited"
requirements-completed: [PROT-04, PROT-01]
duration: ~50min
completed: 2026-06-05
---

# Phase 3 Plan 03: Planted-Error A/B Proof + Live Verification Summary

**A hermetic A/B test proves independent drafts surface a planted error that a shared-context control masks (success criterion #4), and a live `mar run` against real claude+codex confirmed the full 6-phase engine end-to-end — after wiring the D-30 skip-failed handler that the live check exposed as un-wired.**

## Performance

- **Duration:** ~50 min (incl. live verification + one checkpoint-fix round)
- **Tasks:** 2 (Task 1 A/B test; Task 2 live human-verify checkpoint, approved after fix)
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

### Task 1 — Planted-error A/B independence proof (success criterion #4)

`test/planted-error.test.ts` asserts BOTH arms, each driving the real engine (`mar run` → `runProtocol`), hermetic on `node <fixture>` bins (zero credits):

- **Control (shared consensus):** both agents hold the SAME planted-error value → drafts agree → cross-review finds no divergence → the planted error is MASKED. Asserts no `DISCREPANCY`, an `AGREED` review, and the masked value is the planted error itself. This models the manual case study's failure mode (all agents anchored on one consensus draft); identical held values faithfully reproduce what a single shared consensus draft yields.
- **Treatment (independent drafts):** claude carries the planted error; codex, drafting in its isolated `work/<agent>/` (PROT-04), reports the correct value. The divergence reaches `shared/` at the promotion boundary and cross-review SURFACES it. Asserts a `DISCREPANCY` naming both values.

Fixture mechanism: env-activated `MAR_PLANTED_MODE=1`; each agent's draft value comes from the JSON env map `MAR_PLANTED_VALUES` keyed by the scoped cwd basename (`work/<agent>/`). At review the fixture reads every promoted draft under the run's `shared/` and emits `DISCREPANCY values=…` or `AGREED value=…` from what it can see on disk — independence is an observable filesystem fact, not a harness assertion. All pre-existing fixture modes (`--emit`, `--fail-auth`, `--bad-json`, `--hang`, codex `--rate-limit-once`) are unchanged.

### Task 2 — Live human-verified run (approved after one fix)

The live `mar run` exposed a real defect (see Deviations): `applySkipFailed` (built in Phase 2 for exactly this) was never wired into the run path, so gemini's headless-auth failure doomed the whole run. After the fix, re-verified live by the executor (user pre-approved live runs this checkpoint):

- `mar run /tmp/mar-live-input.md` → exit 0; gemini-1 dropped+recorded; claude-1 + codex-1 advanced through ALL 6 phases. Manifest `status: "completed"`, 12 artifacts (2 per kind, zero gemini).
- Draft isolation held: each `work/<agent>/` contained only `input.md` (no peer draft); `shared/` held only the 2 survivors' promoted drafts.
- `invocations.ndjson` logged each turn with `command`/`exitCode`/`durationMs`/`timedOut` and the prompt body redacted to `<prompt>` (codex flags pinned: `--ephemeral`, `--skip-git-repo-check`, `-s read-only`).
- Single-vendor refusal held: a 2×claude roster exited 2 with `review needs >=2 distinct vendors` and created no `runs/`.

## Verification

- `npx vitest run test/planted-error.test.ts` → 2 passed (control + treatment arms).
- `npx vitest run` → **198 passed (24 files)** — no regressions.
- `npx tsc --noEmit` clean; `npx biome check src/ test/` clean (51 files).
- Acceptance greps: `control`=8 (≥1), `treatment|independent`=11 (≥1); all config bins are `node <fixture>` (no real binary in the A/B test).
- Live: full 6-phase run completed against real claude+codex with gemini gracefully dropped; single-vendor refusal fired.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug, surfaced by the live checkpoint] Wired D-30 skip-failed into the run path**
- **Found during:** Task 2 live verification — `mar run` exited 1 with status "failed" because gemini-1 (headless-auth) was fanned out and its short-write failed the strict gate, dooming the whole run.
- **Root cause:** `applySkipFailed(healthy, failed)` existed in `src/gates.ts` (Phase 2, plan 02-03) but `runProtocol` never called it; the engine always gated on the FULL configured roster.
- **Fix:** `runPhase` now returns the ok/failed partition of the live roster. A new `runPhaseGated` applies `applySkipFailed(survivors, failed)` (re-asserting ≥2 distinct vendors over survivors — dropping can never produce a single-vendor run), records each drop via the new `addDroppedAgent`, then gates on EXACTLY the survivors' written paths with `expectedParticipantCount(survivors)`. The XState context carries a live roster that shrinks monotonically across phases; `promoteDrafts` runs over surviving drafters only. The run fails only when survivors < 2 distinct vendors.
- **Regression tests:** a draft failure leaving <2 distinct vendors still fails the run; a 3-agent roster where one fails now COMPLETES on 2 survivors with the drop recorded and all 6 kinds × 2 survivors (no gemini artifacts, gemini draft never promoted).
- **Files modified:** src/protocol/engine.ts, src/schema/manifest.ts (droppedAgents[]), src/workspace/manifest.ts (addDroppedAgent + createRun default), test/protocol-engine.test.ts
- **Commit:** 9d08b04

**Note (not a code deviation):** the existing engine test "one agent failing does not reject the whole fan-out" asserted the OLD (defective) behavior (3-agent roster → failed). It was rewritten to the corrected D-30 semantic (completes on 2 survivors), which is the behavior the live checkpoint required.

## Authentication Gates

The live run's gemini-1 hit a headless-auth gate (expected per D-32 — free Gemini CLI tier, Antigravity cutoff 2026-06-18). This is now handled as graceful degradation: gemini is dropped, the run continues on the ≥2 surviving distinct vendors. Not a run-blocking failure.

## Threat Model Coverage

- **T-03-11 (live draft-phase info disclosure):** mitigated — live run confirmed each `work/<agent>/` held only `input.md` (no peer draft); promotion happened only at the draft→review boundary, over surviving drafters only.
- **T-03-12 (accidental live invocation / cost in CI):** mitigated — the A/B test and all automated tests use `node <fixture>` bins only (zero credits); the live run is a one-time human checkpoint, not a CI test.
- **T-03-13 (codex session-file tampering under scoped cwd):** mitigated — live `work/<agent>/` contained only `input.md` + the agent's own draft; no stray rollout/session files (`--ephemeral`/`--skip-git-repo-check` held under the scoped cwd).
- **T-03-SC (npm installs):** honored — no new packages added.

## Known Stubs

None. The per-phase prompt remains a minimal placeholder (structured review CONTENT is the documented Phase-4 boundary, REVW-*), unchanged from Plan 03-02. The A/B proof and skip-failed handling are fully real.

## Self-Check: PASSED

- Created/modified files present: test/planted-error.test.ts, test/fixtures/fake-{claude,codex}.mjs, src/protocol/engine.ts, src/schema/manifest.ts, src/workspace/manifest.ts, 03-03-SUMMARY.md — all FOUND.
- Commits present: 5aeb031 (A/B proof), 9d08b04 (skip-failed checkpoint fix) — both FOUND in git log.
