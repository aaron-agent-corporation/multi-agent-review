---
phase: 03-protocol-engine-independence-enforcement
plan: 01
subsystem: workspace + adapters + test-harness
tags: [PROT-04, PROT-01, independence, cwd-seam, e2e-anchor, tdd]
requires:
  - "src/adapters/adapter.ts TurnRequest contract"
  - "src/workspace/layout.ts artifactName"
  - "test/e2e-invoke.test.ts harness pattern"
provides:
  - "src/workspace/scope.ts: scopedWorkdir + promoteDrafts + draftFileName (PROT-04 independence primitives)"
  - "TurnRequest.cwd optional field threaded through all 3 adapters (PROT-04 draft-phase seam)"
  - "test/fixtures/*.mjs --emit <kind> mode for distinct per-phase output"
  - "test/protocol-run.e2e.test.ts: RED mar run anchor defining the Phase-3 target (PROT-01)"
affects:
  - "Plan 03-02 (XState engine + mar run command) turns the RED anchor green"
tech-stack:
  added: []
  patterns:
    - "conditional execa-option spread (...(req.cwd ? { cwd } : {})) for additive, backward-compatible adapter contract"
    - "fs-extra default-import destructure (const { ensureDir, copy } = fsExtra)"
    - "charset-gated path segment (/^[A-Za-z0-9_-]+$/) mirroring RUN_ID_RE for runDir containment"
    - "argv --emit <kind> fixture marker mode, additive over existing modes"
key-files:
  created:
    - src/workspace/scope.ts
    - test/adapter-cwd.test.ts
    - test/scope-independence.test.ts
    - test/protocol-run.e2e.test.ts
  modified:
    - src/adapters/adapter.ts
    - src/adapters/claude.ts
    - src/adapters/codex.ts
    - src/adapters/gemini.ts
    - test/fixtures/fake-claude.mjs
    - test/fixtures/fake-codex.mjs
    - test/fixtures/fake-gemini.mjs
decisions:
  - "Single TDD commit for the cwd seam (RED test + GREEN impl together) — the change is one tiny additive field, splitting RED/GREEN commits added no diagnostic value"
  - "Independence enforced as a filesystem fact: scopedWorkdir seeds work/<agent>/ with ONLY input.md; promoteDrafts is the single writer of drafts into shared/"
  - "RED anchor asserts exitCode 0 first, so it fails on the missing mar run command (exit 1 from commander) — a precise command-missing failure, not a false-positive"
metrics:
  duration: ~6 min
  completed: 2026-06-04
  tasks: 3
  files: 11
---

# Phase 3 Plan 01: Independence Seam + RED Engine Anchor Summary

Built the PROT-04 structural-independence seam (per-agent scoped `cwd` + filesystem-isolated draft dirs + boundary promotion) and a single RED `mar run` e2e anchor that Plan 03-02's XState engine will turn green — with zero regression to the existing 182-test suite.

## What Was Built

**Task 1 — `cwd` seam (PROT-04).** Added an optional `cwd?: string` to `TurnRequest` and threaded it through claude/codex/gemini via `...(req.cwd ? { cwd: req.cwd } : {})` as the last entry of each adapter's execa options object. When unset the spawned options are byte-for-byte identical to today's behavior. `test/adapter-cwd.test.ts` mirrors the `adapter-stdin` drift-guard: cwd-present and cwd-absent assertions for all three adapters, plus a codex co-assertion that `--skip-git-repo-check`/`--ephemeral`/`-s`/`read-only` and `stdin:"ignore"` survive a scoped cwd (Pitfall 4).

**Task 2 — `src/workspace/scope.ts` (PROT-04).** Three exports:
- `scopedWorkdir(runDir, agent, inputPath)` → creates `work/<agent>/` seeded with ONLY `input.md`; returns the dir for use as the adapter `cwd`.
- `promoteDrafts(runDir, agents)` → the single writer of drafts into `shared/`, intended for the 1→2 phase boundary only.
- `draftFileName(agent)` → `artifactName(1, agent, "draft")`, one deterministic naming source.

Agent names are charset-gated (`/^[A-Za-z0-9_-]+$/`) and throw on `/` or `..` so they cannot escape `runDir` (T-03-01). `test/scope-independence.test.ts` asserts the core confidentiality invariant — `readdirSync(work/alice)` excludes bob's draft filename — plus the promotion-boundary assertion (shared/ has no draft before `promoteDrafts`, both after) and the agent-name escape throw.

**Task 3 — fixtures + RED anchor (PROT-01).** Each fixture gained an additive `--emit <kind>` mode returning its verified happy envelope with the body set to `<vendor>:<kind>` (claude `result`, codex `agent_message` text, gemini `response`), so a multi-phase run yields distinct, identifiable per-phase artifacts. All existing modes (`--fail-auth`, `--bad-json`, `--hang`, codex `--rate-limit-once`, gemini `--untrusted`/`--rate-limit`) are unchanged. `test/protocol-run.e2e.test.ts` is the RED anchor: a 2-vendor roster (claude+codex) driven via `npx tsx src/cli.ts run <input>`, asserting exit 0, manifest `status: "completed"`, and one artifact per agent for each of the 6 phase kinds.

## Verification

- `npx vitest run test/adapter-cwd.test.ts test/scope-independence.test.ts` → green (10 + 6 tests).
- `npx vitest run test/protocol-run.e2e.test.ts` → RED (expected). Fails at `expect(result.exitCode).toBe(0)` because `mar run` does not exist yet (commander exits 1 on the unknown command) — a command-missing failure, not a syntax/import error.
- `npx vitest run test/e2e-invoke.test.ts` → still green (fixture changes additive; happy path unchanged when `--emit` absent).
- Full suite: **182 passed, 1 failed** — the single failure is exactly the intentional RED anchor. No regressions.
- `npx tsc --noEmit` clean; `npx biome check` clean on all created/modified files.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

- **T-03-01 (agent-name path traversal):** mitigated — `scope.ts` validates agent against `/^[A-Za-z0-9_-]+$/` and throws on `/` or `..`; test asserts the throw.
- **T-03-02 (draft-phase information disclosure):** mitigated — `scopedWorkdir` places only `input.md`; cross-agent listing-exclusion test asserts the confidentiality invariant.
- **T-03-03 (execa cwd change to codex):** mitigated — cwd is additive/optional; codex pinned flags + `stdin:"ignore"` co-asserted under a scoped cwd.
- **T-03-SC (npm installs):** honored — no new packages added; `npm install` produced no lockfile drift.

## Known Stubs

None. The RED e2e anchor is an intentional, documented failing test (the Phase-3 target), not a stub — Plan 03-02 (XState engine + `mar run` command) resolves it.

## Self-Check: PASSED

- Created files present: src/workspace/scope.ts, test/adapter-cwd.test.ts, test/scope-independence.test.ts, test/protocol-run.e2e.test.ts — all FOUND.
- Commits present: a094775 (feat cwd seam), 34b91b6 (feat scope.ts), 4e200e1 (test fixtures + RED anchor) — all FOUND in git log.
