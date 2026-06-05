---
phase: 04-first-end-to-end-run
plan: 03
subsystem: protocol / structured-phase core
tags: [validation-gate, D-38, integrator, REVW-01, REVW-02, REVW-04, gray-matter, hermetic-fixtures]
requires:
  - "src/schema/review.ts | response.ts | evaluation.ts (04-01 frontmatter schemas)"
  - "src/protocol/instructions.ts seedInstructions + scopedWorkdir(vendor) (04-02)"
  - "src/protocol/engine.ts Phase-3 fan-out + applySkipFailed + manifest-sequential-append"
provides:
  - "Phase descriptor with thin per-phase prompt (D-37) + optional zod validate (D-38)"
  - "IntegrationFrontmatter schema (REVW-04 per-addition verdict union)"
  - "validation-with-one-retry gate in engine.ts (REVW-01/02, D-38)"
  - "integrator-only fan-out + gate expecting exactly 1 writer (REVW-04)"
  - "manifest status enum gains 'escalated' (O-2 additive)"
  - "fixtures emit schema-valid + malformed structured frontmatter (D-49 hermetic)"
affects:
  - "04-04 convergence loop sets the designated integrator (currently roster[0]) + reads proposedBase"
  - "04-05 decision-record writer consumes the validated artifacts"
tech-stack:
  added:
    - "gray-matter@4.0.3 wired READ-only at the engine validation site (installed from the 04-01-locked version)"
  patterns:
    - "thin [phase:<name>]-tagged prompt: phase name only, format contract stays in the seeded instruction file"
    - "validation retry distinct from transport retry (Pitfall 5): wraps the turn AFTER withRetry"
    - "validate the AGENT's emitted frontmatter (turn text), not the engine-metadata wrapper the .md carries"
    - "shared fixture body generator keeps all three fake CLIs byte-aligned"
key-files:
  created:
    - "src/schema/integration.ts"
    - "test/validation-retry.test.ts"
    - "test/fixtures/structured-shared.mjs"
  modified:
    - "src/protocol/phases.ts"
    - "src/protocol/gate.ts"
    - "src/protocol/engine.ts"
    - "src/schema/manifest.ts"
    - "test/protocol-gate.test.ts"
    - "test/protocol-engine.test.ts"
    - "test/protocol-run.e2e.test.ts"
    - "test/fixtures/fake-claude.mjs"
    - "test/fixtures/fake-codex.mjs"
    - "test/fixtures/fake-gemini.mjs"
    - "test/fixtures/planted-shared.mjs"
    - "src/workspace/scope.ts (biome import-order only)"
    - "test/instructions.test.ts (biome import-order only)"
decisions:
  - "Validate the agent's emitted markdown+frontmatter (turn.text), NOT the on-disk .md: writeArtifact wraps the agent body under an engine-metadata frontmatter block, so the .md's FIRST frontmatter is engine metadata; parsing the file would validate the wrong block. gray-matter stays read-only either way."
  - "Designated integrator = roster[0] with an explicit precondition guard; the convergence loop that SETS it from proposedBase lands in 04-04. Full incoming roster is carried forward past integration so validation still fans out over every survivor."
  - "Thin prompt carries a [phase:<name>] tag (phase NAME only, no format vocabulary) so the hermetic fixtures know which schema-valid artifact to emit through the engine path (D-49) without leaking the format contract into the prompt."
metrics:
  duration: "~12 minutes"
  completed: "2026-06-05"
  tasks: 3
  files: 14
  tests_added: 3
---

# Phase 04 Plan 03: Structured-Phase Core (validation gate + integrator + hermetic fixtures) Summary

Turned the Phase-3 skeleton (placeholder prompts, all-mode fan-out, no content validation) into the structured-phase core: thin per-phase prompts that reference the seeded instruction file, a validation-with-one-retry gate that validates each turn's frontmatter against the 04-01 schemas, an integrator-only participant branch wired into both the engine fan-out and the gate, and fixtures that emit schema-valid (and malformed) structured content for hermetic, zero-credit runs.

## What Was Built

### Task 1 — Phase descriptor + gate integrator branch + manifest kinds (commit eea5bad)
- `src/protocol/phases.ts`: `Phase` gains `prompt: (ctx: PhasePromptCtx) => string` (thin, D-37) and optional `validate?: (frontmatter) => {ok:true}|{ok:false;errors}` (D-38). Review/response/evaluation/integration carry validators built from the 04-01 schemas; draft/validation omit them. Integration flips to `participants:"integrator"`.
- `src/schema/integration.ts` (new): `IntegrationFrontmatter` — `phase/author/base/additions` where each addition is a discriminated union on `verdict` (`merged` | `merged-with-change`+change | `dropped`+reason), mirroring the response schema's required-field-per-variant contract (REVW-04).
- `src/protocol/gate.ts`: `expectedParticipantCount` returns `1` for the integrator branch (single writer), `roster.length` otherwise.
- `src/schema/manifest.ts`: status enum additively gains `"escalated"` (O-2 fallback-base outcome). `kind` remains `z.string()` so evaluation/decision-record/integration kinds parse unchanged.

### Task 2 — Real prompts + validation-with-one-retry + integrator-only fan-out (commit 4e134fe)
- `src/protocol/engine.ts`: placeholder prompt replaced with `phase.prompt({inputPath, phaseName})`. A `runTurn` helper wraps the transport-retried turn; the D-38 validation gate runs AFTER `withRetry` (Pitfall 5 — distinct from transport retry): it parses the agent's emitted frontmatter with gray-matter (READ-only), runs `phase.validate`, and on a miss re-invokes the SAME adapter ONCE with the formatted zod issues appended (`## Validation errors to fix`). A second failure yields a FAILED turn (reason `validation-failed`) so the existing `applySkipFailed` (D-30) drops it — never auto-normalized. Integration fans out over only the designated integrator; the full incoming roster is carried forward so validation still runs over every survivor. Manifest `addArtifact` remains sequential after `allSettled` (Pitfall 2 not regressed).

### Task 3 — Hermetic fixtures emit valid + malformed structured frontmatter (commit 351c2a6)
- `test/fixtures/structured-shared.mjs` (new): one source of truth for schema-valid review/response/evaluation/integration bodies, malformed variants (P9 severity, reject-with-reason missing reason, round 0, merged-with-change missing change), `MAR_EMIT_BASE` steering, and `[phase:<name>]` tag detection so the engine-driven path emits the right artifact.
- All three fake CLIs route `--emit`/`--emit-malformed`/the engine phase tag through the shared generators in their vendor-native envelope; default/planted/bad-json/hang modes unchanged.
- `test/validation-retry.test.ts` (new): malformed-then-valid one-retry recovery (run completes), malformed-twice → both turns dropped → run fails with `validation-failed` in `failureReason`, and a happy path proving a first-attempt-valid turn triggers no retry.

## Verification

- `npx vitest run test/validation-retry.test.ts test/protocol-gate.test.ts` — green.
- `npx vitest run` (full suite) — **258 passed / 30 files**, no Phase-1/2/3 regressions.
- `npx tsc --noEmit` — clean. `npx biome check` — clean.
- Task-3 verify: `node test/fixtures/fake-claude.mjs --emit review | gray-matter` → `phase=review`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Validate the agent's emitted frontmatter, not the on-disk .md's wrapper block**
- **Found during:** Task 2 (first engine run dropped every structured turn).
- **Issue:** The plan said to `matter(readFileSync(written.path))`, but `writeArtifact` prepends an engine-metadata frontmatter block (agent/seq/kind/timestamp/runId/phase) ahead of the agent's body. gray-matter reads only the FIRST `---` block, so reading the file validated engine metadata (always missing `issues`/`responses`) instead of the agent's structured frontmatter — failing every structured phase.
- **Fix:** Thread the agent `turn.text` through `runTurn` and validate `matter(turn.text).data`. gray-matter stays strictly read-only; the injection-safe `toFrontmatter` serializer still writes the wrapped artifact, and the raw turn JSON is still preserved on disk.
- **Files modified:** src/protocol/engine.ts
- **Commit:** 4e134fe

**2. [Rule 3 - Blocking] Thin prompts carry a `[phase:<name>]` tag so hermetic fixtures emit the right artifact**
- **Found during:** Task 2 (engine path passes a thin prompt, not `--emit`; fixtures had no way to know the phase).
- **Issue:** D-49 requires the engine→fixture path to produce schema-valid artifacts, but a bare instruction prompt gave the fixture no phase signal.
- **Fix:** `thinPrompt(phaseName, instruction)` prefixes `[phase:<name>]` — the phase NAME only, never the format vocabulary — and the fixtures key off it. The "thin prompt" gate test asserts no P1/severity/verdict tokens leak into the prompt.
- **Files modified:** src/protocol/phases.ts, the three fixtures
- **Commit:** 4e134fe / 351c2a6

**3. [Rule 1 - Bug] planted-error fixtures must emit schema-valid frontmatter under the new gate**
- **Found during:** Task 3 (full-suite run: planted-error.test.ts failed).
- **Issue:** The A/B independence-proof fixtures emitted bare `DISCREPANCY/AGREED` markers, which the new D-38 review/response/... gates reject → run failed.
- **Fix:** `planted-shared.mjs` now emits schema-valid frontmatter for every gated phase; the review verdict (DISCREPANCY/AGREED + observed values) rides the schema-required issue `question`, so the artifact validates AND the test's `.toContain` assertions still read the verdict. Independence signal and falsifiability probe unchanged.
- **Files modified:** test/fixtures/planted-shared.mjs
- **Commit:** 351c2a6

**4. [Rule 3 - Blocking] Installed gray-matter from the 04-01-locked version**
- **Found during:** Task 2 (`Cannot find module 'gray-matter'`).
- **Issue:** 04-01 added gray-matter@^4 to package.json/package-lock (human-approved, integrity-pinned 4.0.3) but never materialized it into node_modules; the worktree resolves packages from the main checkout's node_modules, which lacked it.
- **Fix:** Installed the EXACT locked version (`gray-matter@4.0.3`, 0 vulnerabilities) — not a substitute, not a renamed alternative — so this is outside the Rule-3 package-install exclusion (which guards against slopsquat/hallucinated NEW names). gray-matter ships its own types; tsc resolved cleanly.
- **Commit:** n/a (environment setup, not a source change)

**5. [Out of scope, included for green checks] biome import-order reformats in two Wave-1 files**
- `src/workspace/scope.ts` and `test/instructions.test.ts` received biome import-ordering fixes when running `biome check --write`. These are pre-existing files I did not modify logically; the reformat was required for `npx biome check` (a verification gate) to pass. No behavior change.
- **Commit:** 4e134fe

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Phase descriptor + gate integrator branch + manifest kinds | eea5bad | phases.ts, gate.ts, manifest.ts, integration.ts, protocol-gate.test.ts |
| 2 | Real prompts + validation-with-one-retry + integrator-only fan-out | 4e134fe | engine.ts, phases.ts, protocol-engine.test.ts, protocol-run.e2e.test.ts, protocol-gate.test.ts, scope.ts, instructions.test.ts |
| 3 | Fixtures emit valid + malformed structured frontmatter | 351c2a6 | structured-shared.mjs, validation-retry.test.ts, fake-claude/codex/gemini.mjs, planted-shared.mjs |

## Threat Model Compliance

- **T-04-06 (malformed frontmatter accepted):** mitigated — validation-with-one-retry on zod safeParse; a second failure fails the turn, never auto-normalized.
- **T-04-07 (YAML deserialization RCE):** gray-matter default js-yaml SAFE load; no custom unsafe schema passed at the single read site.
- **T-04-08 (manifest concurrent-write race):** preserved — artifact files concurrent, `addArtifact` sequential after `allSettled`.
- **T-04-09 (non-integrator merge):** integration fans out over only the designated integrator and the gate expects exactly 1 writer.

## Known Stubs

- **Designated integrator = `roster[0]`** (src/protocol/engine.ts `designateIntegrator`). This is an intentional, documented placeholder: the convergence loop that SETS the integrator from `EvaluationFrontmatter.proposedBase` agreement lands in **04-04**. The integration phase already fans out over exactly one writer and the gate enforces it, so REVW-04's single-writer invariant holds today; only the SELECTION criterion is deferred. Guarded by a precondition that throws on an empty roster.

## Threat Flags

None — no security surface beyond the planned threat register was introduced.

## Self-Check: PASSED

- FOUND: src/schema/integration.ts, src/protocol/phases.ts, src/protocol/gate.ts, src/protocol/engine.ts, test/validation-retry.test.ts, test/fixtures/structured-shared.mjs
- FOUND commits: eea5bad (Task 1), 4e134fe (Task 2), 351c2a6 (Task 3) — all in git log.
- Full suite 258/258, tsc clean, biome clean.
