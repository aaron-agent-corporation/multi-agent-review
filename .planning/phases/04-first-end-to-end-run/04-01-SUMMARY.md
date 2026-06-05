---
phase: 04-first-end-to-end-run
plan: 01
subsystem: schema
tags: [zod, frontmatter, validation, gray-matter, review-protocol]
requires:
  - "src/schema/config.ts discriminatedUnion + superRefine idiom"
  - "src/schema/manifest.ts additive .default([]) idiom"
provides:
  - "ReviewFrontmatter zod schema (REVW-01)"
  - "ResponseFrontmatter discriminated union on verdict (REVW-02)"
  - "EvaluationFrontmatter convergence-signal schema (REVW-03)"
  - "DecisionRecordFrontmatter schema (RCRD-01, RSLV-01)"
  - "gray-matter@^4 dependency (parse-only frontmatter reader for 04-03)"
affects:
  - "04-03 validation gate consumes these schemas"
  - "04-04 convergence loop reads EvaluationFrontmatter"
  - "04-05 decision-record writer targets DecisionRecordFrontmatter"
tech-stack:
  added:
    - "gray-matter@^4 (4.0.3) — parse-only frontmatter reader, no postinstall"
  patterns:
    - "z.discriminatedUnion on a literal discriminator to structurally enforce per-variant required fields"
    - "z.superRefine for cross-element uniqueness (duplicate issue numbers / agent names)"
    - "z.array(...).default([]) additive forward-compat for record collections"
key-files:
  created:
    - "src/schema/review.ts"
    - "src/schema/response.ts"
    - "src/schema/evaluation.ts"
    - "src/schema/decision-record.ts"
    - "test/review-schema.test.ts"
    - "test/response-schema.test.ts"
    - "test/evaluation-schema.test.ts"
    - "test/decision-record-schema.test.ts"
  modified:
    - "package.json"
    - "package-lock.json"
decisions:
  - "gray-matter kept parse-only — no schema module imports it; artifacts.ts toFrontmatter/yamlScalar stays the sole writer (injection-safe serializer preserved)"
  - "Response verdict modeled as a discriminated union so reject-with-reason requires reason and refine requires refinement at the type level, not via superRefine"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-05"
  tasks: 3
  files: 10
  tests_added: 30
---

# Phase 04 Plan 01: Frontmatter Schemas + gray-matter Summary

Defined the four zod frontmatter schemas (review, response, evaluation, decision-record) that the Phase-4 validation gate, convergence loop, and decision-record writer all validate against, and installed the one new dependency (gray-matter@^4) behind a human-approved package-legitimacy checkpoint.

## What Was Built

- **gray-matter@^4 (4.0.3)** installed as a parse-only frontmatter reader for downstream artifact validation (04-03). No postinstall script; npm reports 0 vulnerabilities. Not imported anywhere in this plan — schemas validate already-parsed `data` objects only; the existing injection-safe `toFrontmatter`/`yamlScalar` serializer in `artifacts.ts` remains the sole writer (confirmed unchanged via `git diff`).
- **ReviewFrontmatter (REVW-01)** — `phase` literal, `author`, `targets` (Pattern 4 routing key), and `issues` (min 1) of `ReviewIssue` (`n` positive int, `severity` P1|P2|P3 enum, `question` non-empty). A `.superRefine` rejects duplicate issue numbers, mirroring config.ts's duplicate-agent-name check (code `custom`, path `["issues"]`).
- **ResponseFrontmatter (REVW-02)** — `reviewOf` plus `responses` (min 1) of a `verdict` discriminated union: `accept` (issueRef), `reject-with-reason` (issueRef + required reason), `refine` (issueRef + required refinement). The union structurally enforces the per-verdict required field.
- **EvaluationFrontmatter (REVW-03)** — `round` (positive int, Pitfall 3 disambiguation), `proposedBase` (agreement signal A3), `remainingDisagreements` array, `citations` defaulting to `[]`.
- **DecisionRecordFrontmatter (RCRD-01, RSLV-01)** — `runId` plus additive-defaulted `resolvedDecisions` (id/summary/required-rationale/lineage[]), `openDecisions` (id/summary/reason), `unanimousTally` (>=0), and `runChain`. Omitting any collection parses to its empty/zero default.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Package-legitimacy checkpoint + install gray-matter | 5ec93e8 | package.json, package-lock.json |
| 2 (RED) | Failing review + response tests | 4e0763f | test/review-schema.test.ts, test/response-schema.test.ts |
| 2 (GREEN) | Review + response schemas | 800585f | src/schema/review.ts, src/schema/response.ts |
| 3 (RED) | Failing evaluation + decision-record tests | ae03c8a | test/evaluation-schema.test.ts, test/decision-record-schema.test.ts |
| 3 (GREEN) | Evaluation + decision-record schemas | 8574609 | src/schema/evaluation.ts, src/schema/decision-record.ts |

## Verification

- `npx vitest run` on all four schema test files: **30 passed**.
- `npx tsc --noEmit`: **clean**.
- `node -e "require('gray-matter')"`: exits 0 (version 4.0.3).
- `artifacts.ts` writer: unchanged (verified `git diff --quiet`).

## Deviations from Plan

None — plan executed as written.

## Checkpoint Resolution

Task 1 was a `checkpoint:human-verify` (gate=blocking-human) for gray-matter package legitimacy. The user explicitly approved ("approved") in a prior session; this executor completed the install on resume. Not auto-approved — blocking-human gate honored.

## TDD Gate Compliance

Both behavior-adding tasks followed RED → GREEN: a `test(...)` commit precedes each `feat(...)` commit (Task 2: 4e0763f → 800585f; Task 3: ae03c8a → 8574609). No unexpected RED passes. No refactor commits needed.

## Known Stubs

None. All schemas are fully implemented and exercised by tests.

## Threat Flags

None. No new security surface introduced — schemas validate already-parsed objects; gray-matter is parse-only and not yet wired (T-04-02 disposition `accept` deferred to 04-03 where reads are wired with js-yaml SAFE load).

## Self-Check: PASSED

All 8 created files exist on disk; all 5 commits (5ec93e8, 4e0763f, 800585f, ae03c8a, 8574609) verified in git log.
