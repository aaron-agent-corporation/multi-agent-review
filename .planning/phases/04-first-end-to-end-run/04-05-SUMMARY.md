---
phase: 04-first-end-to-end-run
plan: 05
subsystem: protocol / decision-record writer + terminal wiring + v1 success bar
tags: [RCRD-01, RSLV-01, D-46, D-47, D-48, D-49, decision-record, gray-matter, hermetic-3-vendor]
status: checkpoint-pending
requires:
  - "src/schema/decision-record.ts DecisionRecordFrontmatter (resolved/open/tally/runChain, 04-01)"
  - "src/schema/response.ts Verdict union + src/schema/integration.ts AdditionVerdict union (04-01/04-03)"
  - "src/workspace/manifest.ts readManifest enumeration + setStatus terminal-write idiom"
  - "src/workspace/artifacts.ts toFrontmatter injection-safe WRITER + atomic temp-then-rename discipline"
  - "src/protocol/converge.ts ConvergenceResult.concessions + openDecision (04-04)"
  - "test/fixtures/fake-gemini.mjs + structured-shared.mjs --emit / [phase:<name>] modes (04-03)"
provides:
  - "src/protocol/decision-record.ts writeDecisionRecord — contested-only record from the artifact trail (RCRD-01/RSLV-01)"
  - "runs/<id>/decision-record.md — the run's auditable resolved/open decision record"
  - "engine terminal step: runProtocol calls writeDecisionRecord on completed AND escalated outcomes"
  - "3-vendor hermetic e2e proving the full 6-phase run yields a validated decision record (success criterion #1, D-49)"
affects:
  - "the phase success bar — only the LIVE 3-vendor human-verify checkpoint (D-48, Task 3) remains"
tech-stack:
  added: []
  patterns:
    - "decision-record WRITE uses a hand-rolled injection-safe YAML serializer (scalar-escaping); gray-matter stays strictly READ-only (no matter.stringify) — T-04-07"
    - "double gray-matter parse to read the AGENT's emitted frontmatter past the engine-metadata wrapper (the 04-03/04-04 rule), reused in the writer's artifact enumeration"
    - "contested-only collection (D-46): reject-with-reason/refine + integration dropped/merged-with-change become resolvedDecisions; accept/merged collapse to a one-line unanimousTally"
    - "schema validation (DecisionRecordFrontmatter.parse) BEFORE the atomic temp-then-rename write — a rationale-less resolved decision fails closed (T-04-14)"
    - "decision record written in the SAME terminal position as setStatus (off the resolved final snapshot) so no async action races the manifest"
key-files:
  created:
    - "src/protocol/decision-record.ts"
    - "test/decision-record.test.ts"
  modified:
    - "src/protocol/engine.ts"
    - "test/protocol-run.e2e.test.ts"
decisions:
  - "Integration contested vocabulary follows the SHIPPED 04-03/04-04 IntegrationFrontmatter (merged | merged-with-change | dropped+reason), per the plan's interface note that `reject-conflicts-with-resolved` maps to `dropped` with a conflict reason. `dropped` and `merged-with-change` are contested (each carries rationale); `merged` is a unanimous tally."
  - "The decision record is written on BOTH `completed` and `escalated` terminal outcomes (an escalated run still produced a merged fallback artifact + an open decision — exactly what a human reviews). A hard `failed`/`timeout` run SKIPS the record (it produced no convergence/integration trail to record). This is the plan's documented choice."
  - "The WRITER does its own injection-safe serialization (mirroring artifacts.ts toFrontmatter, extended to nested block sequences for resolved/open decisions) rather than importing toFrontmatter (which is module-private and flat-only). gray-matter is never used to stringify."
  - "Run chain is the compact run-level lineage (input → base draft:<author> → final:<integration artifact>), NOT a duplicate of the per-decision lineage already on each resolvedDecision and indexed by the manifest (D-47)."
metrics:
  duration: "~25 minutes"
  completed: "2026-06-05"
  tasks: "2 of 3 (Task 3 is a LIVE human-verify checkpoint — pending)"
  files: 4
  tests_added: 3
---

# Phase 04 Plan 05: Decision Record + Terminal Wiring + v1 Success Bar Summary

Completed the v1 success bar on fixtures: a contested-only decision-record writer assembled from the
artifact trail (RCRD-01/RSLV-01), wired as the engine's terminal run step alongside `setStatus`, and
proven by a full 3-agent hermetic run (claude+codex+gemini fixtures) that drives all 6 phases and
produces a schema-validated `decision-record.md` (success criterion #1, D-49). The record reads as
"what was argued and why it landed": contested items only, each with its agent-supplied rationale and
per-decision artifact lineage; unanimous accepts collapse to a one-line tally; escalations become open
decisions. The two hermetic tasks are done and committed; the remaining Task 3 is a true 3-vendor LIVE
human-verify checkpoint (D-48) that cannot be automated — execution STOPPED there.

## What Was Built

### Task 1 — Decision-record writer (commit 957512a)
- `src/protocol/decision-record.ts` (new): `writeDecisionRecord(runDir, convergence?)`.
  1. `readManifest` enumerates artifacts; each `response`/`integration` artifact is parsed with the
     **double gray-matter parse** (strip the engine-metadata wrapper, `trimStart`, parse the agent's
     frontmatter — the 04-03/04-04 rule) then validated with the relevant 04-01 zod schema (READ-only).
  2. Contested-only collection (D-46): response `reject-with-reason`/`refine` and integration
     `dropped`/`merged-with-change` → `resolvedDecisions[]`, each with an `id`, `summary`, the
     agent-supplied `rationale` (reason/refinement/change), and a `lineage[]` of per-decision artifact
     refs (D-47). Convergence `concessions` → resolved decisions too (RSLV-01: every concession logged).
  3. Unanimous `accept`/`merged` verdicts collapse into a single `unanimousTally` count (D-46) — never
     individual entries.
  4. `convergence.openDecision` (escalation, D-42) → `openDecisions[]`.
  5. Compact `runChain` (input → base draft → final integration artifact, D-47 — no duplicate full graph).
  6. `DecisionRecordFrontmatter.parse` validates the assembled object (T-04-14: rationale required)
     BEFORE writing `runs/<id>/decision-record.md` via atomic temp-then-rename (T-04-15) using a
     hand-rolled injection-safe YAML serializer + a human rationale narrative body. gray-matter is never
     used to stringify.
- `test/decision-record.test.ts` (new): a fixture artifact trail (a contested reject-with-reason + two
  accepts, a merged + a dropped integration verdict, an escalation with a concession) asserts the
  contested items appear as resolvedDecisions WITH rationale + lineage, the escalation as an
  openDecision, the unanimous count (3) in unanimousTally, per-decision lineage present, and the
  on-disk frontmatter validates. A second case proves a trivially-converged run still yields a
  parseable record with empty contested/open sets.

### Task 2 — Terminal wiring + 3-vendor hermetic e2e (commit 3e4f51c)
- `src/protocol/engine.ts`: `runProtocol` calls `await writeDecisionRecord(runDir,
  snapshot.context.convergence)` at the terminal `done` state, BEFORE `setStatus`, on both `completed`
  and `escalated` outcomes (documented: hard `failed`/`timeout` skips it). Same terminal position as
  `setStatus` off the resolved final snapshot — no async action races the manifest.
- `test/protocol-run.e2e.test.ts`: added a THREE-vendor hermetic roster (claude+codex+gemini fixtures
  with `MAR_EMIT_BASE=claude` so they agree on round 1) driving `mar run` end-to-end. Asserts status
  `completed`; one artifact per surviving agent per structured phase kind (3×5 + 1 integrator = 16);
  and `decision-record.md` exists + validates against `DecisionRecordFrontmatter`. The existing
  2-vendor RED-anchor and single-vendor-refusal cases are unchanged and still pass.

## Verification

- `npx vitest run test/decision-record.test.ts` — green (2 new tests).
- `npx vitest run test/protocol-run.e2e.test.ts` — green (3 tests: 2-vendor, 3-vendor, single-vendor-refusal).
- `npx vitest run` (full suite) — **267 passed / 33 files** (was 264; +3), no Phase-1/2/3/04-prior regressions.
- `npx tsc --noEmit` — clean. `npx biome check` — clean (76 files).

## Deviations from Plan

### Plan-vs-schema reconciliation (not a code defect)

The plan's Task 1 text references an integrator `reject-conflicts-with-resolved` judgment. The shipped
04-03/04-04 `IntegrationFrontmatter` uses `dropped` + `reason` for a rejected/conflicting addition (the
plan's own `<interfaces>`/04-04 SUMMARY note this). The writer treats `dropped` (and `merged-with-change`)
as contested resolvedDecisions carrying the agent's reason/change as rationale — same behavioral intent,
honoring the existing schema contract rather than redefining it.

### Auto-fixed Issues

None beyond biome auto-format on the two test files (line-wrapping + import order; no behavior change),
applied as part of the verification gate.

## Threat Model Compliance

- **T-04-14 (resolved decision missing rationale/lineage):** mitigated — `DecisionRecordFrontmatter`
  requires a non-empty `rationale` on each resolvedDecision; the writer calls `.parse` (throws on a
  rationale-less entry) BEFORE writing. Asserted in test/decision-record.test.ts.
- **T-04-15 (half-written record on crash):** mitigated — atomic temp-then-rename (the
  writeArtifact/writeManifestAtomic discipline); never written live in place. Asserted: no `.tmp`
  leftover after write.
- **T-04-16 (ancestor instruction leakage in the LIVE run):** the hermetic proof (Task 2) does not
  exercise live ancestor inheritance; this is explicitly the subject of the Task 3 live checkpoint
  (step 5 checks for GSD-workflow leakage). Not yet verified live — pending.
- **T-04-17 (GEMINI_API_KEY in logs):** accept (vendor-managed env var; existing logger redacts).
  Relevant only to the live path (Task 3).

## Known Stubs

None. The decision-record writer is fully implemented and exercised by both the unit test and the
3-vendor hermetic e2e. The only outstanding work is the LIVE human-verify checkpoint (Task 3), which is
a verification gate, not a stub.

## Threat Flags

None — no security surface beyond the planned threat register was introduced. The new disk reads
(response/integration artifacts) use gray-matter's default js-yaml SAFE load, like the 04-03/04-04 reads.

## Checkpoint Status

**Task 3 (TRUE 3-vendor LIVE run human-verify, D-48) is PENDING — gate="blocking", autonomous: false.**
This checkpoint cannot be automated (live multi-vendor auth + human judgment of agent output quality)
and was NOT faked or skipped. The hermetic 3-vendor proof (Task 2) satisfies D-49; the live 3-vendor
success bar requires the human-run checkpoint below. See the executor return for the exact commands.

## Self-Check: PASSED

- FOUND: src/protocol/decision-record.ts, test/decision-record.test.ts (created); src/protocol/engine.ts,
  test/protocol-run.e2e.test.ts (modified).
- FOUND commits: 957512a (Task 1), 3e4f51c (Task 2) — both in git log.
- Full suite 267/267, tsc clean, biome clean.
