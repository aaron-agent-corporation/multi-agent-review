---
phase: 05-hardening-resume-gating-majority-guards
plan: 06
subsystem: relitigation-guard
status: complete
tags: [resolved-decisions, ledger, re-litigation, resolver, decision-record, inject-enforce, wave-4]
requires:
  - "src/schema/resolved-decisions.ts ResolvedDecisionsLedger + ResolvedDecisionEntry + Resolver (05-02)"
  - "src/protocol/frontmatter.ts shared tolerant reader (05-02) — used elsewhere; ledger reads single-parse"
  - "src/protocol/decision-record.ts yamlScalar/serializeFrontmatter injection-safe writer (04-05) — reused"
  - "src/workspace/manifest.ts serializeWrite per-runDir chain (now exported) — ledger appends routed through it"
  - "src/protocol/converge.ts ConvergenceResult.resolver (05-03) — majority vs convergence provenance"
  - "src/protocol/gating.ts arbitrationLedgerEntry → resolver:human ResolvedDecisionEntry (05-05) — appended"
  - "src/protocol/engine.ts gate__<phase>/arbitrate boundaries (05-05) — append+enforce seams"
provides:
  - "src/protocol/resolved-decisions.ts — appendResolved/readLedger/detectRelitigation/enforceDrop + drops sidecar + settledIds"
  - "rolling runs/<id>/shared/resolved-decisions.md ledger (injection-safe write, gray-matter READ-only)"
  - "engine append triggers (response/convergence/majority/integrator/human) + re-litigation enforcement"
  - "decision-record assembles FROM the ledger (sources resolver) + notes re-litigation violations"
  - "agent-instructions.md.tmpl RESOLVED DECISIONS — do not re-litigate directive (D-62/D-65/D-37)"
  - "fixture re-litigation + ledger-read-echo modes (structured-shared.mjs)"
affects:
  - "phase 05 COMPLETE — RCRD-02 + RSLV-03 closed (settled forks fed forward as a guard, resolutions recorded)"
commits:
  - "bbbd7fc feat(05-06): rolling resolved-decisions ledger writer + re-litigation enforcement (D-63/D-64, Pitfall 7)"
  - "f7bace3 feat(05-06): append triggers + re-litigation drop wired into engine; terminal record sources the ledger (D-62/D-63)"
  - "7e15449 feat(05-06): seeded RESOLVED DECISIONS directive + inject/enforce/thin-prompt e2e + fixture modes (D-62/D-65/D-37)"
key-files:
  created:
    - "src/protocol/resolved-decisions.ts"
    - "test/resolved-decisions.test.ts"
    - "test/protocol-relitigation.e2e.test.ts"
  modified:
    - "src/workspace/manifest.ts"
    - "src/protocol/engine.ts"
    - "src/protocol/decision-record.ts"
    - "src/schema/decision-record.ts"
    - "src/templates/agent-instructions.md.tmpl"
    - "test/fixtures/structured-shared.mjs"
deviations:
  - "Ledger READ uses a SINGLE gray-matter parse (matter(raw).data), NOT the shared double-strip parseAgentFrontmatter. The ledger is the orchestrator's own peer artifact with NO engine-metadata wrapper, so its frontmatter is at position 0; the double-strip reader would consume the real frontmatter as a wrapper. gray-matter stays READ-only (T-04-07) either way."
  - "Re-litigation enforcement runs AFTER each phase's fan-out passes, checking that phase's just-written positions against the ledger as it stood BEFORE that phase appended its own settlements — then appends. Enforce-then-append in this order avoids a phase self-matching its own new ids (the response phase settles `response-…` ids; the integration position that names one in its additionRef is the re-litigator). The plan's 'before INTEGRATION/VALIDATION fan-out' intent is preserved (a position is dropped before it can influence downstream), but the check is on real on-disk artifacts, not a pre-fan-out guess."
  - "collectDecisionIds for an integration addition emits BOTH `integration-<additionRef>` AND the raw `additionRef` — so an addition naming a settled earlier-phase id (e.g. `response-claude-issue-1`) in its additionRef is caught by the raw match. This is the id-vocabulary bridge that makes cross-phase re-litigation detectable."
  - "Re-litigation drops are persisted to a plain JSON sidecar `shared/relitigation-drops.json` (orchestrator-minted, not agent prose), routed through serializeWrite + atomic rename; the decision record reads it to note violations. The DecisionRecordFrontmatter schema gained additive optional `resolver` on ResolvedDecision and a defaulted `relitigationViolations[]` — prior records parse unchanged."
self-check: PASSED
metrics:
  duration: "~25 minutes"
  completed: "2026-06-05"
  tasks: 3
  tests_added: 14
  tests_total: 313
---

# Phase 05 Plan 06: Re-litigation Guard Vertical Slice (RCRD-02 + ledger/recording RSLV-03)

The last slice of Phase 5 and the one genuinely-new artifact: a rolling
`runs/<id>/shared/resolved-decisions.md` ledger appended as forks settle (response concessions,
convergence concessions, majority tie-breaks, integrator calls, human rulings), readable by agents as
a peer artifact. The guard is INJECT + ENFORCE (D-62): the seeded instruction file directs agents to
read the ledger before proposing changes (the ledger body IS the digest, one line per settled fork —
D-65, prompts stay thin per D-37), AND the integration/validation path drops a position that reopens a
settled decision (drop + warn, no retry, run continues — D-64, generalizing 04-03's integrator drop).
The terminal decision record assembles FROM the ledger and sources the `resolver` field
(D-61/D-63/05-02 schema). The ledger WRITE reuses the injection-safe hand-rolled scalar serializer;
gray-matter stays READ-only.

## What Was Built

### Task 1 — rolling ledger writer + re-litigation enforcement (resolved-decisions.ts)
`src/protocol/resolved-decisions.ts` exports:
- `LEDGER_FILE = join("shared", "resolved-decisions.md")`.
- `appendResolved(runDir, runId, entries)` — read-modify-write the ledger DEDUPED by id
  (first-write-wins, so a settled fork stays settled and re-appends are idempotent), validate against
  the 05-02 `ResolvedDecisionsLedger`, and write atomically (temp-then-rename) via a hand-rolled
  `yamlScalar`/block-sequence serializer (reused from decision-record.ts — agent-authored
  rationale/summary are CR-01 injection risk; `matter.stringify` is NEVER used). The whole RMW is
  routed through the per-runDir `serializeWrite` chain (now exported from manifest.ts) so two
  same-phase appends both land (Pitfall 7). The body holds the one-line-per-fork digest (D-65).
- `readLedger(runDir)` — single gray-matter READ-only parse (no wrapper on this peer artifact),
  schema-validated; empty `{ runId, decisions: [] }` default when absent.
- `detectRelitigation(settledIds, artifactFrontmatter)` / `collectDecisionIds` — the shared id
  vocabulary (`response-<author>-issue-<ref>`, `integration-<additionRef>` PLUS the raw `additionRef`)
  used to flag which settled ids a later-phase position reopens. Tolerant of malformed frontmatter.
- `enforceDrop(...)` — when a position reopens a settled id, drop it with a logged `re-litigation`
  reason (no retry) and return the drop record; null otherwise.
- `recordRelitigationDrops` / `readRelitigationDrops` / `settledIds` — the JSON drops sidecar
  (`shared/relitigation-drops.json`, serializeWrite + atomic) the decision record reads, and the
  settled-id set for the enforcement pass.

`test/resolved-decisions.test.ts` (11 tests): ledger location; two same-phase appends both land
(Pitfall 7); idempotent re-append; an injection-laden rationale (newline + `---` + `injected: key`)
serializes so the on-disk ledger re-parses with no phantom key; empty-entries no-op; detection +
enforcement for response/integration ids, non-object tolerance, and the `re-litigation`-reason drop.

### Task 2 — append triggers + enforcement wired into the engine; record sources the ledger
`src/protocol/engine.ts`: at sequential phase boundaries (the engine drives phases sequentially —
Pitfall 7) the engine appends settled forks with PINNED resolvers:
- after RESPONSE: `reject-with-reason`/`refine` verdicts → `resolver:"convergence"`
  (`appendResponseLedger`), id/summary/rationale MIRRORING decision-record.ts's contested-collection so
  the trail cross-check and the ledger tag identical entries identically;
- in the arbitration boundary (which always runs after convergence): convergence concessions →
  `convergence`, a clear-majority tie-break → `convergence-majority` `resolver:"majority"`
  (`appendConvergenceLedger`); a gated human ruling → the `arbitrationLedgerEntry` (resolver `human`)
  appended;
- after INTEGRATION: `dropped`/`merged-with-change` calls → `resolver:"integrator"`
  (`appendIntegrationLedger`).

ENFORCEMENT (`enforceRelitigation`): after the INTEGRATION and VALIDATION fan-outs pass, the phase's
just-written positions are checked against the forks settled by EARLIER phases (the ledger BEFORE this
phase's own appends), and any reopening position is dropped (`re-litigation`, no retry, run continues);
the drops are recorded for the record. `src/protocol/decision-record.ts writeDecisionRecord` now
ADDITIVELY assembles FROM the ledger (Open Q1 recommendation): it keeps the trail re-derivation as a
cross-check, overlays each matching entry's `resolver` from the ledger, appends ledger-only entries
(the human ruling, the majority resolution) the trail can't see, and notes each `re-litigation` drop as
a `relitigationViolations[]` entry. `src/schema/decision-record.ts` gained additive optional `resolver`
on `ResolvedDecision` + a defaulted `relitigationViolations[]` (prior records parse unchanged).
Per-turn prompts carry NO decision content — the digest lives in the ledger body + the seeded file.

### Task 3 — seeded directive + inject/enforce/thin-prompt e2e + fixtures
`src/templates/agent-instructions.md.tmpl`: a new `## RESOLVED DECISIONS — do not re-litigate`
section (parallel to OUTPUT CHANNEL) directing agents to read `shared/resolved-decisions.md` before
proposing changes and to NOT reopen any decision listed there; the file IS the digest (the prompt only
points at it, D-37). `test/fixtures/structured-shared.mjs`: a re-litigation emit mode
(`MAR_RELITIGATE_RESPONSE` settles a fork via a reject-with-reason; `MAR_RELITIGATE_ID` makes the
integrator reopen it) and a ledger-read echo mode (`MAR_LEDGER_ECHO_DIR`/`_ID` reports SAW/MISSED for a
decision id in the ledger — scanning `runs/<id>/shared/` since non-scoped fixtures inherit the project
cwd). `test/protocol-relitigation.e2e.test.ts` (3 tests, execa-via-tsx): INJECT (the ledger exists +
validates + an echo fixture confirms availability); ENFORCE (a reopening integrator position is dropped
with `re-litigation`, the run completes, the drops sidecar + decision record note the violation, and the
settled fork's `resolver:"convergence"` reached the record); THINNESS (no decision content or
`resolved-decisions.md` in any per-turn prompt).

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | rolling ledger writer + re-litigation enforcement | bbbd7fc | src/protocol/resolved-decisions.ts, src/workspace/manifest.ts, test/resolved-decisions.test.ts |
| 2 | append triggers + drop wired into engine; record sources ledger | f7bace3 | src/protocol/engine.ts, src/protocol/decision-record.ts, src/schema/decision-record.ts |
| 3 | seeded directive + inject/enforce/thin-prompt e2e + fixtures | 7e15449 | src/templates/agent-instructions.md.tmpl, test/fixtures/structured-shared.mjs, test/protocol-relitigation.e2e.test.ts |

## Exported Signatures (for downstream / reference)

```ts
// src/protocol/resolved-decisions.ts
export const LEDGER_FILE: string; // join("shared","resolved-decisions.md")
export function appendResolved(runDir: string, runId: string, entries: ResolvedDecisionEntry[]): Promise<void>;
export function readLedger(runDir: string): Promise<ResolvedDecisionsLedger>;
export function detectRelitigation(settledIds: Set<string>, fm: unknown): { relitigatedIds: string[] };
export function enforceDrop(artifactPath: string, settledIds: Set<string>, fm: unknown): RelitigationDrop | null;
export function recordRelitigationDrops(runDir: string, drops: RelitigationDrop[]): Promise<void>;
export function readRelitigationDrops(runDir: string): Promise<RelitigationDrop[]>;
export function settledIds(runDir: string): Promise<Set<string>>;
export interface RelitigationDrop { artifactPath: string; relitigatedIds: string[]; reason: "re-litigation"; }

// src/workspace/manifest.ts (now exported)
export function serializeWrite<T>(runDir: string, op: () => Promise<T>): Promise<T>;

// src/schema/decision-record.ts (additive)
ResolvedDecision gains optional `resolver`; DecisionRecordFrontmatter gains defaulted `relitigationViolations[]`.
```

## Verification

- Per-task: named vitest files green after each commit; `npx tsc --noEmit` clean after each task.
- Full suite: `npm test` → **313 passed (40 files)** — 299 (05-05 baseline) + 14 new (11
  resolved-decisions unit + 3 relitigation e2e). No regressions; the `protocol error: … >=2 distinct
  vendors` / timeout lines in output are EXPECTED negative-path test stderr, not failures.
- `npx tsc --noEmit`: clean.
- `npx biome check .`: only the ONE PRE-EXISTING finding (`engine.ts` `phase.validate!`
  noNonNullAssertion, present at the base commit, owned by 04-05). No new findings introduced; all
  touched files are clean.
- `grep -c "resolved-decisions.md" src/templates/agent-instructions.md.tmpl` → 2.
- `grep matter.stringify src/protocol/resolved-decisions.ts` → only a comment (gray-matter READ-only).

## Deviations from Plan

- **Ledger read is a single gray-matter parse**, not the shared double-strip reader — the ledger is the
  orchestrator's own wrapper-less peer artifact (frontmatter at position 0). Still READ-only (T-04-07).
- **Enforce runs after each phase's fan-out passes (on real artifacts), then append** — checking the
  phase's positions against forks settled by EARLIER phases. This avoids a phase self-matching its own
  new ids while preserving the plan's intent (a reopening position is dropped + noted, the run
  continues). `collectDecisionIds` emits the raw `additionRef` so a cross-phase reopen is detectable.
- **Re-litigation drops persist to a JSON sidecar** (`shared/relitigation-drops.json`), and the
  decision-record schema gained additive `resolver` + `relitigationViolations[]` — both defaulted so
  prior records parse unchanged.

## Self-Check: PASSED

`src/protocol/resolved-decisions.ts`, `test/resolved-decisions.test.ts`,
`test/protocol-relitigation.e2e.test.ts` exist on disk; all 3 task commits (bbbd7fc, f7bace3, 7e15449)
verified in git log; full suite 313 green; tsc clean; only the pre-existing biome finding remains; the
template carries the `resolved-decisions.md` directive; no STATE.md/ROADMAP.md modifications.
