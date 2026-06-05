---
phase: 03-protocol-engine-independence-enforcement
plan: 02
subsystem: protocol-engine + cli
tags: [PROT-01, PROT-03, PROT-04, xstate, protocol-engine, gate, e2e-green]
requires:
  - "src/workspace/scope.ts scopedWorkdir/promoteDrafts (Plan 03-01)"
  - "TurnRequest.cwd optional field (Plan 03-01)"
  - "src/cli.ts runInvoke turn seam (withRetry + makeAdapter)"
  - "src/gates.ts assertReviewable"
  - "src/workspace/{layout,artifacts,manifest}.ts naming/done/manifest primitives"
provides:
  - "src/protocol/phases.ts: frozen typed 6-phase PHASES descriptor array"
  - "src/protocol/gate.ts: requiredArtifactsExist (PROT-03 single-source-of-truth gate) + expectedPhaseArtifacts + expectedParticipantCount"
  - "src/protocol/engine.ts: runProtocol XState v5 machine driving all 6 phases (PROT-01/03/04)"
  - "src/cli.ts: `mar run <input>` subcommand (thin controller delegating to runProtocol)"
affects:
  - "Plan 03-03 (next wave) builds structured review content + planted-error A/B on this engine"
tech-stack:
  added:
    - "xstate@^5 (5.32.0) — protocol-engine substrate, human-verified legitimacy (Task 0 gate)"
  patterns:
    - "XState v5 setup({actors}).createMachine() with one fromPromise fan-out actor per phase"
    - "fan-out actor RESOLVES WITH the exact written-paths array — the gate's single source of truth (gated == written)"
    - "bare Promise.allSettled fan-out (no p-limit); manifest appended sequentially AFTER allSettled to avoid concurrent read-modify-write corruption"
    - "scoped-phase seq=1 per agent (isolated dirs, no collision) vs shared-phase distinct monotonic seq via nextSeq base+index"
    - "promoteDrafts as a dedicated awaited transient-state actor at the draft->review boundary (not a fire-and-forget action)"
key-files:
  created:
    - src/protocol/phases.ts
    - src/protocol/gate.ts
    - src/protocol/engine.ts
    - test/protocol-gate.test.ts
    - test/protocol-engine.test.ts
  modified:
    - src/cli.ts
    - test/protocol-run.e2e.test.ts
    - package.json
    - package-lock.json
decisions:
  - "XState v5 ratified over RESEARCH's sequential-loop recommendation (03-PATTERNS ratification note); engine is the first statechart in the repo"
  - "xstate is the ONLY new package; p-limit deliberately NOT installed (≥2-vendor MVP roster doesn't need throttling)"
  - "Gate is the single source of truth: the fan-out resolves with EXACTLY the paths it wrote; the gate never recomputes seqs/paths"
  - "Manifest writes serialized after the concurrent fan-out (a concurrent read-modify-write race corrupted manifest.json — fixed)"
  - "Scoped draft artifacts are WRITTEN into work/<agent>/ (not the run root) so promoteDrafts copies them to shared/ at the boundary; draft seq is 1 for every agent (isolated dirs)"
metrics:
  duration: ~14 min (excluding checkpoint wait)
  completed: 2026-06-04
  tasks: 3 (+ Task 0 checkpoint)
  files: 9
---

# Phase 3 Plan 02: Protocol Engine + `mar run` Summary

Built the XState v5 protocol engine that drives an input document through all 6 gated phases (draft → review → response → evaluation → integration → validation) with structural draft independence and an artifacts-on-disk phase gate, plus the thin `mar run <input>` CLI — turning the Plan-01 RED e2e anchor GREEN. PROT-01/03/04 land together as one observable capability: a user can now run the full protocol end-to-end on a document.

## What Was Built

**Task 0 — xstate@5 legitimacy gate (checkpoint).** Human-verified `xstate@^5` (5.32.0, Stately/statelyai, MIT) before install per the package-provenance fallback policy. It is the ONLY new package this phase; `p-limit` is deliberately not installed (bare `Promise.allSettled`).

**Task 1 — `phases.ts` + `gate.ts` (PROT-03).** `PHASES` is a frozen typed 6-entry descriptor array (kind === name; only `draft` scoped; all `participants: "all"` in Phase 3), built with the `as const` registry idiom. `gate.ts` exports three pure functions: `requiredArtifactsExist(writtenPaths)` — the LIVE gate, `writtenPaths.every(isDone)` over ONLY the caller-supplied paths (no seq/path derivation, 0-byte guard via `isDone`); `expectedPhaseArtifacts(...)` — a test-only derivation helper taking an explicit seq map; and `expectedParticipantCount(phase, roster)` — the short-write count (roster.length in the all-mode). 7 gate tests cover the 6-phase shape, the isDone gate (missing/0-byte/vacuous-empty), and the count helper for 2- and 3-agent rosters.

**Task 2 — `engine.ts` runProtocol (PROT-01/03/04).** A `setup({ actors }).createMachine()` machine with one state per phase, each invoking a `fromPromise` fan-out actor that runs the roster N-wide with bare `Promise.allSettled`, reuses the proven turn seam unchanged (`withRetry(makeAdapter(...).invoke(...))` + `logInvocation`), and RESOLVES WITH the exact array of written artifact paths. A guard checks `requiredArtifactsExist(writtenPaths) && writtenPaths.length === expectedParticipantCount(phase, roster)` (short-write detection) before advancing; gate-false routes to a `failed` final state. The draft phase runs each agent in `scopedWorkdir(...)` cwd, writes its draft into `work/<agent>/`, and a dedicated `promote` transient-state actor runs `promoteDrafts` at the draft→review boundary (PROT-04). 5 engine tests cover: the 6-kind happy path (12 artifacts, 2 per kind, status "completed"); the gated==written source-of-truth assertion (spy captures each phase's gate input and asserts it equals the manifest's per-phase paths); draft scoping + promotion; a short-write → status "failed" → no-advance; and allSettled partial-failure (a failed agent never rejects the fan-out).

**Task 3 — `mar run <input>` + e2e GREEN (PROT-01).** A thin `runRun` controller: `loadConfig` → `assertReviewable` (NOT gate-exempt, ≥2 vendors) → bounded input validation (regular file ≤10MB) → `createRun` (status "running") → delegate to `runProtocol`. No vendor argv / no phase logic in the CLI; no auto-preflight (D-27). The Plan-01 RED anchor now passes GREEN unchanged, and a new "refuses <2 vendors" e2e proves a single-vendor roster exits 2 with the ≥2-distinct-vendor message and no run created (gate fires before `createRun`).

## Verification

- `npx vitest run test/protocol-gate.test.ts` → 7 passed.
- `npx vitest run test/protocol-engine.test.ts` → 5 passed.
- `npx vitest run test/protocol-run.e2e.test.ts` → 2 passed (the now-GREEN anchor + "refuses <2 vendors").
- **Full suite: 196 passed (23 files)** — up from 182 + the intentional RED anchor; no regressions.
- `npx tsc --noEmit` clean; `npx biome check` clean on all created/modified files.
- Manual grep gates confirmed: seam reuse (withRetry/makeAdapter ≥1), bare allSettled (Promise.all/p-limit/artifacts.length === 0), gated==written (writtenPaths + requiredArtifactsExist), short-write guard (expectedParticipantCount), scope wiring (scopedWorkdir/promoteDrafts), thin CLI (assertReviewable + runProtocol present, runPreflight count unchanged at 5).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Serialized manifest writes to fix concurrent read-modify-write corruption**
- **Found during:** Task 2 (engine tests failed with "Unexpected non-whitespace after JSON" + lost artifacts)
- **Issue:** Each agent task called `addArtifact` concurrently inside the `allSettled` fan-out. `addArtifact` does read-modify-write on the single `manifest.json` with a `tmp-${process.pid}` temp file — concurrent calls share the pid, clobber each other's temp file, and lose/corrupt entries.
- **Fix:** Agent tasks now write only their independent ARTIFACT files concurrently (distinct paths, no race) and return the artifact metadata; the manifest `addArtifact` calls run SEQUENTIALLY after `allSettled`.
- **Files modified:** src/protocol/engine.ts
- **Commit:** 0d604a3

**2. [Rule 3 - Blocking] Scoped-phase artifact path + seq reconciliation**
- **Found during:** Task 2 (promoteDrafts could not find drafts; happy path returned "failed")
- **Issue:** `writeArtifact(runDir, ...)` wrote drafts to the run root, but `promoteDrafts` copies from `work/<agent>/001-<agent>-draft.md`; and `base+index` seqs gave codex's draft seq 2, while `draftFileName` hardcodes seq 1.
- **Fix:** Scoped phases write their artifact into the scoped cwd (`work/<agent>/`) and use seq 1 for every agent (isolated dirs → no collision, matches scope.ts's `draftFileName` contract); shared phases keep distinct monotonic `nextSeq` base+index seqs. Manifest path stays relative to runDir.
- **Files modified:** src/protocol/engine.ts
- **Commit:** 0d604a3

**Plan-text note (not a code deviation):** the engine test injects a genuine agent failure via a non-existent `bin` (the cli-roster precedent) rather than appending `--fail-auth` to a `node <script>` bin string — `splitBin` collapses `node <script> --flag` into a single un-runnable argv, so the nonexistent-bin path is the correct hermetic failure injection. The observable behavior (a draft never written → short-write gate fail) is identical to the plan's intent.

## Authentication Gates

None — all turns ran against fake fixtures (zero credits).

## Threat Model Coverage

- **T-03-05 (supply chain / xstate):** mitigated — Task 0 blocking-human legitimacy gate cleared (statelyai, 5.x, MIT); xstate is the only new package, p-limit not installed.
- **T-03-06 (draft-phase info disclosure):** mitigated — engine passes `cwd=scopedWorkdir` only for the scoped draft phase, writes the draft INTO `work/<agent>/`, and runs `promoteDrafts` only at the draft→review boundary; engine test asserts a peer's draft is absent from another agent's workdir and present in shared/ only after draft.
- **T-03-07 (partial/empty/short artifacts):** mitigated — gate judges ONLY the fan-out's written paths (gated==written, tested) via `isDone` (size>0), and the guard checks `length === expectedParticipantCount`; a short/0-byte/missing write → status "failed", no advance.
- **T-03-08 (single-vendor bypass):** mitigated — `assertReviewable` on the run path (not exempt); "refuses <2 vendors" e2e proves exit 2 + message + no run created.
- **T-03-09 (oversized input):** mitigated — input bounded to MAX_PROMPT_FILE_BYTES (10MB) before any copy/spawn.
- **T-03-10 (hung agent):** mitigated — per-turn execa wall-clock timeout + bare allSettled; the gate decides sufficiency.

## Known Stubs

The per-phase prompt is a minimal placeholder (`phase: <name>\ninput: <path>`) that yields *a* phase artifact per agent — structured review CONTENT (numbered issues, severity, accept/reject) is intentionally deferred to Phase 4 (RESEARCH A4 / REVW-*). This is the documented Phase-3 scope boundary, not an accidental stub: the engine, gating, independence, and turn-taking are fully real; only the prompt body is a placeholder. Plan 03-03 / Phase 4 wire structured content.

## Self-Check: PASSED

- Created files present: src/protocol/{phases,gate,engine}.ts, test/protocol-{gate,engine}.test.ts — all FOUND.
- Commits present: a55784c (gate+phases), 0d604a3 (engine), 92406b9 (mar run + e2e GREEN), 6669296 (xstate) — all FOUND in git log.
