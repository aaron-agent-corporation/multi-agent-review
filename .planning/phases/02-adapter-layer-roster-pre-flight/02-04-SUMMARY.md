---
phase: 02-adapter-layer-roster-pre-flight
plan: 04
subsystem: infra
tags: [preflight, zod, execa, cache, version-detection, health-check]

# Dependency graph
requires:
  - phase: 02-01
    provides: makeAdapter registry (ORCH-03 seam) — composed for the tier-2 probe
  - phase: 02-02
    provides: withRetry + per-vendor classifiers — probe uses retries:0
  - phase: 02-03
    provides: AgentEntry roster shape (vendor/bin/model) — preflight input
provides:
  - runPreflight(roster) — tiered installed + responsive health check per roster CLI (ORCH-05)
  - extractVersion — Pitfall-2-safe per-vendor semver extraction (codex second token)
  - PreflightCache zod schema + atomic .mar/preflight.json cache with ~10min TTL
  - formatStatusLines — per-agent ✓/✗ status table with actionable hints
affects: [02-05, phase-3, mar-preflight-subcommand, run-start-gating]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "preflight COMPOSES adapters (makeAdapter + withRetry), never re-implements CLI calls"
    - "machine-state cache (.mar/) lives OUTSIDE runs/ — not run-artifact lineage (D-27)"
    - "fixed actionable hints keyed off failure class; env vars NAMED never valued (T-02-15)"

key-files:
  created:
    - src/schema/preflight.ts
    - src/preflight.ts
    - test/preflight.test.ts
  modified:
    - .gitignore

key-decisions:
  - "extractVersion uses /\\d+\\.\\d+\\.\\d+/ regex (vendor-agnostic), never split()[0] (claude-only)"
  - "probe is a SINGLE pong invocation with retries:0 + ~30s timeout — never burns retry budget (D-33)"
  - "gemini failure hint surfaces auth/Antigravity transition + named env vars (D-31), expected ✗ (D-32)"
  - "cache validated by PreflightCache.parse on both write and read (poisoning mitigation T-02-14)"

patterns-established:
  - "Tiered check: tier-1 --version on PATH → installed; tier-2 live probe → responsive"
  - "Atomic temp+rename cache write mirrors writeManifestAtomic (crash-safe, never partial)"
  - "TTL via isFresh(checkedAt, now, ttlMs) bounds stale-cache trust window"

requirements-completed: [ORCH-05]

# Metrics
duration: ~20min
completed: 2026-06-04
---

# Phase 2 Plan 04: Tiered Pre-flight Check Summary

**`runPreflight` verifies each roster CLI is installed (tier-1 `--version`) and authenticated+responsive (tier-2 live "pong" probe via the registry adapter), writing a gitignored `.mar/preflight.json` cache with a ~10min TTL and emitting an actionable per-agent status table — gemini correctly reports ✗ with an auth/Antigravity hint (D-32).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-04
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- `PreflightCache`/`PreflightResult` zod schema + `z.infer` types (`src/schema/preflight.ts`)
- `extractVersion` — Pitfall-2-safe semver regex: codex `"codex-cli 0.128.0"` → `"0.128.0"` (not `"codex-cli"`), claude/gemini handled by the same regex; `"unknown"` on garbage
- Atomic `writeCache`/`readCache` to `.mar/preflight.json` (temp+rename, validated both directions) + `isFresh` ~10min TTL
- `runPreflight` tier-1 (`--version` installed check) + tier-2 (live probe via `makeAdapter` + `withRetry(retries:0)`) producing installed/version/responsive/latency/hint per agent
- Vendor-appropriate FIXED hints: gemini auth/Antigravity + named env vars (D-31), codex `codex login`, claude `/login`, not-on-PATH install guidance
- `formatStatusLines` approved status table + `allPass` all-pass/any-fail signal (D-28); `.mar/` gitignored (D-27)

## Task Commits

Each task committed atomically (TDD RED → GREEN):

1. **Task 1+2: shared RED test** — `99c5cd3` (test) — preflight cache schema, version extractor, runPreflight probe matrix
2. **Task 1: cache + version GREEN** — `950be98` (feat) — PreflightCache, extractVersion, atomic cache, TTL, `.mar/` gitignore
3. **Task 2: runPreflight GREEN** — `04d3eab` (feat) — tiered check, status table, gemini hint

_Note: the single cohesive `test/preflight.test.ts` covers both tasks, so one RED commit precedes both GREEN commits (see Deviations)._

## Files Created/Modified
- `src/schema/preflight.ts` — `PreflightCache` + `PreflightResult` zod schemas and types
- `src/preflight.ts` — `extractVersion`, `writeCache`/`readCache`, `isFresh`, `runPreflight`, `formatStatusLines`
- `test/preflight.test.ts` — 18 tests: version extraction, cache round-trip/TTL, probe success/failure matrix, hint assertions
- `.gitignore` — added `.mar/`

## Decisions Made
- **One cohesive test file** spanning both tasks rather than two split files — the cache/version helpers and `runPreflight` share fixtures and a tmpdir-isolated cwd harness, so splitting would duplicate setup. RED committed once before the two GREEN commits; the TDD gate (test → feat) is preserved per task.
- **Probe failure injection via `probePrompt`** — the executable fixtures select their mode from argv, and the adapter appends the prompt as an argv element, so `{ probePrompt: "--fail-auth" }` drives a fixture's failure mode without a new env var (reuses the D-19 `bin`-override pattern).
- **`checkInstalled` keys off `exitCode !== 0`** for not-installed (ENOENT throw OR non-zero exit), matching `detectClaudeVersion`'s defensive shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Combined the two planned RED commits into one**
- **Found during:** Task 1 (test authoring)
- **Issue:** The plan specifies a separate `test(...RED)` commit per task, but a single `test/preflight.test.ts` imports both `runPreflight` (Task 2) and the cache/version helpers (Task 1) at module top. Splitting RED into two commits would have left the first commit unable to import the file.
- **Fix:** Committed the full test file once as the RED gate (`99c5cd3`), then shipped Task 1 GREEN (cache/version helpers + a throwing `runPreflight` placeholder so imports resolve) and Task 2 GREEN (real `runPreflight`). Each task still has a clean RED→GREEN transition.
- **Files modified:** test/preflight.test.ts
- **Verification:** RED confirmed (module-not-found, then placeholder-throws); both GREEN subsets pass.
- **Committed in:** 99c5cd3 (RED), 950be98 + 04d3eab (GREEN)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change. TDD gate (test commit precedes feat commits) preserved; both tasks' acceptance criteria met.

## Issues Encountered
None — all interfaces (registry, retry, config, fixtures) matched the plan's `<interfaces>` block exactly.

## TDD Gate Compliance
- RED gate: `99c5cd3` `test(02-04): ... (RED)` — confirmed failing before implementation.
- GREEN gate: `950be98` + `04d3eab` `feat(02-04): ...` after RED.
- No REFACTOR commit — biome formatting was folded into the GREEN commits.

## Verification Results
- `npx vitest run test/preflight.test.ts` — 18/18 pass
- `npx vitest run` (full suite) — 156/156 pass
- `npx tsc --noEmit` — clean
- `npx biome check src/preflight.ts src/schema/preflight.ts test/preflight.test.ts` — clean
- `grep -c '\.mar' .gitignore` → 1; `grep -E 'retries:\s*0' src/preflight.ts` → present
- No version-extraction `split(/\s` in code (only a comment); cache never written under runs/ (tests isolate to tmpdir)

## Known Stubs
None — `runPreflight`, `extractVersion`, cache I/O, and `formatStatusLines` are fully wired against the real registry/retry/adapter stack. The `mar preflight` subcommand and run-start consumption are intentionally OUT of scope (Plan 05 / Phase 3 per the objective), not stubs.

## Next Phase Readiness
- `runPreflight` + the `.mar/preflight.json` cache (TTL, all-pass/any-fail) are ready for Plan 05's `mar preflight` subcommand and Phase 3 run-start gating.
- `formatStatusLines` provides the approved status table for the CLI to print.
- Reminder (carried blocker): gemini headless auth is broken on this machine (D-32) — a real `runPreflight` run will correctly show gemini ✗ with the Antigravity/auth hint; that is expected, not a regression.

---
*Phase: 02-adapter-layer-roster-pre-flight*
*Completed: 2026-06-04*
