---
phase: 05-hardening-resume-gating-majority-guards
verified: 2026-06-05T16:05:00Z
status: passed
score: 27/27 must-haves verified
---

# Phase 05 Verification — Hardening: Resume, Gating, Majority, Guards

## Goal Assessment

**Goal:** A user can run the protocol unattended or human-gated with confidence: interrupted runs resume cleanly, the run can pause at phase boundaries for approval, discrete forks use a majority signal, unresolved forks escalate correctly, and settled decisions are not re-litigated.

**Verdict: ACHIEVED.** Every limb of the goal is observable in the shipped codebase, not merely claimed:

- **Unattended vs gated:** `resolveGating` (src/cli.ts:69-95) resolves mode by explicit flag → TTY prompt → config default. A bare non-TTY `mar run` defaults to `config.defaults.mode` (autonomous) and never prompts (D-53/Pitfall 5). Gated mode pauses at every non-last phase boundary via always-present `gate__<phase>` transient states (engine.ts), no-op in autonomous so the autonomous path is byte-for-byte unchanged.
- **Resume:** `resumeProtocol` (engine.ts:1235+) re-derives the resume phase from the manifest, rehydrates the roster, re-validates per D-56, and re-enters `buildMachine(resumePhase)` — no XState snapshot persistence (only `actor.getSnapshot()` reads of the resolved state, which is the standard read API, not restore).
- **Majority signal:** `clearMajority(signals, rosterSize)` (converge.ts:145-155) returns a base only when `bestCount > rosterSize/2`, inserted before BOTH escalate guards; the tally is computed only at the exit boundary, never injected into a round (D-59).
- **Escalation:** no-clear-majority falls through to `escalate(...)`; gated mode arbitrates (`resolver: "human"`, gating.ts:270), autonomous logs an open decision and does not pause (D-42 preserved).
- **No re-litigation:** rolling `shared/resolved-decisions.md` ledger (resolved-decisions.ts) injected via the seeded template directive + enforced via `enforceRelitigation`/`enforceDrop` (drop+warn, no retry); terminal decision-record assembles FROM the ledger and carries `resolver`.

**Tests:** 40 files / 313 tests green. `npx tsc --noEmit` clean. `npm run build` succeeds and `dist/templates/agent-instructions.md.tmpl` exists (6576 bytes) with `files:["dist"]` — the 05-01 carry-over fix is in place.

## Must-Haves

| Plan | Must-have | Status | Evidence |
|------|-----------|--------|----------|
| 05-01 | dist `.tmpl` copied at build | VERIFIED | package.json build = `tsc && node -e "...cpSync('src/templates','dist/templates',...)"`; dist/templates/agent-instructions.md.tmpl exists post-build |
| 05-01 | tarball ships dist (`files`) | VERIFIED | package.json `files: ["dist"]` |
| 05-01 | claude adapter omits `--bare`, pinned | VERIFIED | `grep bare src/adapters/claude.ts` → no match; pin assertion in test/claude-adapter.test.ts |
| 05-01 | strengthened ancestor-ignore directive | VERIFIED | `grep -c "ignore any ancestor"` template → 2 |
| 05-01 | stale `--bare` comments corrected | VERIFIED | scope.ts/instructions.ts state OMITTED, not passed |
| 05-02 | ONE shared tolerant frontmatter reader | VERIFIED | src/protocol/frontmatter.ts `readAgentFrontmatter`/`parseAgentFrontmatter`; converge.ts + decision-record.ts import it |
| 05-02 | `paused-awaiting-approval` non-terminal status | VERIFIED | schema/manifest.ts:51 in enum; additive |
| 05-02 | RESUMABLE_STATUSES + TERMINAL_DONE single source | VERIFIED | schema/manifest.ts:90,97 |
| 05-02 | resolved-decisions ledger schema + resolver enum | VERIFIED | src/schema/resolved-decisions.ts `Resolver` (convergence\|majority\|integrator\|human), `ResolvedDecisionEntry`, `ResolvedDecisionsLedger` |
| 05-02 | per-author fixture base steering | VERIFIED | `MAR_EMIT_BASES` in test/fixtures/structured-shared.mjs (test passes) |
| 05-03 | majority tie-break at cap/deadlock only | VERIFIED | converge.ts:247,281 clearMajority before both escalate guards |
| 05-03 | `clearMajority` = `bestCount > rosterSize/2` | VERIFIED | converge.ts:154 |
| 05-03 | 2-1 resolves, 1-1-1 + 2v-1-1 escalate | VERIFIED | test/converge.test.ts cases (suite green) |
| 05-03 | ConvergenceResult.resolver additive field | VERIFIED | converge.ts:42; unanimous tagged convergence (237), majority (255/289) |
| 05-03 | tally never in round prompts | VERIFIED | clearMajority called only at exit boundary; grep confirms no prompt-path call |
| 05-04 | resume from last completed phase | VERIFIED | resumeProtocol + firstIncompletePhase (engine.ts:1201,1235) |
| 05-04 | re-derive from manifest, no snapshot persistence | VERIFIED | no `getPersistedSnapshot`/`createActor(...,{snapshot})`; buildMachine(resumePhase) sets `initial` |
| 05-04 | resume entry is a phase name (no re-fan-out of drafts) | VERIFIED | initial=resumePhase; only draft's next is promote |
| 05-04 | D-56 re-validate (artifacts + schema + preflight) | VERIFIED | revalidateForResume (engine.ts:1235) uses readAgentFrontmatter + runPreflight, specific errors |
| 05-04 | D-57 roster by reason | VERIFIED | rehydrateRoster (engine.ts:1172): failed/timeout→full agents, else survivors minus dropped |
| 05-04 | only RESUMABLE runs resume; `--last` picks recent | VERIFIED | cli.ts resume command + TERMINAL_DONE refusal (suite green) |
| 05-05 | per-run autonomous/gated; pauses at boundaries | VERIFIED | resolveGating + gate__<phase> states |
| 05-05 | blocking prompt AND pause-and-exit path | VERIFIED | runGate + paused final state → setStatus paused-awaiting-approval; mar resume continues |
| 05-05 | approve/abort/feedback; feedback into NEXT phase only | VERIFIED | gating.ts parseGateAnswer/injectFeedback; cleared after one phase (suite green) |
| 05-05 | isTTY-guarded; non-TTY never hangs | VERIFIED | cli.ts:80 isTTY guard, else config default, never asks |
| 05-05 | injectable ask() seam | VERIFIED | GatingOptions.ask + cli setAsk/resetAsk |
| 05-05 | gated arbitration → resolver:human; autonomous logs | VERIFIED | gating.ts:270 resolver:"human"; arbitrate state no-op unless gated+escalated |
| 05-06 | rolling shared/resolved-decisions.md ledger | VERIFIED | resolved-decisions.ts LEDGER_FILE, appendResolved |
| 05-06 | inject + enforce guard | VERIFIED | template RESOLVED DECISIONS section (grep "resolved-decisions.md" → 2) + enforceRelitigation/enforceDrop |
| 05-06 | drop + warn, no retry, logged re-litigation | VERIFIED | enforceDrop reason:"re-litigation", console.warn, run continues |
| 05-06 | injection-safe write, gray-matter READ-only | VERIFIED | hand-rolled yamlScalar serializer; no matter.stringify in module |
| 05-06 | terminal record assembles FROM ledger + sources resolver | VERIFIED | decision-record.ts imports readLedger/readRelitigationDrops; resolver emitted (line 62) |
| 05-06 | race-safe appends | VERIFIED | serializeWrite per-runDir chain |

(27 distinct must-have *truths* across the 6 plans, all VERIFIED; the artifact/key-link sub-items above are subsidiary evidence rows.)

## Requirements Traceability

| Req | Text (abbrev) | Delivered by | Status |
|-----|---------------|--------------|--------|
| PROT-05 | Per-run autonomous vs gated; pause at phase boundaries | 05-05 (resolveGating, gate__<phase> states, paused status) | SATISFIED |
| PROT-06 | Resume interrupted run from last completed phase | 05-04 (resumeProtocol, firstIncompletePhase, no-snapshot re-derivation) | SATISFIED |
| RSLV-02 | Discrete forks use majority signal to break ties | 05-03 (clearMajority) + 05-02 (per-author fixture) | SATISFIED |
| RSLV-03 | Unresolvable forks escalate — human arbitration (gated) / logged (autonomous) | 05-03 (no-majority escalate) + 05-05 (gated arbitration resolver:human) + 05-06 (recorded) | SATISFIED |
| RCRD-02 | Resolved-decisions record fed forward as a guard | 05-06 (ledger inject + enforce + terminal record sourcing) | SATISFIED |

All 5 phase requirement IDs are mapped to plans whose `requirements:` fields cite them and are observable in code. REQUIREMENTS.md still lists these as `[ ]`/`Pending` (the traceability table was not updated by the executor — see Gaps, cosmetic only).

## Success Criteria (ROADMAP Phase 5)

1. **Per-run autonomous vs gated choice (pause for approval at boundaries)** — TRUE. cli.ts:69-95 resolveGating; gated pauses at each non-last boundary; mode chosen by flag or TTY prompt.
2. **Resume interrupted run from last completed phase without re-running prior phases** — TRUE. resumeProtocol re-derives resume phase from manifest count; seq monotonicity keeps phase ≤N artifacts unrewritten; e2e asserts kept-artifact mtimes unchanged.
3. **Discrete forks collect positions as a majority signal** — TRUE. clearMajority tallies proposedBase signals; fires only at cap/deadlock to break a tie (D-59).
4. **Unresolvable disagreements escalate — pause for arbitration (gated) / logged (autonomous)** — TRUE. No-majority → escalate; gated arbitrate state records resolver:human; autonomous leaves a logged open decision and never prompts.
5. **Resolved-decisions record fed to later phases as a guard (no re-litigation)** — TRUE. Rolling ledger injected via seeded directive + enforced via drop+warn at integration/validation; terminal record notes violations.

## Decision Fidelity Spot-Checks

- **D-53 (isTTY bypass, non-TTY never hangs):** HONORED — cli.ts:79-89 only prompts when `process.stdin.isTTY`; else config default, never asks. e2e drives `stdin:"ignore"` to completion.
- **D-57 (failed-run resume restores full roster; paused keeps survivors):** HONORED — rehydrateRoster keys off status (failed/timeout→full config.agents; else survivors minus droppedAgents).
- **D-59 (majority only at cap/deadlock; tally never in round prompts):** HONORED — clearMajority invoked only inside the cap and deadlock guards at the exit boundary.
- **D-60 (1-1 escalates):** HONORED — `> rosterSize/2` means 1 is not a majority of 2 (or of 3 for 1-1-1); both escalate (test cases green).
- **D-64 (drop+warn, no retry):** HONORED — enforceDrop emits a console.warn and returns a `re-litigation` drop; the run continues; no retry path.
- **D-65 (digest = decision + one-line rationale + what resolved it):** HONORED — template RESOLVED DECISIONS section describes exactly "one line per decision (the decision, a one-line rationale, and what resolved it)"; the ledger body IS the digest, prompts stay thin.

## Documented Deviations (verified sound)

- **Ledger single-parse read** (05-06): `readLedger` uses one `matter(raw).data` parse rather than the shared double-strip reader. SOUND — the ledger is the orchestrator's own wrapper-less peer artifact with frontmatter at position 0; the double-strip reader would consume real frontmatter as a wrapper. gray-matter stays READ-only. Documented in 05-06-SUMMARY.
- **Enforcement after fan-out vs before** (05-06): `enforceRelitigation` runs after each phase's fan-out, checking just-written positions against forks settled by EARLIER phases, then appends. SOUND — avoids a phase self-matching its own new ids; a reopening position is still dropped+noted before it influences downstream. Documented.
- **relitigation-drops.json sidecar** (05-06): drops persisted to a plain JSON sidecar (orchestrator-minted, serializeWrite + atomic), read by the decision record. SOUND — not agent prose, no injection surface; schema gained additive optional `resolver` + defaulted `relitigationViolations[]` (prior records parse unchanged). Documented.
- **firstIncompletePhase uses manifest count, not on-disk isDone** (05-04): SOUND — a missing/deleted completed artifact is a D-56 integrity REFUSAL (revalidateForResume), not a silent re-run. Documented.
- **D-57 e2e asserts resumed full-roster completion, not droppedAgents** (05-04): SOUND — applySkipFailed throws at the floor before the drop-recording loop, so droppedAgents stays empty; rehydrateRoster keys off STATUS, so D-57 holds regardless. Documented.

All notable deviations are explicit in their SUMMARYs and are improvements/clarifications, not silent scope cuts.

## Gaps

| Gap | Severity | Suggested fix |
|-----|----------|---------------|
| REQUIREMENTS.md still marks PROT-05/06, RSLV-02/03, RCRD-02 as `[ ]` and the traceability table rows as `Pending`; ROADMAP marks Phase 5 complete. | LOW (cosmetic/bookkeeping) | Tick the 5 checkboxes and set their traceability rows to `Complete` to match delivered + tested code. No code impact. |

No functional gaps found. One pre-existing biome finding (`engine.ts` `phase.validate!` noNonNullAssertion) predates Phase 5 (owned by 04-05) and is not introduced by this phase.

## Human Verification

These were planned as manual-only in 05-VALIDATION.md and cannot be fully simulated hermetically:

1. **Blocking TTY prompt ergonomics (PROT-05)** — Run `mar run <doc>` in a real terminal, choose gated, and confirm the run-start mode prompt and each phase-boundary approve/abort/feedback prompt render and behave correctly. (Hermetic tests cover the logic via the ask() seam; only the live TTY feel is unverified.)
2. **Live gated arbitration feel (RSLV-03)** — Force a live escalation (or run fixtures in a TTY) and confirm the arbitration presentation (each agent's final position + cited evidence, pick-a-side vs free-form ruling) is usable. (resolver:"human" recording is hermetically proven; presentation quality is a human judgment.)
