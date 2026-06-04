---
phase: 02-adapter-layer-roster-pre-flight
plan: 03
subsystem: roster
tags: [config, zod, discriminated-union, gates, init, tdd]
requires:
  - "src/schema/manifest.ts (zod object + z.infer style)"
  - "src/workspace/manifest.ts (readManifest read->parse; writeManifestAtomic temp+rename)"
  - "src/workspace/layout.ts (pure-fn derivation style)"
provides:
  - "MarConfig zod discriminated-union roster schema + types (src/schema/config.ts)"
  - "loadConfig + resolveAgent single name-resolution path (src/config.ts)"
  - "distinctVendors + assertReviewable + applySkipFailed pure gates (src/gates.ts)"
  - "detectVendors PATH-walk + writeStarterConfig atomic writer (src/init.ts)"
affects:
  - "Plan 05 (CLI wiring: mar invoke roster-resolve, mar init, mar preflight)"
  - "Phase 3 mar run (consumes assertReviewable / applySkipFailed gates)"
tech-stack:
  added: []
  patterns:
    - "zod v4 discriminatedUnion('vendor', ...) for per-vendor field typing (ORCH-03 seam)"
    - "zod v4 .prefault({}) (NOT .default({})) so nested object field defaults fire"
    - "superRefine for cross-field (duplicate-name) validation"
    - "PATH-walk via existsSync (no shell) for binary detection"
    - "atomic temp+rename config write mirroring writeManifestAtomic"
key-files:
  created:
    - "src/schema/config.ts"
    - "src/config.ts"
    - "src/gates.ts"
    - "src/init.ts"
    - "test/config.test.ts"
    - "test/gates.test.ts"
    - "test/init.test.ts"
  modified: []
decisions:
  - "Used zod v4 `.prefault({})` instead of the RESEARCH-cited `.default({})` for the defaults block — in zod v4 `.default()` returns the literal fallback without re-parsing, so nested timeoutMs/retries defaults would not apply."
  - "resolveAgent throws (does not return undefined) on a miss, naming valid agent names — keeps the single-resolution-path contract (D-20) loud."
  - "applySkipFailed asserts over the healthy survivors only; the dropped/failed list is informational — the diversity invariant (>=2 distinct) is re-checked structurally (D-30)."
metrics:
  duration_min: 18
  tasks: 3
  files: 7
  completed: "2026-06-04"
---

# Phase 2 Plan 03: Roster Layer (Config + Gates + Init) Summary

Zod-validated `mar.config.json` roster (discriminated union on vendor) with a single name-resolution path, the pure ORCH-04 vendor-distinctness gate, and `mar init` PATH detection + starter-config writer — all built TDD (RED then GREEN per task), no CLI wiring (deferred to Plan 05).

## What Was Built

**Task 1 — `src/schema/config.ts` + `src/config.ts`:**
- `MarConfig`: `agents: z.array(Agent).min(1)` where `Agent` is a `discriminatedUnion("vendor", [...])` over `claude|codex|gemini`, each carrying the shared `Base` fields (`name`, optional `bin`/`model`/`timeoutMs`/`extraArgs[]`). A `superRefine` rejects duplicate agent names, naming the dup. The `defaults` block defaults `timeoutMs` to 600000 and `retries` to 2 (D-23). The >=2-vendor rule is deliberately NOT enforced here — single-vendor configs load (D-29 exemption).
- `loadConfig(path = "mar.config.json")`: missing-file -> `no roster: <path> not found (run \`mar init\`)`; otherwise read -> JSON.parse -> validate with per-issue error formatting.
- `resolveAgent(config, name)`: the single name-resolution path (D-20); throws naming all valid names on a miss.

**Task 2 — `src/gates.ts` (pure, no I/O):**
- `distinctVendors(agents)` -> `Set<string>`.
- `assertReviewable(agents)`: D-29 hard gate, no override — throws `review needs >=2 distinct vendors; found: <vendors|"none">` when fewer than two distinct vendors.
- `applySkipFailed(healthy, failed)`: D-30 — returns the healthy set after asserting >=2 distinct vendors remain, so dropping failing agents can never silently produce a single-vendor run.

**Task 3 — `src/init.ts`:**
- `onPath(bin)`: PATH-walk via `existsSync` (PATHEXT on win32), NO shell (T-02-11).
- `detectVendors()`: returns which of claude/codex/gemini are on PATH.
- `writeStarterConfig(path, vendors)`: builds a `MarConfig` (one `<vendor>-1` agent each + defaults), validates via `MarConfig.parse`, writes atomically (temp+rename, `JSON.stringify(x, null, 2) + "\n"`).

## Verification

- `npx vitest run` — 11 files, **71 tests pass** (config 10, gates 7, init 4 new; all pre-existing green).
- `npx tsc --noEmit` — clean (exit 0).
- `npx biome check src/schema/config.ts src/config.ts src/gates.ts src/init.ts` — clean.
- `grep -c 'min(2)|>= *2|distinct' src/schema/config.ts` == 0 (no vendor-count rule at config load).
- `src/gates.ts` has zero `node:fs`/`fs-extra` imports (pure).
- `grep -c 'shell:true|execSync|child_process' src/init.ts` == 0 (no shell).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] zod v4 nested defaults did not fire with `.default({})`**
- **Found during:** Task 1 (GREEN run — `defaults.retries`/`timeoutMs` came back `undefined`).
- **Issue:** The RESEARCH Pattern 4 used `defaults: z.object({...}).default({})`. In zod v4 `.default()` returns the literal fallback value WITHOUT re-parsing it, so the inner `timeoutMs.default(600000)` / `retries.default(2)` never applied — a 2-agent roster parsed with `defaults: {}`.
- **Fix:** Switched to `.prefault({})`, which runs the fallback through the schema so nested field defaults apply (verified: omitted `defaults` -> `{timeoutMs:600000, retries:2}`; partial `{retries:5}` -> `{timeoutMs:600000, retries:5}`).
- **Files modified:** `src/schema/config.ts`
- **Commit:** a0fb610 (GREEN); comment refined in e2bca64

**2. [Rule 3 - Blocking] Worktree missing `node_modules`**
- **Found during:** Task 1 setup (vitest/tsc/biome unavailable).
- **Fix:** Ran `npm install` in the worktree (no new packages added — installed the existing pinned deps from `package-lock.json`; no lockfile drift; `node_modules/` is gitignored).

**3. [Rule 1 - Bug] verification grep matched an explanatory doc comment**
- **Issue:** The broader plan-verification grep `>= *2` matched the JSDoc comment that explicitly says the rule is NOT enforced at config load.
- **Fix:** Reworded the comment ("two-vendor-minimum rule") so the grep is unambiguously 0 without changing behavior.
- **Commit:** e2bca64

## TDD Gate Compliance

Each task followed RED -> GREEN. Gate commits present in git log:
- Task 1: `test(02-03): ...(RED)` d171291 -> `feat(02-03): ...(GREEN)` a0fb610
- Task 2: `test(02-03): ...(RED)` cb226f8 -> `feat(02-03): ...(GREEN)` e79f918
- Task 3: `test(02-03): ...(RED)` 982f2e4 -> `feat(02-03): ...(GREEN)` be393d8

No test passed unexpectedly during any RED phase (each RED failed on a missing module import, as expected for new files).

## Known Stubs

None. All four source files are fully wired; no placeholder data paths.

## Threat Flags

None. No new trust boundaries beyond those in the plan's threat model. T-02-10 (config validation) is mitigated by `MarConfig.parse` rejecting unknown vendor / dup name before any value is used. T-02-11 (init PATH detection) is mitigated by the no-shell `existsSync` walk. T-02-12 (single-vendor bypass) is mitigated by `assertReviewable` (no override flag exists).

## Self-Check: PASSED

All 7 source/test files and the SUMMARY exist on disk; all 7 task commits are present in git log.
