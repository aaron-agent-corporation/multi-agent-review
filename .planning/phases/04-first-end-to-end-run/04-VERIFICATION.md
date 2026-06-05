---
phase: 04-first-end-to-end-run
verified: 2026-06-05T00:00:00Z
status: passed
score: 19/19 must-haves verified
---

# Phase 04 Verification — First End-to-End Run

## Goal Assessment

**Phase goal:** A user can execute one complete 3-agent run through all 6 phases on a test
document, with structured reviews, structured responses, a single designated integrator, and a
decision record as output — the v1 success bar.

**Verdict: ACHIEVED.** The goal is delivered and proven two ways:

1. **Hermetic (zero-credit):** `test/protocol-run.e2e.test.ts` drives a 3-vendor fixture roster
   (claude+codex+gemini) through all 6 phases and asserts a `decision-record.md` that validates
   against `DecisionRecordFrontmatter` (success criterion #1, D-49). Full suite green:
   **33 files / 267 tests**, `tsc --noEmit` clean, `biome check` clean (1 pre-existing warning).

2. **Live (D-48, user-approved):** `runs/20260605-MlhRzU/` is a real claude+codex+gemini run.
   All three vendors survived every structured phase (artifacts 002–017 cover review, response,
   evaluation r1+r2, integration, validation for all three). `manifest.json` status is
   `completed`; `decision-record.md` carries 19 `resolvedDecisions` (each with rationale +
   lineage), `openDecisions: []`, `unanimousTally: 20`, and a `runChain`. The user approved this
   run after two checkpoint-resolution fixes (a2b91ab, d629a8a).

The goal is phrased as "a user can execute one complete 3-agent run." That capability is real and
demonstrated. Two packaging/design gaps exist (see Gaps) but neither blocks the goal: the live run
that satisfies the v1 success bar succeeded via `tsx` from source, which is the project's
documented dev runtime (CLAUDE.md lists tsx as the run mechanism). The gaps affect the *compiled*
distribution path and a `--bare` design decision, not the user's ability to perform a run today.

## Must-Haves (per plan, with evidence)

### 04-01 — Schemas + gray-matter

| Must-have | Status | Evidence |
|-----------|--------|----------|
| Structured review (numbered issues, P1-P3, one question each) validates; malformed rejected with typed errors | VERIFIED | `src/schema/review.ts:8-44` — ReviewIssue (n int+, severity enum P1/P2/P3, question min 1), issues min 1, superRefine rejects dup `n` |
| reject-with-reason structurally requires reason; refine requires refinement | VERIFIED | `src/schema/response.ts:9-24` — discriminatedUnion on verdict; reject-with-reason has required `reason`, refine has required `refinement` |
| Evaluation exposes round, proposedBase, remainingDisagreements from disk | VERIFIED | `src/schema/evaluation.ts:10-17` — round int+, proposedBase min 1, remainingDisagreements array, citations default [] |
| Decision record models resolvedDecisions, openDecisions, per-decision lineage, unanimousTally scalar | VERIFIED | `src/schema/decision-record.ts:14-46` — ResolvedDecision (rationale required, lineage[]), OpenDecision, unanimousTally int>=0 |
| gray-matter@^4 installed (parse-only) | VERIFIED | imported READ-only in converge.ts:3, decision-record.ts:3, engine.ts; no `matter.stringify` anywhere; 04-01-SUMMARY records human-approved install checkpoint |

### 04-02 — Format-contract delivery + Pitfall-1 neutralization

| Must-have | Status | Evidence |
|-----------|--------|----------|
| Each agent's scoped folder seeded with vendor-native instruction file from ONE template | VERIFIED | `src/protocol/instructions.ts:13-45` — VENDOR_FILE {claude:CLAUDE.md, codex:AGENTS.md, gemini:GEMINI.md}; seedInstructions renders `src/templates/agent-instructions.md.tmpl` verbatim |
| Agent in scoped cwd does NOT inherit repo root CLAUDE.md (seeded contract is in effect) | VERIFIED (live, with caveat) | Neutralization mechanism documented at instructions.ts:32-41; hermetic spike test in test/instructions.test.ts; live run 20260605-MlhRzU showed zero GSD-language leakage per 04-05-SUMMARY. CAVEAT: claude `--bare` is NOT yet wired in the adapter (Gap 2) — neutralization held live anyway because the seeded CLAUDE.md is nearest and the contract dominated |
| Contract specifies numbered issues w/ P1-P3 + one question, and verdicts accept/reject-with-reason/refine | VERIFIED | template path resolved via import.meta.url (instructions.ts:22); 04-02-SUMMARY confirms tokens present; schemas enforce the same vocabulary |

### 04-03 — Real prompts + validation-with-one-retry + integrator gate + fixtures

| Must-have | Status | Evidence |
|-----------|--------|----------|
| Each structured phase delivers a thin prompt referencing the seeded file (not Phase-3 placeholder) | VERIFIED | `src/protocol/phases.ts:37-39,87-144` — thinPrompt `[phase:<name>] <instruction>`, no format tokens; engine.ts:113 uses `phase.prompt(...)`; old placeholder absent |
| D-38: malformed artifact → exactly ONE retry with errors appended, second failure = failed turn | VERIFIED | `src/protocol/engine.ts:191-239` — safeValidate, one reattempt with `## Validation errors to fix`, second failure returns `validation-failed`; never auto-normalized |
| Integration phase expects exactly ONE writer | VERIFIED | `src/protocol/gate.ts:53-55` — `if (participants === "integrator") return 1`; engine.ts:356 fans out over only the integrator |
| D-49: fixtures emit schema-valid review/response/evaluation/integration + a malformed mode | VERIFIED | full hermetic 3-vendor e2e passes; test/validation-retry.test.ts exercises the retry; fixtures present |

### 04-04 — Convergence loop + integrator-only merge

| Must-have | Status | Evidence |
|-----------|--------|----------|
| D-40: base selection is a bounded iterative convergence loop (not one-shot vote) | VERIFIED | `src/protocol/converge.ts:175-258` — round loop to cap, evaluation fan-out per round, agreement read from disk |
| On agreement, exactly one integrator = author of agreed base (D-44) | VERIFIED | converge.ts:210-219, integratorFor (260-267); engine.ts threads integrator into context (523-552) |
| D-41: exit on agreement / unresolvable / cap (convergenceCap default 10, configurable); escalate with fallback base + open decision | VERIFIED | `src/schema/config.ts:52` convergenceCap default 10 inside `.prefault({})`; converge.ts guards 1-3 (210-249), escalate() picks most-supported base + openDecision |
| Only integrator merges; per-addition verdict (accept/refine/reject-conflicts) with rationale | VERIFIED | `src/schema/integration.ts:10-37` — AdditionVerdict union merged/merged-with-change(+change)/dropped(+reason); engine integrator-only fan-out |
| Iteration cap is configurable backstop, not optimized away (D-43) | VERIFIED | converge.ts:193 loops to `cap`; comment 251-252 "never cut rounds for token cost"; manifest `escalated` status added (manifest.ts:41) |

### 04-05 — Decision-record writer + terminal wiring + LIVE checkpoint

| Must-have | Status | Evidence |
|-----------|--------|----------|
| D-47: every run produces decision-record.md with resolved (rationale) + open + per-decision lineage + compact runChain | VERIFIED | `src/protocol/decision-record.ts:130-266`; live record runs/20260605-MlhRzU/decision-record.md has all fields |
| Record captures CONTESTED only — unanimous collapse to one-line tally (D-46) | VERIFIED | decision-record.ts:150-152,191-192 — accept/merged → unanimousTally; reject/refine/dropped/merged-with-change → resolvedDecisions; live tally=20 |
| Each integrator resolution + convergence concession logged with rationale (RSLV-01) | VERIFIED | decision-record.ts:143-234 — response/integration/concession all carry rationale; schema requires non-empty rationale (validated before write) |
| D-49: hermetic 3-agent run finishes 6 phases + produces a record (zero credits) | VERIFIED | test/protocol-run.e2e.test.ts; suite 267/267 green |
| True 3-vendor LIVE run produces a record, human-verified (D-48) | VERIFIED | runs/20260605-MlhRzU/ status completed, all 3 vendors survived; user-approved per 04-05-SUMMARY Task 3 resolution |

## Requirements Traceability (all 7 IDs)

| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| REVW-01 | Structured reviews (numbered, P1-P3, one question), system-validated | SATISFIED | review.ts + validation gate (engine.ts:191-239); live reviews validated |
| REVW-02 | Per-issue verdict accept/reject-with-reason/refine | SATISFIED | response.ts discriminated union; live responses present |
| REVW-03 | Evidence-grounded base selection | SATISFIED | evaluation.ts (proposedBase + citations); converge.ts reads signals from disk |
| REVW-04 | Exactly one integrator; only integrator merges | SATISFIED | gate.ts:54 returns 1; integration.ts single-writer; live run 014-codex-1-integration.md is the sole merge |
| REVW-05 | Integrator reviews additions before patching; may refine/reject conflicts | SATISFIED | integration.ts AdditionVerdict (dropped+reason = reject-conflicts-with-resolved; merged-with-change = refine) |
| RSLV-01 | Resolutions logged with rationale (integrator judgment default) | SATISFIED | decision-record.ts requires rationale on every resolved decision; live record has 19 with rationale |
| RCRD-01 | Decision record: resolved + open + lineage | SATISFIED | decision-record.ts + DecisionRecordFrontmatter; live decision-record.md complete |

All 7 IDs are mapped to Phase 4 in REQUIREMENTS.md (lines 100-106, status "Pending" — should be
flipped to Complete; that is a bookkeeping update, not a delivery gap). No requirement is
unaccounted for.

## Success Criteria check (ROADMAP Phase 4)

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Complete 3-agent run finishes all 6 phases + produces a decision record | TRUE | hermetic e2e green + live run 20260605-MlhRzU (status completed, 17 artifacts, decision-record.md) |
| 2 | Cross-reviews system-validated structured format (numbered, P1-P3, one question) | TRUE | review.ts schema + engine validation gate; live review artifacts present and validated |
| 3 | Per-issue verdict accept/reject-with-reason/refine | TRUE | response.ts; live response artifacts |
| 4 | Exactly one integrator after evidence-grounded evaluation; only integrator merges, reviewing additions before patching | TRUE | converge.ts + gate.ts:54 + integration.ts; live run single integration artifact (014-codex-1) |
| 5 | Decision record: resolved (rationale) + open + lineage; each integrator resolution logged | TRUE | live decision-record.md: 19 resolved w/ rationale+lineage, 0 open, tally 20, runChain |

## Gaps

### Gap 1 — dist packaging: build omits the instruction template (MEDIUM, non-blocking)
`package.json:15` build is bare `tsc`; `dist/templates/` does not exist (verified absent). The
compiled `mar` binary fails at draft fan-out (ENOENT on agent-instructions.md.tmpl). Live runs
used `tsx` from source as a workaround.
- **Why non-blocking for the GOAL:** the phase goal is "a user can execute one complete 3-agent
  run" — achieved via tsx, the project's documented dev runtime. The compiled-distribution path is
  not a Phase-4 success criterion.
- **Suggested fix:** add a post-tsc copy step (e.g. `"build": "tsc && cpy 'src/templates/*' dist/templates"`
  or a tiny node copy script) and an assertion test that `dist/templates/agent-instructions.md.tmpl`
  exists after build. Track as a Phase-5 hardening item or a Beads issue.

### Gap 2 — claude adapter does not pass `--bare` (LOW, design tension, non-blocking)
`src/adapters/claude.ts:21` invokes `-p <prompt> --output-format json` with no `--bare`, so the
04-02/D-09 decision to run claude `--bare` on the live path is unimplemented. The repo root
CLAUDE.md is therefore in claude's context on live runs.
- **Why non-blocking for the GOAL:** the live checkpoint (run 20260605-MlhRzU) verified zero
  GSD-language leakage — the seeded nearest CLAUDE.md plus the OUTPUT CHANNEL/quoting hardening
  (a2b91ab, d629a8a) held the format contract live. There is a real design tension: `--bare` would
  also skip the *seeded* CLAUDE.md, so it cannot be naively added.
- **Suggested fix:** make a design call — e.g. `--bare` + `--append-system-prompt-file` pointing at
  the seeded contract, or a prompt-directed Read of the seeded file. Resolve in Phase 5.

## Human Verification

None required. The one item that needed a human (D-48 true 3-vendor live run) was already
completed and approved by the user on run 20260605-MlhRzU, and the evidence is independently
confirmable on disk (manifest status `completed`, all three vendors' artifacts present,
decision-record.md complete). The two gaps above are tracked engineering follow-ups, not
verification blockers.
