---
phase: 05-hardening-resume-gating-majority-guards
plan: 01
status: complete
subsystem: build + protocol-contract
tags: [build, dist, packaging, template, claude-adapter, bare, ancestor-ignore, hardening]
tasks_completed: 2
requires:
  - "package.json tsc build script (Phase-4 baseline)"
  - "src/protocol/instructions.ts TEMPLATE_URL module-relative resolver"
  - "src/adapters/claude.ts pinned argv builder (--bare omitted)"
provides:
  - "dist/templates/*.tmpl copied at build time so the compiled mar binary seeds the contract (carry-over gap 1)"
  - "package.json files:[dist] so the template ships in the npm tarball"
  - "test/dist-template.test.ts build-then-exists guard (Pitfall 9 regression catcher)"
  - "claude --bare-absent flag pin in test/claude-adapter.test.ts (carry-over gap 2)"
  - "strengthened sole-format-contract / ignore-any-ancestor directive in agent-instructions.md.tmpl"
  - "corrected scope.ts / instructions.ts comments (--bare is OMITTED, not the mechanism)"
commits:
  - "8af46c6 fix(05-01): copy templates into dist at build time + files field + guard test"
  - "bf3e801 fix(05-01): pin claude --bare omission + strengthen ancestor-ignore directive + fix stale comments"
key-files:
  created:
    - "test/dist-template.test.ts"
  modified:
    - "package.json"
    - "src/templates/agent-instructions.md.tmpl"
    - "src/protocol/instructions.ts"
    - "src/workspace/scope.ts"
deviations:
  - "test/claude-adapter.test.ts and test/instructions.test.ts already carried the required assertions (the --bare-absent flag pin at lines 116/138, and the dynamic-from-disk template byte-identity check). No edit was needed, so neither file appears in the Task-2 commit. The acceptance criteria are still satisfied by the existing tests."
metrics:
  duration: "~6 minutes"
  completed: "2026-06-05"
  tasks: 2
  files: 5
  tests_added: 2
  tests_total: 269
self_check: PASSED
---

# Phase 05 Plan 01: Dist Template Packaging + `--bare` Pin Summary

Closed the two Phase-4 verifier carry-over gaps as a small, parallel-safe Wave-1 slice: (1) the dist
packaging bug where `npm run build` (bare `tsc`) emitted no non-TS assets, leaving
`dist/templates/agent-instructions.md.tmpl` missing so the compiled `mar` binary ENOENTed at draft
fan-out; and (2) the claude `--bare` decision, where the flag stays OMITTED (it breaks
subscription/OAuth auth and live leakage was measured zero) but is now pinned by a flag-absent
assertion, the seeded template's ancestor-ignore directive is strengthened, and the stale
scope.ts / instructions.ts comments that wrongly named `--bare` as the neutralization mechanism are
corrected.

## What Was Built

- **Build copy step + `files` field (Task 1)** — `package.json` `build` changed from bare `tsc` to
  `tsc && node -e "require('fs').cpSync('src/templates','dist/templates',{recursive:true})"` (the
  portable `cpSync` form from RESEARCH Q6a — not a bare `cp -R`, and not the rejected
  embed-as-TS-string / bundler alternatives). Added top-level `"files": ["dist"]` so the compiled
  template ships in the npm tarball. After `npm run build`, `dist/templates/agent-instructions.md.tmpl`
  exists; the compiled `seedInstructions` (`dist/protocol/instructions.js`) resolves it via its
  module-relative `TEMPLATE_URL`.
- **dist-template guard test (Task 1)** — `test/dist-template.test.ts` runs the real `npm run build`
  in `beforeAll` (120s timeout), then asserts the dist template exists AND is byte-identical to
  `src/templates/agent-instructions.md.tmpl`. This makes the Pitfall-9 regression (invisible under
  `npm run dev` / tsx, which runs from source) fail loudly in CI.
- **`--bare` flag pin (Task 2)** — `src/adapters/claude.ts` is unchanged (`--bare` stays omitted);
  `test/claude-adapter.test.ts` already asserts the claude argv equals
  `["-p", prompt, "--output-format", "json"]` and `not.toContain("--bare")` (the flag-pin that fails
  loudly on a future drift re-adding it).
- **Strengthened ancestor-ignore directive (Task 2)** — `src/templates/agent-instructions.md.tmpl`
  replaces the old three-line ancestor note with a `## SOLE FORMAT CONTRACT` section instructing the
  agent to read the in-folder vendor file (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`) as its sole
  format contract and to **ignore any ancestor** or global/user instructions — phrased so the literal
  token `ignore any ancestor` appears (grep count 2), parallel in style to the OUTPUT CHANNEL section.
- **Corrected stale comments (Task 2)** — `src/workspace/scope.ts` and `src/protocol/instructions.ts`
  no longer claim the live claude adapter passes `--bare`. Both now state `--bare` is deliberately
  OMITTED (auth-break; zero live leakage measured on run 20260605-MlhRzU), that neutralization is
  achieved by the seeded vendor file being the nearest contract PLUS the strengthened explicit
  ignore-ancestors directive, and that codex `--ignore-user-config` / gemini folder-trust scoping
  remain the per-vendor config mechanisms where relevant.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | dist .tmpl copy step + files field + guard test | 8af46c6 | package.json, test/dist-template.test.ts |
| 2 | Pin claude --bare omission + strengthen ancestor-ignore + fix stale comments | bf3e801 | src/templates/agent-instructions.md.tmpl, src/protocol/instructions.ts, src/workspace/scope.ts |

## Verification

- `npm run build` succeeds; `node -e "existsSync('dist/templates/agent-instructions.md.tmpl')"` exits 0.
- `npx vitest run test/dist-template.test.ts`: 2 passed.
- `npx vitest run test/claude-adapter.test.ts test/instructions.test.ts`: 18 passed.
- `grep -c "ignore any ancestor" src/templates/agent-instructions.md.tmpl`: 2.
- `grep -- "--bare" src/workspace/scope.ts src/protocol/instructions.ts`: only OMITTED-decision comments remain (no claim the live adapter passes it).
- `npx tsc --noEmit`: clean. `npx biome check` on touched files: clean.
- `npm test` (full suite): **269 passed** (267 baseline + 2 new dist-template tests), 34 test files.

## Deviations from Plan

- `test/claude-adapter.test.ts` and `test/instructions.test.ts` were listed in Task 2's `<files>`, but
  both already carried the exact assertions the acceptance criteria require: the claude argv flag pin
  with `expect(argv).not.toContain("--bare")` (claude-adapter.test.ts:138), and the template
  byte-identity check that reads the template dynamically from disk (instructions.test.ts:26-35, so the
  strengthened directive is automatically covered). No edit was needed, so neither file appears in the
  Task-2 commit. Acceptance criteria remain satisfied by the pre-existing tests.

## Known Stubs

None. Both carry-over gaps are fully closed and exercised by tests.

## Threat Flags

- T-05-02 (packaged binary ENOENTs on missing template) — mitigated: build copies the template into
  dist + `files:["dist"]`; the dist-template guard test fails loudly on regression.
- T-05-03 (future drift re-adds `--bare`, breaking subscription auth) — mitigated: the claude argv
  flag-pin asserts `--bare` absent.
- T-05-01 (ancestor/global instruction override) — mitigated: strengthened "ignore any ancestor"
  sole-contract directive; seeded file is the nearest contract; live run measured zero leakage.

## Self-Check: PASSED

`test/dist-template.test.ts` exists on disk; both commits (8af46c6, bf3e801) verified in git log; full
suite green at 269 tests; tsc + biome clean. STATE.md / ROADMAP.md untouched.
