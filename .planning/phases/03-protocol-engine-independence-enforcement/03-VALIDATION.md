---
phase: 3
slug: protocol-engine-independence-enforcement
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-04
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Transcribed from 03-RESEARCH.md "Validation Architecture" Test Map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4 |
| **Config file** | vitest.config.ts (present — defaults, none needed) |
| **Quick run command** | `npx vitest run <file>` |
| **Full suite command** | `npx vitest run` (baseline 169/169 green across 18 files) |
| **Estimated runtime** | ~3 seconds (fixtures only; no live CLI) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <the just-written test file>`
- **After every plan wave:** Run `npx vitest run` (full suite) + `npx tsc --noEmit` + `npx biome check`
- **Before `/gsd:verify-work`:** Full suite green AND one live human-verified `mar run` on a small real input (Plan 03 Task 2 — CI uses fixtures only)
- **Max feedback latency:** 3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | PROT-04 | T-03-03 | cwd is additive/optional; pinned codex flags (--skip-git-repo-check/--ephemeral/-s read-only) and stdin:"ignore" retained when cwd set | unit (drift guard) | `npx vitest run test/adapter-cwd.test.ts` | ❌ W0 → test/adapter-cwd.test.ts | ⬜ pending |
| 3-01-02 | 01 | 1 | PROT-04 | T-03-01 / T-03-02 | agent name charset-gated (no "/" or ".."); scoped workdir holds only input.md, peer draft physically absent | unit (fs assertion) | `npx vitest run test/scope-independence.test.ts` | ❌ W0 → test/scope-independence.test.ts | ⬜ pending |
| 3-01-02 | 01 | 1 | PROT-04 | T-03-02 | promotion copies drafts to shared/ ONLY at the 1→2 boundary | unit | `npx vitest run test/scope-independence.test.ts -t "promote"` | ❌ W0 → test/scope-independence.test.ts | ⬜ pending |
| 3-01-03 | 01 | 1 | PROT-01 | — | RED e2e anchor: `mar run` advances all 6 phases producing each phase's artifacts (fails for the right reason until Plan 02) | integration (fake fixtures) | `npx vitest run test/protocol-run.e2e.test.ts` | ❌ W0 → test/protocol-run.e2e.test.ts | ⬜ pending (RED-intended) |
| 3-02-01 | 02 | 2 | PROT-03 | T-03-07 | gate blocks advance until EVERY required phase-N artifact isDone() (exists AND non-empty) | unit (pure gate) | `npx vitest run test/protocol-gate.test.ts` | ❌ W0 → test/protocol-gate.test.ts | ⬜ pending |
| 3-02-01 | 02 | 2 | PROT-03 | T-03-07 | gate fails on a 0-byte / missing artifact | unit | `npx vitest run test/protocol-gate.test.ts -t "empty artifact"` | ❌ W0 → test/protocol-gate.test.ts | ⬜ pending |
| 3-02-02 | 02 | 2 | PROT-01 / PROT-03 / PROT-04 | T-03-06 / T-03-07 / T-03-10 | engine drives all 6 phases (1 artifact/agent/kind), gates on artifacts-on-disk, scopes draft + promotes at boundary, allSettled fan-out; gated paths == written paths | integration (fake fixtures) | `npx vitest run test/protocol-engine.test.ts` | ❌ W0 → test/protocol-engine.test.ts | ⬜ pending |
| 3-02-02 | 02 | 2 | PROT-01 | T-03-08 | run-start `assertReviewable` enforced for `mar run` (NOT exempt) — <2 distinct vendors refused | unit | `npx vitest run test/protocol-engine.test.ts -t "refuses <2 vendors"` | ❌ W0 → test/protocol-engine.test.ts | ⬜ pending |
| 3-02-03 | 02 | 2 | PROT-01 | T-03-09 | `mar run <input>` thin subcommand turns the Plan-01 e2e anchor GREEN; input bounded to MAX_PROMPT_FILE_BYTES | integration (fake fixtures) | `npx vitest run test/protocol-run.e2e.test.ts` | ✅ (created 3-01-03; GREEN here) | ⬜ pending |
| 3-03-01 | 03 | 3 | PROT-04 (Success #4) | T-03-12 | A/B planted-error: independent drafts surface the error a shared-context control masks; hermetic, zero credits | integration (fake fixtures) | `npx vitest run test/planted-error.test.ts` | ❌ W0 → test/planted-error.test.ts | ⬜ pending |
| 3-03-02 | 03 | 3 | PROT-01 / PROT-03 / PROT-04 | T-03-11 / T-03-13 | live human-verified `mar run` advances all 6 phases; work/<agent>/ lacked peer drafts; single-vendor refusal holds | manual (live checkpoint) | see Manual-Only Verifications | ✅ (live, no test file) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Per-vendor `cwd` pass-through (RESEARCH Test Map row "adapters pass cwd through to execa") is exercised by `test/adapter-cwd.test.ts` (row 3-01-01) across all three adapters — claude, codex, gemini.*

---

## Wave 0 Requirements

Wave 0 = the failing test scaffolds Plans 01–03 create before/with their implementation. All five live in `test/`; one fixture-mode extension supports per-phase output.

- [x] `test/adapter-cwd.test.ts` — PROT-04 `cwd` pass-through drift guard, all 3 adapters (created in Plan 01 Task 1)
- [x] `test/scope-independence.test.ts` — PROT-04 scoped-dir listing + promotion boundary (created in Plan 01 Task 2)
- [x] `test/protocol-run.e2e.test.ts` — PROT-01 RED e2e anchor: `mar run` 6-phase advance (created in Plan 01 Task 3; turned GREEN in Plan 02 Task 3)
- [x] `test/protocol-gate.test.ts` — PROT-03 pure gate incl. empty/missing artifact (created in Plan 02 Task 1)
- [x] `test/protocol-engine.test.ts` — PROT-01/03/04 6-phase engine + ≥2-vendor gate (created in Plan 02 Task 2)
- [x] `test/planted-error.test.ts` — Success-criterion #4 A/B catch test (created in Plan 03 Task 1)
- [x] Fixture extension: `--emit <kind>` mode in `test/fixtures/fake-{claude,codex,gemini}.mjs` so a multi-phase run yields distinct per-phase artifacts (Plan 01 Task 3); planted-error fixture mode (Plan 03 Task 1)
- [x] Framework install: none — vitest ^4 already present.

*Wave 0 is satisfied: every requirement and the success-criterion #4 behavior has a named failing-test scaffold created by its owning plan task; no implementation task lacks a corresponding test.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `mar run` advances a small real document through all 6 phases against real CLIs | PROT-01 / PROT-03 / PROT-04 | CI fixtures are hermetic/zero-credit by design; confirming real CLI behavior (esp. codex under a non-repo `cwd`, Pitfall 4) needs a one-time human-verified live run, mirroring the Phase 1/2 live-verify pattern | Plan 03 Task 2: ensure ≥2 healthy distinct vendors (`mar preflight`); create a tiny input.md; `npx tsx src/cli.ts run <input.md>`; confirm `runs/<id>/manifest.json` status "completed", one artifact per agent for all 6 kinds, `work/<agent>/` held only input.md during draft, `shared/` has promoted drafts, `invocations.ndjson` logged each turn with NO prompt body, console streamed a progress line per boundary/turn, and a 1-vendor config is refused non-zero |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the lone manual item — live run — is the deliberate once-per-phase live checkpoint, mirroring Phases 1/2)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (only the final live checkpoint is manual; every implementation task has an automated command)
- [x] Wave 0 covers all MISSING references (5 test files + fixture modes named above; all owned by a plan task)
- [x] No watch-mode flags (all commands use `vitest run`, never `vitest` watch)
- [x] Feedback latency < 3s (fixtures only; no live CLI in the automated path)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-04
