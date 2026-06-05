---
phase: 05-hardening-resume-gating-majority-guards
plan: 02
subsystem: protocol-foundation
status: complete
tags: [frontmatter, gray-matter, zod, manifest, resumability, fixture, wave-1]
requires:
  - "engine.ts:198-206 tolerant parseFront (04-05 live-checkpoint hardening) — variant lifted"
  - "schema/manifest.ts additive z.enum idiom (escalated precedent)"
  - "schema/decision-record.ts ResolvedDecision shape (id/summary/rationale/lineage)"
provides:
  - "src/protocol/frontmatter.ts — ONE shared tolerant agent-frontmatter reader (Pitfall 4 fix)"
  - "RESUMABLE_STATUSES + TERMINAL_DONE single resumability source (Q7)"
  - "paused-awaiting-approval non-terminal manifest status (D-50)"
  - "src/schema/resolved-decisions.ts ledger schema + Resolver enum (D-61)"
  - "per-author fixture base steering via MAR_EMIT_BASES (RSLV-02)"
affects:
  - "05-03 majority tie-break appends ResolvedDecisionEntry, reads per-author bases"
  - "05-04 resume re-validation uses parseAgentFrontmatter + RESUMABLE_STATUSES"
  - "05-05 pause-and-exit writes paused-awaiting-approval"
  - "05-06 re-litigation guard reads ResolvedDecisionsLedger + resolver"
commits:
  - "90a2cfd feat(05-02): extract shared tolerant frontmatter reader; re-point strict callers (Pitfall 4)"
  - "08c14b7 feat(05-02): add paused-awaiting-approval status + RESUMABLE/TERMINAL sets (Q7)"
  - "c5bfdca feat(05-02): add resolved-decisions ledger schema + resolver enum (D-61) + per-author fixture base steering"
key-files:
  created:
    - "src/protocol/frontmatter.ts"
    - "src/schema/resolved-decisions.ts"
    - "test/frontmatter.test.ts"
  modified:
    - "src/protocol/converge.ts"
    - "src/protocol/decision-record.ts"
    - "src/schema/manifest.ts"
    - "test/manifest.test.ts"
    - "test/fixtures/structured-shared.mjs"
deviations:
  - "decision-record.ts: removed the now-unused gray-matter import and the readFile destructure from fsExtra (the local readAgentFrontmatter that used them was deleted in favor of the shared reader). Cosmetic cleanup forced by the re-point; no behavior change."
self-check: PASSED
metrics:
  duration: "~5 minutes"
  completed: "2026-06-05"
  tasks: 3
  tests_added: 8
  tests_total: 275
---

# Phase 05 Plan 02: Wave-1 Shared Foundation Summary

The disjoint Wave-1 primitives that later Phase-5 slices build on: one shared tolerant frontmatter
reader (fixing the strict-vs-tolerant divergence, Pitfall 4), the `paused-awaiting-approval` status
with a single typed resumability source (Q7), the resolved-decisions ledger schema with a `resolver`
enum (D-61), and per-author fixture base steering for the majority tests (RSLV-02). No behavior change
to the running protocol beyond the reader unification (a pure bugfix toward the tolerant variant).

## What Was Built

### Task 1 — shared tolerant frontmatter reader (Pitfall 4)
`src/protocol/frontmatter.ts` exports:
- `readAgentFrontmatter(path: string): Promise<unknown | null>` — reads the file (null on
  missing/unreadable, preserving non-signal semantics), then delegates to `parseAgentFrontmatter`.
- `parseAgentFrontmatter(raw: string): unknown` — pure, no I/O (so 05-04 resume re-validation can
  validate already-read text without a second read). Strips the engine-metadata wrapper with
  `matter(raw)`, `.trimStart()`s the inner body, then applies the TOLERANT fallback lifted verbatim
  from `engine.ts:198-206`: direct `matter(inner).data` if it has keys, else the first `^---\s*$`
  delimiter line and parse from there.

`converge.ts readEvaluationSignal` and `decision-record.ts readAgentFrontmatter` now call the shared
reader (both `import { readAgentFrontmatter } from "./frontmatter.js"`). Both KEEP their own strict zod
`safeParse` (EvaluationFrontmatter / ResponseFrontmatter / IntegrationFrontmatter) — leniency is about
WHERE frontmatter is found, never its shape (D-38, fail-closed). gray-matter stays READ-only (no
`stringify`); js-yaml default SAFE load preserved (T-04-07 / T-05-05). `engine.ts parseFront` left
untouched — 05-04 owns the engine resume path and will consolidate it (keeps this plan disjoint).

`test/frontmatter.test.ts` (4 tests): clean wrapper+agent-frontmatter reads its fields; a
PREAMBLE-PROSE-then-`---` artifact still reads the agent fields (the Pitfall-4 regression guard the
old strict double-parse would have dropped); a contrast test on `parseAgentFrontmatter`; missing file
returns null.

### Task 2 — paused-awaiting-approval + RESUMABLE/TERMINAL sets (Q7)
`src/schema/manifest.ts`: added `"paused-awaiting-approval"` to the `status` z.enum (additive
doc-comment mirroring the `escalated` precedent — NON-terminal, prior manifests parse unchanged).
Exported two `as const satisfies readonly ManifestStatus[]` arrays in the same module:
- `RESUMABLE_STATUSES = [running, failed, timeout, paused-awaiting-approval]` (D-57: failed/timeout
  ARE resumable).
- `TERMINAL_DONE = [completed, escalated]`.
The `satisfies` clause makes a drifted/renamed enum member surface a compile error at the literal. No
status-reading branch added elsewhere (05-04 `mar resume` is the first reader). `test/manifest.test.ts`
(+4 tests): `setStatus(rd, "paused-awaiting-approval")` round-trips through readManifest; RESUMABLE is
exactly the four and excludes completed/escalated; TERMINAL_DONE is exactly completed+escalated.

### Task 3 — resolved-decisions ledger schema + resolver enum + per-author fixture steering
`src/schema/resolved-decisions.ts` exports `Resolver`
(`z.enum(["convergence","majority","integrator","human"])`, D-61), `ResolvedDecisionEntry`
(id/summary/rationale `.min(1)`, `lineage: z.array().default([])`, `resolver: Resolver` — mirrors
schema/decision-record.ts ResolvedDecision plus provenance), and `ResolvedDecisionsLedger`
(`runId: z.string().min(1)`, `decisions: z.array(ResolvedDecisionEntry).default([])`). An empty
`{ runId, decisions: [] }` parses (additive ledger). `.infer` types exported for all three.

`test/fixtures/structured-shared.mjs proposedBase(author)` extended for per-author steering
(Open Q3): honors a JSON `MAR_EMIT_BASES` map (`{"claude":"codex",...}`) returning that author's
mapped base when present, defensively parsed (malformed JSON / non-object falls through, never
throws), then falling back to the existing single `MAR_EMIT_BASE`, then the author's own name — so
existing tests using `MAR_EMIT_BASE` are unaffected.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Shared tolerant reader; re-point strict callers | 90a2cfd | src/protocol/frontmatter.ts, converge.ts, decision-record.ts, test/frontmatter.test.ts |
| 2 | paused-awaiting-approval + RESUMABLE/TERMINAL | 08c14b7 | src/schema/manifest.ts, test/manifest.test.ts |
| 3 | resolved-decisions schema + per-author fixture | c5bfdca | src/schema/resolved-decisions.ts, test/fixtures/structured-shared.mjs |

## Exported Signatures (for downstream plans)

```ts
// src/protocol/frontmatter.ts
export function parseAgentFrontmatter(raw: string): unknown;
export function readAgentFrontmatter(path: string): Promise<unknown | null>;

// src/schema/manifest.ts (additions)
status enum now includes "paused-awaiting-approval"
export const RESUMABLE_STATUSES: readonly ["running","failed","timeout","paused-awaiting-approval"];
export const TERMINAL_DONE: readonly ["completed","escalated"];

// src/schema/resolved-decisions.ts
export const Resolver: z.ZodEnum<["convergence","majority","integrator","human"]>;
export type Resolver = "convergence" | "majority" | "integrator" | "human";
export const ResolvedDecisionEntry: z.ZodObject<{ id; summary; rationale; lineage; resolver }>;
export type ResolvedDecisionEntry = { id; summary; rationale; lineage: string[]; resolver: Resolver };
export const ResolvedDecisionsLedger: z.ZodObject<{ runId; decisions }>;
export type ResolvedDecisionsLedger = { runId: string; decisions: ResolvedDecisionEntry[] };
```

## Verification

- Per-task: `npx vitest run` on touched test files green after each commit; `npx tsc --noEmit` clean.
- Full suite: `npm test` → **275 passed (34 files)** — 267 baseline + 8 new (4 frontmatter + 4
  resumability). No regressions.
- `npx tsc --noEmit`: clean.
- Task-3 verify: `MAR_EMIT_BASES='{"claude":"codex"}'` → `proposedBase("claude") === "codex"`;
  unsteered → `"claude"`; `MAR_EMIT_BASE=x` → `"x"` (backward compatible); malformed env → falls back.
- Empty `ResolvedDecisionsLedger.parse({ runId, decisions: [] })` succeeds; `ResolvedDecisionEntry`
  defaults lineage to `[]`.
- `npx biome check .`: only one PRE-EXISTING warning (`engine.ts:212 noNonNullAssertion`, the
  `phase.validate!` non-null assertion) — not in any file this plan touched.

## Deviations from Plan

- **decision-record.ts unused-import cleanup.** Deleting the local `readAgentFrontmatter` (replaced by
  the shared reader) left `gray-matter`'s `matter` import and `readFile` (destructured from fs-extra)
  unused. Removed both to keep tsc/biome clean. The hand-rolled injection-safe serializer
  (`yamlScalar`/`serializeFrontmatter`) is unchanged — gray-matter remains absent from the WRITE path,
  preserving T-04-07. No behavior change.

## Self-Check: PASSED

All 3 created files exist on disk (`src/protocol/frontmatter.ts`, `src/schema/resolved-decisions.ts`,
`test/frontmatter.test.ts`); all 3 task commits (90a2cfd, 08c14b7, c5bfdca) verified in git log; full
suite 275 green; tsc clean; no STATE.md/ROADMAP.md modifications.
