---
phase: 02-adapter-layer-roster-pre-flight
plan: 05
subsystem: cli
tags: [commander, execa, roster, preflight, retry, withRetry, stdin, codex, gemini, claude]

# Dependency graph
requires:
  - phase: 02-01
    provides: adapter registry (makeAdapter), per-vendor adapters (claude/codex/gemini)
  - phase: 02-02
    provides: withRetry + per-vendor classifiers; logInvocation with attempt field
  - phase: 02-03
    provides: MarConfig schema, loadConfig + resolveAgent, init (detectVendors/writeStarterConfig)
  - phase: 02-04
    provides: runPreflight + formatStatusLines + extractVersion (Pitfall-2-safe version capture)
provides:
  - "mar invoke resolves --agent by roster NAME through the registry (no hardcoded vendor)"
  - "mar invoke wraps the adapter in withRetry; every attempt logged with its attempt number"
  - "mar init subcommand (PATH detection -> starter mar.config.json)"
  - "mar preflight subcommand (status table + exit 0/1)"
  - "adapter stdin closed (stdin:'ignore') so codex no longer hangs on an open pipe"
affects: [phase-03-runner, mar-run, gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin CLI composes config/registry/retry/preflight/init — business logic stays out of cli.ts so Phase 3 mar run reuses it"
    - "withRetry at the single CLI call site (D-24) — one vendor-agnostic retry seam, not per-adapter"
    - "stdin:'ignore' uniform across all execa adapter spawns — prompt is always an argv value"

key-files:
  created:
    - test/cli-roster.test.ts
    - test/adapter-stdin.test.ts
  modified:
    - src/cli.ts
    - test/e2e-invoke.test.ts
    - test/cli-timeout.test.ts
    - test/fixtures/fake-codex.mjs
    - src/adapters/codex.ts
    - src/adapters/gemini.ts
    - src/adapters/claude.ts

key-decisions:
  - "mar invoke is EXEMPT from the >=2-vendor gate and does NOT auto-preflight (D-27/D-29)"
  - "parseTimeout(undefined) now returns undefined so the roster effective timeout (entry ?? defaults) applies, instead of hardcoding 600000"
  - "cliVersions captured per-VENDOR via extractVersion (fixes the codex 'codex-cli' token bug, Pitfall 2)"
  - "Close adapter stdin (stdin:'ignore') uniformly — codex exec blocks on execa's default open stdin pipe"

patterns-established:
  - "Roster-name resolution: loadConfig -> resolveAgent -> makeAdapter(vendor, bin, model) is the single invoke path"
  - "Per-attempt audit logging via withRetry onAttempt -> logInvocation (attempt 1..N)"

requirements-completed: [ORCH-02, ORCH-03, ORCH-05]

# Metrics
duration: 54min
completed: 2026-06-04
---

# Phase 2 Plan 05: Roster-Wired CLI (init / preflight / roster-resolved invoke) Summary

**`mar init`, `mar preflight`, and a roster-name-resolved `mar invoke` wrapped in `withRetry` with per-attempt logging — the user-observable vertical slice tying Plans 01-04 together, live-verified end-to-end against real claude + codex CLIs.**

## Performance

- **Duration:** 54 min
- **Started:** 2026-06-04T20:20:03Z
- **Completed:** 2026-06-04T21:14:17Z
- **Tasks:** 2 (Task 1 auto/TDD; Task 2 live human-verify checkpoint)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- `mar invoke --agent <name>` now resolves the agent by ROSTER NAME via `loadConfig -> resolveAgent -> makeAdapter(vendor, bin, model)` — the hardcoded `opts.agent !== "claude"` guard and `MAR_CLAUDE_BIN` env hardcode are gone (ORCH-03).
- Every invocation is wrapped in the single vendor-agnostic `withRetry` seam; EVERY attempt (including failures) is logged to `invocations.ndjson` with its 1-based `attempt` number (ORCH-02 / D-24 / D-25).
- Added `mar init` (PATH detection -> starter `mar.config.json`) and `mar preflight` (per-agent status table -> exit 0 all-pass / 1 any-fail) subcommands (ORCH-05 / D-21 / D-28).
- `mar invoke` stays EXEMPT from the >=2-vendor gate and does NOT auto-preflight (D-27/D-29).
- Per-vendor `cliVersions` capture now uses `extractVersion`, fixing the codex `codex-cli` token bug (Pitfall 2) — live manifest shows `cliVersions.codex = "0.128.0"`.
- **Checkpoint-fix:** diagnosed and fixed a codex hang (open stdin pipe) discovered during live verification; codex now responds in ~15s instead of timing out.

## Task Commits

1. **Task 1 (RED): roster-resolved invoke + init/preflight tests** - `bc35b8d` (test)
2. **Task 1 (GREEN): wire init/preflight + roster invoke + withRetry** - `d9bcc18` (feat)
3. **Task 2 checkpoint-fix: close adapter stdin so codex stops hanging** - `400f77f` (fix)

**Plan metadata:** docs commit (this SUMMARY + STATE/ROADMAP/REQUIREMENTS).

## Files Created/Modified

- `src/cli.ts` - roster-resolved + withRetry-wrapped invoke; `init` and `preflight` subcommands; per-vendor version capture; effective-timeout resolution. (modified)
- `test/cli-roster.test.ts` - name resolution, gate-exemption, no-auto-preflight, per-attempt retry logging, init, preflight. (created)
- `test/adapter-stdin.test.ts` - regression guard: every adapter passes `stdin:'ignore'` to execa. (created)
- `test/e2e-invoke.test.ts` - supplies a roster (drop `MAR_CLAUDE_BIN`); 60s timeout for cold `npx tsx`. (modified)
- `test/cli-timeout.test.ts` - updated for the new `parseTimeout(undefined) === undefined` contract. (modified)
- `test/fixtures/fake-codex.mjs` - added stateful `--rate-limit-once` mode for the transient-then-ok retry case. (modified)
- `src/adapters/{codex,gemini,claude}.ts` - `stdin:'ignore'` on the execa spawn (checkpoint-fix). (modified)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Codex adapter hung on open stdin pipe**
- **Found during:** Task 2 (live human-verify checkpoint).
- **Issue:** `codex exec` BLOCKS waiting on stdin when execa leaves it as an open pipe (execa's default). Every codex adapter invocation hung until the wall-clock timeout — preflight hit the 30s probe timeout (latencyMs 30055, ✗ responsive) and `mar invoke --agent codex-1` hung the full 600s roster timeout (exit -1, timedOut). The prompt is ALWAYS passed as an argv value, never via stdin, so an open pipe is never needed. claude tolerated the open pipe, which is why this only surfaced for codex live.
- **Fix:** added `stdin: "ignore"` to the execa options in all three adapters (`src/adapters/codex.ts`, `gemini.ts`, `claude.ts`) for uniformity. Added `test/adapter-stdin.test.ts` as a drift guard asserting each adapter passes `stdin:'ignore'`.
- **Cross-plan note:** `src/adapters/*.ts` belong to plan 02-01. This 02-05 deviation modifies them because the bug was only observable once the live CLI round-trip (this plan's checkpoint) exercised the real codex binary.
- **Commit:** `400f77f`

**2. [Rule 3 - Blocking] Flaky 15s timeouts on `npx tsx` subprocess tests**
- **Found during:** Task 2 fix verification (full suite).
- **Issue:** the new e2e-style tests each spawn a COLD `npx tsx` (compile+run ~5s); under concurrent load several exceeded vitest's default 15s per-test timeout — a harness-startup cost, not a hang (fixtures resolve in ~0.1s).
- **Fix:** `vi.setConfig({ testTimeout: 60_000 })` in `test/cli-roster.test.ts` and `test/e2e-invoke.test.ts`; made the cli-roster describes sequential to reduce contention.
- **Commit:** `400f77f`

**3. [Plan-intended] parseTimeout(undefined) contract change**
- `parseTimeout(undefined)` now returns `undefined` (was `600000`) so the caller falls back to the roster's effective timeout (`entry.timeoutMs ?? config.defaults.timeoutMs`). `test/cli-timeout.test.ts` updated to the new contract. (Committed in `d9bcc18`.)

## Live Verification (human-verify checkpoint — APPROVED)

Run on the user's machine (user approved live runs):

- `mar init` -> wrote `mar.config.json` with claude-1/codex-1/gemini-1 + `defaults{ timeoutMs:600000, retries:2 }`.
- `mar preflight` -> `claude-1 ✓ installed (2.1.162) ✓ responsive (2.0s)`; `codex-1 ✓ installed (0.128.0) ✓ responsive (15.5s)` (was a 30s timeout before the stdin fix); `gemini-1 ✓ installed (0.45.0) ✗ responsive` with the auth/Antigravity hint (correct per D-32). Exit 1 (any-fail); `.mar/preflight.json` written, `.mar/` gitignored.
- `mar invoke --agent codex-1 --prompt "Reply with exactly: pong"` -> `codex ✓ 16.0s exit 0`; manifest `status: completed`, `cliVersions.codex = "0.128.0"` (NOT "codex-cli"); normalized artifact + `.raw.json` sibling; `invocations.ndjson` record carries `attempt: 1`; command argv has the `<prompt>` placeholder (body never logged).
- `mar invoke --agent claude-1` -> `claude ✓ 2.0s exit 0` (re-confirms the Phase-1 path through the new roster resolution).

## Threat Flags

None — no new trust boundary beyond those in the plan's `<threat_model>`. The `stdin:'ignore'` change REMOVES an input channel (closes stdin), reinforcing T-02-01 (no untrusted stdin to the CLI).

## Verification Results

- `npx vitest run` — 169/169 pass (18 files), zero real credits in the automated suite.
- `npx tsc --noEmit` — clean.
- `npx biome check` (all touched files) — clean.
- `grep -c 'opts.agent !== "claude"' src/cli.ts` == 0; `grep -c 'withRetry' src/cli.ts` == 3.
- Live round-trip human-verified (see above).

## Self-Check: PASSED
