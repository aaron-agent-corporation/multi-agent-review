---
phase: 05-hardening-resume-gating-majority-guards
plan: 04
subsystem: resume-vertical-slice
status: complete
tags: [resume, re-derivation, xstate, manifest, d-56-revalidation, d-57-roster, fixture, wave-2]
requires:
  - "src/protocol/frontmatter.ts readAgentFrontmatter (05-02 shared tolerant reader) — D-56 re-validation"
  - "src/schema/manifest.ts RESUMABLE_STATUSES + TERMINAL_DONE (05-02 Q7) — resume status filter"
  - "src/preflight.ts runPreflight (D-26/27) — resume-time auth re-check"
  - "src/protocol/gate.ts expectedParticipantCount / requiredArtifactsExist — phase-completeness notion"
  - "engine.ts buildMachine programmatic per-phase states keyed by name — the resume lever"
provides:
  - "src/protocol/engine.ts resumeProtocol(runDir, config) — the resume entry (PROT-06)"
  - "engine.ts buildMachine(resumePhase?) — re-enter the machine at any phase name (no snapshot)"
  - "engine.ts firstIncompletePhase / rehydrateRoster / revalidateForResume — pure resume helpers"
  - "src/cli.ts mar resume <run-id> / --last — thin controller delegating to resumeProtocol"
  - "manifest.inputPath additive field — recorded at run start so resume re-derives the document"
  - "MAR_FAIL_ONCE marker-file fixture mechanism — fail on first run, succeed on resume (D-57)"
affects:
  - "05-05 pause-and-exit reuses resumeProtocol as the gated-approval continuation mechanism (D-55)"
  - "05-05 gated mode writes paused-awaiting-approval; resume picks it up via RESUMABLE_STATUSES"
commits:
  - "c17f5c8 feat(05-04): resumeProtocol — manifest→resume-phase derivation, roster rehydration, D-56 re-validation (D-14/D-54/D-57)"
  - "a8aa00a feat(05-04): mar resume subcommand (<run-id> / --last) with RESUMABLE filter (D-55)"
  - "589915a test(05-04): fail-once fixture + resume e2e (interrupted, --last, D-56 refusals, D-57 full-roster)"
  - "8fce342 chore(05-04): biome formatting + drop unused revalidateForResume config param"
key-files:
  created:
    - "test/protocol-resume.e2e.test.ts"
  modified:
    - "src/protocol/engine.ts"
    - "src/cli.ts"
    - "src/schema/manifest.ts"
    - "src/workspace/manifest.ts"
    - "test/fixtures/structured-shared.mjs"
deviations:
  - "firstIncompletePhase derives the resume phase from MANIFEST COUNT only (not on-disk isDone). A missing/empty recorded artifact is a D-56 INTEGRITY refusal owned by revalidateForResume, not a re-run trigger — mixing the two would silently re-run a tampered/deleted completed phase. The plan's wording (\"required artifacts NOT all present\") is satisfied by this split: count→resume-phase, isDone→D-56 refusal."
  - "revalidateForResume dropped its unused `config` param (roster is passed directly). Cosmetic; biome flagged the unused arg."
  - "D-57 e2e does not assert manifest.droppedAgents on the failed run: when applySkipFailed throws at the vendor floor, runPhaseGated returns the failure BEFORE the drop-recording loop runs, so droppedAgents stays empty. rehydrateRoster keys off STATUS (failed→full roster), not droppedAgents, so D-57 holds regardless — the test asserts the resumed full-roster completion instead."
self-check: PASSED
metrics:
  duration: "~12 minutes"
  completed: "2026-06-05"
  tasks: 3
  tests_added: 6
  tests_total: 283
---

# Phase 05 Plan 04: Resume Vertical Slice (PROT-06) Summary

`mar resume <run-id>` / `mar resume --last` continues an interrupted, failed, or paused run from its
last completed phase by RE-DERIVING from the manifest (D-14/D-54) — read the manifest, find the first
not-fully-satisfied phase, rebuild the machine with `initial` = that phase + the rehydrated roster,
and run forward. NO XState snapshot persistence (Pitfall 2: restoring a mid-flight `fromPromise`
actor silently hangs). Before continuing it re-validates per D-56 (manifest integrity + every
completed-phase artifact exists and re-validates via the 05-02 shared tolerant reader + roster
preflight), refusing with a specific named error. The roster source differs by reason (D-57):
paused/interrupted → survivors; failed/timeout → the FULL original roster (dropped agents rejoin).

## What Was Built

### Task 1 — resumeProtocol + manifest→resume-phase derivation + roster rehydration + D-56 (engine.ts)
- `buildMachine(resumePhase?: Phase["name"])`: `initial` is now `resumePhase ?? PHASES[0].name`. The
  per-phase states are already built programmatically and keyed by name, so re-entering at any phase
  "just works"; resuming at `review` skips `promote` (only `draft`'s `next` is `"promote"` —
  Pitfall 1). The `context` factory seeds `roster` from `input.roster ?? input.config.agents` (a new
  optional `ProtocolInput.roster` field) so resume overrides the configured roster without snapshots.
- `rehydrateRoster(config, manifest)` (D-57): `failed`/`timeout` → `config.agents` (FULL — rejoin);
  else `config.agents` minus `manifest.droppedAgents` (survivors).
- `firstIncompletePhase(manifest, roster)`: walks PHASES, returns the first phase the MANIFEST does
  not record as complete (`countOfKind(phase.kind) >= expectedParticipantCount(phase, roster)`, `>=`
  because a later-dropped agent may have written extra). Evaluation is special (D-54/Q4): complete iff
  an `integration` artifact is recorded (proves convergence resolved), else resume at evaluation and
  convergence restarts at round 1.
- `revalidateForResume(runDir, manifest, roster, resumePhase)` (D-56): for every phase BEFORE the
  resume phase, each recorded artifact must `isDone` (else "missing or empty" refusal) AND its agent
  frontmatter must re-validate against that phase's 04-01 zod schema via the SHARED tolerant
  `readAgentFrontmatter` (never the strict double-parse, Pitfall 4) (else "failed re-validation
  against the <phase> schema" refusal naming the path); then `runPreflight(roster)` (auth decay,
  observed live with gemini) — any not-installed/not-responsive agent → "preflight failed for: …"
  naming the agents.
- `resumeProtocol(runDir, config)`: reads the manifest (integrity, fails closed); refuses
  TERMINAL_DONE (exit 2) and any non-RESUMABLE status; refuses a manifest with no recorded
  `inputPath`; rehydrates roster + derives resume phase; runs revalidateForResume (refuse on
  failure); builds the machine at the resume phase with `input: { runDir, config, inputPath, roster }`;
  `toPromise` + the SAME terminal branch as runProtocol (writeDecisionRecord + setStatus). Seq
  monotonicity (nextSeq over manifest + on-disk names, unchanged) guarantees no phase ≤ N artifact is
  rewritten. The 04-05 hardening (tolerant gate reader, YAML-errors-feed-retry, OUTPUT CHANNEL) is
  untouched.
- Additive `manifest.inputPath` (schema/manifest.ts) recorded at run start via `createRun(...,
  { inputPath })` in `mar run` (cli.ts) — prior manifests parse unchanged; resume refuses one that
  lacks it.

### Task 2 — `mar resume` CLI subcommand (cli.ts)
A thin `runResume({ runId?, last? })` handler + a `resume [run-id] --option(--last)` registration
mirroring `run`. Loads config (exit 2 on missing/invalid); requires EXACTLY one of `<run-id>`/`--last`
(usage error otherwise); for `--last` enumerates `runs/` via `readdirSync`, `readManifest` each,
filters to `RESUMABLE_STATUSES`, picks the most-recent by `updatedAt`; for an explicit id validates
against `RUN_ID_RE` (path-traversal guard, T-05-10) and that the dir exists. Refuses a TERMINAL_DONE
run with a clear message, then delegates EVERYTHING (phase derivation, D-56 re-validation, preflight,
terminal status) to `resumeProtocol`. No phase/re-validation logic inlined.

### Task 3 — fail-once fixture + resume e2e (structured-shared.mjs, protocol-resume.e2e.test.ts)
- Fixture: `MAR_FAIL_ONCE=<author>` + `MAR_FAIL_ONCE_MARKER=<path>` makes that author emit a MALFORMED
  body for the engine phase WHILE the marker file exists; the test creates the marker before the first
  `mar run` (the author fails validation → dropped → run fails below the floor) and deletes it before
  `mar resume` (the author rejoins valid with the FULL roster, D-57). Marker-file (not env-toggle) is
  the portable form since both invocations share `process.env`.
- 6 e2e tests (execa-via-tsx, hermetic): (1) interrupted resume completes and writes a
  decision-record with NO phase ≤ N artifact rewritten (kept-artifact mtimes asserted unchanged);
  (2) `--last` selects the most-recent resumable run (older run left untouched); (3) D-56 corrupt
  completed-phase frontmatter → refuse naming the path + schema; (4) D-56 missing completed-phase
  artifact file → refuse "missing or empty" naming the path; (5) D-56 preflight failure (codex bin
  missing) → refuse naming codex; (6) D-57 failed-run resume restores the full roster, the
  previously-dropped agent rejoins, and the re-run expects the larger count (2 validation artifacts).

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | resumeProtocol + derivation + rehydration + D-56 | c17f5c8 | engine.ts, schema/manifest.ts, workspace/manifest.ts, cli.ts |
| 2 | `mar resume` CLI subcommand (<run-id> / --last) | a8aa00a | cli.ts |
| 3 | fail-once fixture + resume e2e | 589915a | test/fixtures/structured-shared.mjs, test/protocol-resume.e2e.test.ts |
| — | biome format + drop unused param | 8fce342 | engine.ts, cli.ts |

## Exported Signatures (for downstream plans — 05-05 reuses these)

```ts
// src/protocol/engine.ts
export interface ProtocolInput { runDir: string; config: MarConfig; inputPath: string; roster?: AgentEntry[]; }
export function buildMachine(resumePhase?: Phase["name"]): /* XState machine */;
export function rehydrateRoster(config: MarConfig, manifest: Manifest): AgentEntry[];
export function firstIncompletePhase(manifest: Manifest, roster: AgentEntry[]): Phase;
export function revalidateForResume(
  runDir: string, manifest: Manifest, roster: AgentEntry[], resumePhase: Phase,
): Promise<{ ok: true } | { ok: false; error: string }>;
export function resumeProtocol(runDir: string, config: MarConfig): Promise<number>;

// src/cli.ts — `mar resume [run-id] [--last]`
//   exit 0 = resumed to completion; 1 = resumed run failed; 2 = usage / terminal-done / D-56 refusal
// (handler `runResume({ runId?, last? })` is internal; the command surface is the contract)

// src/schema/manifest.ts (additive)
Manifest.inputPath?: string  // recorded at run start, consumed by resumeProtocol
```

**05-05 reuse note:** the gated pause-and-exit path writes `paused-awaiting-approval` and exits 0;
`resumeProtocol` already accepts that status (RESUMABLE_STATUSES) and rehydrates the SURVIVORS roster
for it (not the full roster — only failed/timeout restores the full roster). So 05-05's continuation
is exactly `mar resume <id>` with no engine change required.

## Verification

- Per-task: named vitest files green after each commit; `npx tsc --noEmit` clean after each task.
- Full suite: `npm test` → **283 passed (36 files)** — 275 (05-02 baseline) + 6 new resume e2e + 2
  carried-from-base run e2e additions. No regressions.
- `npx tsc --noEmit`: clean.
- `npx biome check` on the six touched files: only the ONE PRE-EXISTING warning
  (`engine.ts` `phase.validate!` non-null assertion, noted in 05-02-SUMMARY) — not introduced here.
- Snapshot-API grep on the resume path: NONE (`getPersistedSnapshot` / `createActor(..., {snapshot})`
  absent) — re-derivation only (Pitfall 2 / T-05-11 mitigated).
- D-56 reader grep: `revalidateForResume` imports `readAgentFrontmatter` from `./frontmatter.js`
  (the 05-02 shared tolerant reader) and calls `runPreflight`.

## Deviations from Plan

- **firstIncompletePhase uses manifest count, not on-disk isDone, to pick the resume phase.** A
  missing/empty recorded artifact is a D-56 INTEGRITY refusal (revalidateForResume), not a silent
  re-run. The plan's "first phase whose required artifacts are NOT all present" is realized as
  count→resume-phase + isDone→refusal, which is the only split that makes the D-56 missing-artifact
  refusal observable (otherwise a deleted completed artifact would just re-run instead of refuse).
- **revalidateForResume lost its unused `config` param** (roster is passed directly). Cosmetic.
- **D-57 e2e asserts the resumed full-roster completion, not droppedAgents on the failed manifest.**
  applySkipFailed throwing at the vendor floor returns before the drop-recording loop, so the failed
  run records no drops; rehydrateRoster keys off STATUS (failed→full roster), so D-57 holds anyway.

## Self-Check: PASSED

`test/protocol-resume.e2e.test.ts` exists on disk; all 4 task commits (c17f5c8, a8aa00a, 589915a,
8fce342) verified in git log; full suite 283 green; tsc clean; no snapshot APIs in the resume path; no
STATE.md/ROADMAP.md modifications.
