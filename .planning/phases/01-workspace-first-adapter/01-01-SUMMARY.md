---
phase: 01-workspace-first-adapter
plan: 01
subsystem: workspace
tags: [scaffold, schema, workspace, atomic-io, tdd, esm]
requires: []
provides:
  - "TurnResult zod schema (vendor-agnostic normalized turn contract)"
  - "Manifest zod schema (authoritative run index, PROT-07)"
  - "workspace/layout: sortable run ids + deterministic <seq>-<agent>-<kind>.md naming"
  - "workspace/manifest: atomic createRun/read/write/addArtifact/setStatus"
  - "workspace/artifacts: atomic writeArtifact (.md + .raw.json) + isDone done-detection (PROT-02)"
  - "test/fixtures/fake-claude.mjs (happy/--fail-auth/--bad-json/--hang)"
  - "test/e2e-invoke.test.ts (RED MVP skeleton anchor for Plan 03)"
affects:
  - "Plan 02 (claude adapter) consumes TurnResult + fake-claude fixture"
  - "Plan 03 (CLI wiring) consumes workspace layer + turns e2e-invoke.test.ts green"
tech-stack:
  added:
    - "TypeScript 6.0.3 (nodenext ESM)"
    - "zod 4.4.3"
    - "fs-extra 11 / nanoid 5.1.11"
    - "vitest 4.1.8 / tsx 4 / @biomejs/biome 2"
    - "execa 9 / commander 15 / pino 10 (installed; consumed in Plans 02-03)"
  patterns:
    - "filesystem-as-truth: run state re-derivable from manifest.json on disk"
    - "atomic temp+rename writes for manifest and artifacts (D-16)"
    - "vendor-agnostic TurnResult — no claude field names past the schema boundary (D-12)"
    - "TDD RED/GREEN gates per behavior-adding task"
key-files:
  created:
    - package.json
    - tsconfig.json
    - biome.json
    - vitest.config.ts
    - .gitignore
    - src/schema/turn.ts
    - src/schema/manifest.ts
    - src/workspace/layout.ts
    - src/workspace/manifest.ts
    - src/workspace/artifacts.ts
    - test/fixtures/fake-claude.mjs
    - test/e2e-invoke.test.ts
    - test/workspace.test.ts
    - test/manifest.test.ts
  modified: []
decisions:
  - "Dropped --bare for Phase 1 (per D-09 amendment / RESEARCH): subscription auth only works without it; fixture mirrors the real shape regardless."
  - "Pinned zod@^4 (registry ships 4.4.3); simple object/enum/record/infer API stable 3->4."
  - "Manifest status enum keeps `timeout` distinct from `failed` (D-17 observability)."
  - "Run-id alphabet restricted to [A-Za-z0-9_-] via nanoid customAlphabet — no path-traversal chars (T-01-01)."
  - "Added tsconfig `types:[node]` so TS6/nodenext resolves node: builtins (blocking fix)."
metrics:
  duration_minutes: 12
  tasks_completed: 3
  files_created: 14
  completed_date: 2026-06-04
---

# Phase 1 Plan 01: Workspace-First Foundation Summary

Greenfield Walking Skeleton foundation: ESM/TS/Node-22 scaffold, vendor-agnostic `TurnResult` + `Manifest` zod schemas, a filesystem-as-truth workspace layer (deterministic naming, atomic manifest, atomic artifact writer with exists-AND-non-empty done-detection), the four-mode fake-claude fixture, and a deliberately-failing end-to-end test that anchors the whole Phase-1 slice.

## What Was Built

- **Task 1 (scaffold + RED e2e anchor):** `package.json` (`type:module`, `engines.node>=22`, `mar` bin, exact stack majors — no forbidden Phase-2+ libs), `tsconfig` (nodenext / ES2023 / strict), `biome.json`, `vitest.config.ts`, `.gitignore` (gitignores `runs/` per Pitfall 6). `test/fixtures/fake-claude.mjs` mirrors the verified `claude -p --output-format json` shape across happy / `--fail-auth` / `--bad-json` / `--hang`. `test/e2e-invoke.test.ts` drives the not-yet-built `mar invoke` against the fixture and is RED until Plan 03.
- **Task 2 (schemas + layout, TDD):** `src/schema/turn.ts` (`ClaudeJson` with `.passthrough()`, vendor-agnostic `TurnResult`), `src/schema/manifest.ts` (`Manifest` with `timeout`-distinct status enum), `src/workspace/layout.ts` (`newRunId` sortable+unique, `runDir`, `artifactName` zero-padded, `artifactPath`, `rawPath`).
- **Task 3 (atomic workspace, TDD):** `src/workspace/manifest.ts` (`createRun`/`readManifest`/`writeManifestAtomic` temp+rename with validate-before-write, `addArtifact`, `setStatus`) and `src/workspace/artifacts.ts` (`writeArtifact` → atomic `.md` frontmatter+body and sibling `.raw.json`; `isDone` = exists AND non-empty).

## Verification

- `npx vitest run` → **17 passed, 1 failed**. The single failure is `test/e2e-invoke.test.ts` — the intentional RED MVP skeleton anchor (`src/cli.ts` does not exist until Plan 03). All `workspace.test.ts` (10) and `manifest.test.ts` (7) cases pass.
- `npx tsc --noEmit` → clean (exit 0).
- `npx biome check src test` → clean.
- `grep -q '^runs/' .gitignore` → present. Forbidden libs (xstate, gray-matter, p-queue, zod-to-json-schema) absent.

## TDD Gate Compliance

Tasks 2 and 3 (`tdd="true"`) each followed RED → GREEN:
- Task 2: `test(01-01)` 12f5e38 (RED) → `feat(01-01)` 4e27397 (GREEN).
- Task 3: `test(01-01)` 3641406 (RED) → `feat(01-01)` 1a5a340 (GREEN).
Both RED commits were verified failing (import errors / no tests collected) before implementation. No REFACTOR commits were needed; a final `style` commit applied biome formatting only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TS6/nodenext did not resolve `node:` builtins**
- **Found during:** Task 2 (typecheck of `src/workspace/layout.ts`)
- **Issue:** `tsc --noEmit` raised `TS2591: Cannot find name 'node:path'` despite `@types/node@25.9.1` installed; the explicit `lib:["ES2023"]` suppressed automatic `@types` inclusion.
- **Fix:** Added `"types": ["node"]` to `tsconfig.json` compilerOptions.
- **Files modified:** tsconfig.json
- **Commit:** 4e27397

No Rule 1, 2, or 4 deviations. The `--bare` drop and `zod@^4` pin were already resolved in the plan/RESEARCH (CONTEXT D-09 amendment), not runtime deviations.

## Known Stubs

None. The only intentionally-failing item is `test/e2e-invoke.test.ts`, which is the planned RED MVP skeleton anchor (documented in the plan as turned green by Plan 03) — not a stub.

## Threat Surface Notes

No new surface beyond the plan's threat model. Mitigations applied as planned: run-id alphabet restricted to `[A-Za-z0-9_-]` (T-01-01), atomic temp+rename for manifest and artifacts (T-01-02/03), `runs/` gitignored (T-01-04).

## For Plan 02 / 03

- Import `TurnResult` from `src/schema/turn.ts`; the adapter maps `ClaudeJson` → `TurnResult` and must never leak claude field names.
- The adapter must let the binary be injected (the e2e test passes `MAR_CLAUDE_BIN="node <fake-claude.mjs>"`); do not hardcode `"claude"`.
- Plan 03 wires `src/cli.ts` `mar invoke` to `createRun` → adapter → `writeArtifact` → `addArtifact` + an `invocations.ndjson` writer; that turns `test/e2e-invoke.test.ts` green.

## Commits

- 169fbae chore(01-01): scaffold ESM/TS project + RED e2e anchor
- 12f5e38 test(01-01): add failing tests for schemas + layout naming
- 4e27397 feat(01-01): zod schemas + deterministic workspace layout
- 3641406 test(01-01): add failing tests for atomic manifest + artifact writer
- 1a5a340 feat(01-01): atomic manifest + artifact writer + done-detection
- 306fcf5 style(01-01): apply biome formatting to layout + tests
