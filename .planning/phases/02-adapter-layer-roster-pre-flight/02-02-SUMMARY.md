---
phase: 02-adapter-layer-roster-pre-flight
plan: 02
subsystem: retry
tags: [retry, backoff, classification, audit-log, orch-02]
requires:
  - "src/schema/turn.ts (TurnResult normalized signals)"
  - "src/log/invocation.ts (InvocationRecord + logInvocation)"
provides:
  - "withRetry — the ONE vendor-agnostic bounded-retry seam (D-24)"
  - "classifyCodex / classifyGemini / classifyClaude — transient-vs-fatal verdicts (D-22)"
  - "InvocationRecord.attempt — per-attempt audit field (D-25)"
affects:
  - "src/cli.ts (mar-invoke path now logs attempt:1)"
  - "Phase 3 mar run (will wrap adapters in withRetry)"
tech-stack:
  added: []
  patterns:
    - "node:timers/promises setTimeout for awaitable backoff (no p-retry, D-35)"
    - "case-insensitive regex token sets for transient/fatal classification"
    - "vi.mock('node:timers/promises') to record backoff delays + resolve instantly in tests"
key-files:
  created:
    - "src/retry.ts"
    - "test/retry.test.ts"
  modified:
    - "src/log/invocation.ts"
    - "test/invocation.test.ts"
    - "src/cli.ts"
decisions:
  - "Default-to-fatal for unclassified clean errors — never waste a retry (D-22)"
  - "Shared COMMON_TRANSIENT regex (429/RESOURCE_EXHAUSTED/quota/overloaded/503/529/unparseable) across all vendors; per-vendor FATAL token sets layered on top"
  - "attempt made a REQUIRED field on InvocationRecord (not optional) — forces every call site to declare which attempt it is; cli.ts single-invoke path declares attempt:1"
metrics:
  duration: 9
  tasks: 2
  files: 5
  completed: 2026-06-04
---

# Phase 2 Plan 02: Vendor-Agnostic Retry Wrapper Summary

`withRetry` — the single bounded-retry seam (transient-only classification, exponential backoff + jitter honoring retry-after, per-attempt NDJSON audit) wrapping any adapter `invoke`, built on plain TS via `node:timers/promises` with zero new dependencies.

## What Was Built

- **`src/retry.ts`** — `withRetry(invoke, opts)` runs attempts `1..retries+1`, logs EVERY attempt (incl. failures) via `onAttempt` with a 1-based number (D-25), returns immediately on `ok` or a `fatal` classification (never retries auth/clean errors, D-22), and on a transient failure with budget remaining sleeps `retryAfterMs ?? (min(cap, base·2^(n-1)) + jitter)` (D-23). Defaults: `DEFAULT_RETRIES=2` (3 attempts), `DEFAULT_BASE_MS=15000`, `DEFAULT_MAX_MS=60000`.
- **Per-vendor classifiers** — `classifyCodex` / `classifyGemini` / `classifyClaude`, each reading ONLY normalized signals (`timedOut`, `error`, `exitCode`), never re-parsing raw output. A hang (`timedOut`) and an `unparseable`-output fluke are transient; a shared `COMMON_TRANSIENT` token set (429/RESOURCE_EXHAUSTED/rate-limit/quota/overloaded/503/529) is transient; per-vendor auth/clean-error tokens are fatal; anything unclassified defaults to fatal. Gemini's false-positive-429 (#17906) is handled by classifying 429 transient so the bounded loop absorbs it.
- **`InvocationRecord.attempt`** — added as a required field (D-25); `logInvocation` already spreads the record so the NDJSON line carries it byte-compatibly.

## How It Meets the Plan

- ORCH-02 / D-24: one wrapper, not per-adapter duplication.
- D-22: transient retried, fatal stopped, unclassified defaults to fatal.
- D-23: 2 retries / 3 attempts, exponential backoff + jitter, retry-after override.
- D-25: every attempt logged with its 1-based number.
- D-35: no new dependency; `grep -c 'p-retry' package.json` == 0.

## Verification Results

- `npx vitest run test/retry.test.ts test/invocation.test.ts` — 48 passed.
- `npx vitest run` (full suite) — 94 passed across 9 files, 1.46s.
- `npx tsc --noEmit` — clean.
- `npx biome check src/retry.ts src/log/invocation.ts test/retry.test.ts test/invocation.test.ts` — clean.
- `grep -c 'useFakeTimers' test/retry.test.ts` == 2; retry suite runs in ~170ms (no real 15-60s waits).
- `grep -c 'attempt' src/log/invocation.ts` == 3.
- `grep -c 'p-retry' package.json` == 0.

## TDD Gate Compliance

Both tasks followed RED → GREEN:
- `test(02-02): attempt field + transient classifiers (RED)` — 752168c
- `feat(02-02): InvocationRecord.attempt + per-vendor classifiers (GREEN)` — c50b79b
- `feat(02-02): withRetry vendor-agnostic wrapper (GREEN)` — 1cef7db (RED tests for withRetry were committed in the shared 752168c test file alongside the classifier RED; the same test file gained the withRetry GREEN assertions in this commit).

REFACTOR gate: not needed — implementation was clean on first GREEN.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Existing cli.ts caller broke when `attempt` became a required field**
- **Found during:** Task 1 GREEN (tsc step)
- **Issue:** Making `InvocationRecord.attempt` required (per plan: "every attempt incl. failures gets its own record") broke the existing `logInvocation` call in `src/cli.ts:209` (TS2345, property missing).
- **Fix:** Added `attempt: 1` to the single (un-retried) `mar invoke` path — it is always the first and only attempt.
- **Files modified:** src/cli.ts
- **Commit:** c50b79b

**2. [Rule 1 - Test correctness] Initial backoff tests relied on `globalThis.setTimeout` spy + fake timers, which did not intercept `node:timers/promises` and leaked ~4.5s of real waits**
- **Found during:** Task 2 GREEN (first test run: 2 failures, 4.65s duration)
- **Issue:** `vi.spyOn(globalThis, "setTimeout")` does not observe the delay passed to `node:timers/promises` `setTimeout`, and fake timers did not govern it — backoff assertions saw zero recorded sleeps and the suite waited for real backoff.
- **Fix:** Replaced with `vi.mock("node:timers/promises")` that records each requested delay into `recordedSleeps` and resolves instantly. Backoff/retry-after assertions now read `recordedSleeps` directly. Suite dropped to ~170ms with no real waits. Implementation (`src/retry.ts`) was unchanged — the defect was entirely in the test harness.
- **Files modified:** test/retry.test.ts
- **Commit:** 1cef7db

## Known Stubs

None — `withRetry` and all three classifiers are fully implemented and wired to the normalized `TurnResult` signals. (The classifiers will be wired to their respective adapters by the codex/gemini adapter plans; that wiring is out of this plan's scope.)

## Self-Check: PASSED
- src/retry.ts — FOUND
- test/retry.test.ts — FOUND
- src/log/invocation.ts (attempt field) — FOUND (grep count 3)
- Commit 752168c — FOUND
- Commit c50b79b — FOUND
- Commit 1cef7db — FOUND
