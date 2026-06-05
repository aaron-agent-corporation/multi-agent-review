---
phase: 4
slug: first-end-to-end-run
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-05
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 04-RESEARCH.md ## Validation Architecture (vitest, REQ→test map, Wave 0 gaps).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4 [VERIFIED: package.json] |
| **Config file** | none standalone; `npm test` → `vitest run` |
| **Quick run command** | `npx vitest run test/<file>.test.ts` |
| **Full suite command** | `npx vitest run` (196 tests green at Phase 3 close) |
| **Estimated runtime** | ~4 seconds (full suite hermetic; zero credits, D-49) |

---

## Sampling Rate

- **After every task commit:** Run the task's own `npx vitest run test/<file>.test.ts`
- **After every plan wave:** Run `npx vitest run` (full suite) + `npx tsc --noEmit` + `npx biome check`
- **Before `/gsd:verify-work`:** Full suite must be green AND the live 3-vendor human-verify checkpoint (04-05 Task 3) passed
- **Max feedback latency:** 4 seconds (quick run); ~4s full suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | (install) | T-04-SC | Supply-chain: legitimacy checkpoint before gray-matter install (never auto-approved) | manual+auto | `node -e "require('gray-matter')"` | ✅ post-install | ⬜ pending |
| 4-01-02 | 01 | 1 | REVW-01, REVW-02 | T-04-01 | zod safeParse rejects malformed review/response frontmatter (V5 Input Validation) | unit (tdd) | `npx vitest run test/review-schema.test.ts test/response-schema.test.ts` | ❌ W0 (created in-task) | ⬜ pending |
| 4-01-03 | 01 | 1 | REVW-03, RCRD-01, RSLV-01 | T-04-01 | evaluation + decision-record schemas reject missing rationale/round (V5) | unit (tdd) | `npx vitest run test/evaluation-schema.test.ts test/decision-record-schema.test.ts` | ❌ W0 (created in-task) | ⬜ pending |
| 4-02-01 | 02 | 1 | REVW-01, REVW-02 | T-04-02 (spike) | Ancestor instruction-file inheritance neutralized; seeded contract is the only one in effect (Tampering/Integrity) | unit + spike | `npx vitest run test/instructions.test.ts` | ❌ W0 (created in-task) | ⬜ pending |
| 4-03-01 | 03 | 2 | REVW-01, REVW-02 | T-04-01 | Validation-with-one-retry gate; second failure = failed turn (D-38; never silent-normalize) | unit | `npx vitest run test/validation-retry.test.ts` | ❌ W0 (created in-task) | ⬜ pending |
| 4-03-02 | 03 | 2 | REVW-04 | T-04-10 | Integration gate expects exactly 1 writer (integrator-only); other agents cannot merge | unit | `npx vitest run test/protocol-gate.test.ts` (extend) | ✅ extend | ⬜ pending |
| 4-04-01 | 04 | 3 | REVW-03 | T-04-12 | Bounded convergence loop: agreement/cap/unresolvable exits; cap is a hard DoS backstop (D-41) | unit | `npx vitest run test/converge.test.ts` | ❌ W0 (created in-task) | ⬜ pending |
| 4-04-02 | 04 | 3 | REVW-04, REVW-05, RSLV-01 | T-04-10, T-04-11 | Single integrator merges; per-addition verdict before patch; conflicting addition rejected (no auto-merge) | unit | `npx vitest run test/integration.test.ts` | ❌ W0 (created in-task) | ⬜ pending |
| 4-05-01 | 05 | 4 | RCRD-01, RSLV-01 | T-04-14, T-04-15 | Contested-only decision record with rationale + lineage; atomic temp-then-rename write | unit | `npx vitest run test/decision-record.test.ts` | ❌ W0 (created in-task) | ⬜ pending |
| 4-05-02 | 05 | 4 | RCRD-01, all | T-04-14 | Full 3-agent hermetic run produces a validated decision record (success #1) | e2e (fixtures) | `npx vitest run test/protocol-run.e2e.test.ts` | ✅ extend | ⬜ pending |
| 4-05-03 | 05 | 4 | all | T-04-16 | TRUE 3-vendor LIVE run; no ancestor-instruction leakage (P1-P3 format held) | manual (human-verify) | see Manual-Only Verifications | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> **Wave 0 is FOLDED INTO Wave 1's `tdd="true"` tasks** — there is no separate `wave:0` plan.
> Each test file below is created inside the same task that implements its production code, but
> via the RED→GREEN ordering enforced by the task's `tdd="true"` + `<behavior>` block: the test
> is written and run RED before the implementation exists, then driven GREEN. This satisfies
> test-before-impl ordering without a standalone Wave 0 plan. The 04-01 schema tasks and the
> 04-02 instructions task are explicitly tdd-ordered; the 04-03/04/05 logic tasks create their
> test files in the same task and MUST follow the RED-first cycle documented in their `<behavior>`/
> acceptance criteria. Sampling continuity holds: no 3 consecutive tasks lack an automated verify.

Test files created during Wave 1+ (each RED-first inside its implementing task):

- [ ] `test/review-schema.test.ts` — REVW-01 (04-01 Task 2, tdd)
- [ ] `test/response-schema.test.ts` — REVW-02 (04-01 Task 2, tdd)
- [ ] `test/evaluation-schema.test.ts` — REVW-03 (04-01 Task 3, tdd)
- [ ] `test/decision-record-schema.test.ts` — RCRD-01/RSLV-01 (04-01 Task 3, tdd)
- [ ] `test/instructions.test.ts` — D-37 seeding + **ancestor-inheritance neutralization spike** (Pitfall 1) (04-02)
- [ ] `test/validation-retry.test.ts` — D-38 one-retry gate (04-03 Task 1)
- [ ] `test/converge.test.ts` — REVW-03 loop exits agreement/cap/escalate (04-04 Task 1)
- [ ] `test/integration.test.ts` — REVW-04/05 integrator-only + addition verdicts (04-04 Task 2)
- [ ] `test/decision-record.test.ts` — RCRD-01/RSLV-01 writer (04-05 Task 1)
- [ ] Fixture extension: fake-CLI `--emit <kind>` modes for structured review/response/evaluation/integration content (04-03; extends Phase-3 fixtures)
- [ ] `test/protocol-gate.test.ts` — REVW-04 integrator-1-writer (04-03 Task 2, EXTEND existing)
- [ ] `test/protocol-run.e2e.test.ts` — success #1 3-vendor hermetic run (04-05 Task 2, EXTEND existing)
- [ ] Install: `gray-matter@^4` (04-01 Task 1, checkpoint-gated)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TRUE 3-vendor LIVE run produces a decision record with no ancestor-instruction leakage | all (D-48 success bar) | Requires live multi-vendor auth (claude+codex+gemini) and human judgment of output quality; cannot run in CI without credits/auth (D-49 fixtures cover dynamics) | 04-05 Task 3: (1) `mar preflight` — all 3 vendors authenticated (gemini via settings.json OAuth primary / `GEMINI_API_KEY` fallback, D-48); (2) `mar run <test-doc>` with a 3-distinct-vendor config; (3) confirm 6 phases complete, `runs/<id>/decision-record.md` exists with rationale+lineage, and reviews use the P1-P3 issue/severity/question format (NOT GSD-workflow language — leakage warning sign) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (live checkpoint is the only manual-only, justified above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (folded into Wave 1 tdd tasks — documented above)
- [x] No watch-mode flags (`vitest run`, never `vitest --watch`)
- [x] Feedback latency < 4s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-05
