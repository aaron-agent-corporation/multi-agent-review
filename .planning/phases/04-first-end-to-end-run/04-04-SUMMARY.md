---
phase: 04-first-end-to-end-run
plan: 04
subsystem: protocol / convergence loop + integrator merge
tags: [convergence, D-40, D-41, D-43, D-44, REVW-03, REVW-04, REVW-05, RSLV-01, xstate, gray-matter]
requires:
  - "src/protocol/engine.ts runPhase fan-out + buildMachine XState v5 idiom (03-03)"
  - "src/schema/evaluation.ts EvaluationFrontmatter (proposedBase + remainingDisagreements, 04-01)"
  - "src/schema/integration.ts IntegrationFrontmatter per-addition verdict union (04-03)"
  - "src/schema/config.ts defaults .prefault block (04-01)"
  - "src/schema/manifest.ts status enum 'escalated' (04-03 additive)"
provides:
  - "src/protocol/converge.ts runConvergence — bounded evaluation convergence loop (REVW-03)"
  - "convergenceCap config (default 10, D-41/D-43) in defaults"
  - "engine evaluation phase = convergence loop; integration over exactly the designated integrator (D-44/REVW-04)"
  - "escalated terminal status wired off convergence.status (O-2 (a))"
  - "ConvergenceResult.concessions + openDecision for the 04-05 decision-record writer (RSLV-01)"
affects:
  - "04-05 decision-record writer consumes ConvergenceResult.concessions + openDecision and integration per-addition verdicts"
tech-stack:
  added: []
  patterns:
    - "convergence loop modeled as a bounded round loop reusing runPhase, kind disambiguated per round (evaluation-r<n>) to dodge Pitfall-3 seq/filename collision"
    - "agreement detected from validated artifact fields read off disk (A3 filesystem-as-truth), never model prose"
    - "double gray-matter parse (strip engine wrapper, trimStart, parse agent frontmatter) to read the agent's emitted frontmatter, not the engine-metadata block"
    - "evaluation phase invokes a dedicated convergenceActor instead of the gated phaseActor; integration phase threads context.integrator"
key-files:
  created:
    - "src/protocol/converge.ts"
    - "test/converge.test.ts"
    - "test/integration.test.ts"
  modified:
    - "src/schema/config.ts"
    - "src/protocol/engine.ts"
    - "test/protocol-engine.test.ts"
    - "test/protocol-run.e2e.test.ts"
    - "test/validation-retry.test.ts"
decisions:
  - "Round artifacts use a per-round disambiguated kind (evaluation-r<n>) so the SAME evaluation phase run multiple times never collides on seq/filename (Pitfall 3). The manifest kind is z.string(), so these parse unchanged; the engine/e2e tests' PHASE_KINDS evaluation entry became evaluation-r1."
  - "Integration verdict vocabulary follows the SHIPPED 04-03 IntegrationFrontmatter (merged | merged-with-change | dropped+reason), NOT the plan's literal 'reject-conflicts-with-resolved' string. A conflicting addition is rejected as `dropped` with a reason flagging the conflict — same intent, honoring the existing schema contract rather than redefining it."
  - "convergenceCap falls back to 10 when the config was built without MarConfig.parse (the hand-built test configs cast `as MarConfig`), so the loop is never governed by an undefined cap."
  - "An explicit unresolvable-deadlock guard (2 consecutive stable, conflicting, non-shrinking rounds) escalates BEFORE the cap (D-41b), distinct from the cap backstop (D-41c)."
metrics:
  duration: "~50 minutes"
  completed: "2026-06-05"
  tasks: 2
  files: 8
  tests_added: 6
---

# Phase 04 Plan 04: Convergence Loop + Integrator Merge Summary

Built the product (D-40): the bounded, evidence-grounded evaluation convergence loop and the single-integrator reviewed merge. `runConvergence` runs evaluation rounds (reusing the engine's `runPhase` fan-out), reads each round's evaluation artifacts back from disk to detect agreement from `proposedBase` + `remainingDisagreements` (A3 — never model prose), and exits on agreement / iteration cap / unresolvable deadlock — designating exactly one integrator (the agreed base's author, D-44). The engine's evaluation phase now invokes this loop instead of a single gated fan-out, and the integration phase fans out over only that integrator, which emits a per-addition verdict (merged / merged-with-change / dropped-with-reason) before patching — never an auto-merge.

## What Was Built

### Task 1 — Convergence sub-machine + convergenceCap config (commit efcfba0)
- `src/schema/config.ts`: added `convergenceCap: z.number().int().positive().default(10)` inside the existing `.prefault({})` defaults block (D-41 — the nested default fires when `defaults` is omitted; it is a DoS backstop, not a tuning knob, D-43).
- `src/protocol/converge.ts` (new): `runConvergence(roster, input)` runs the bounded round loop. Each round fans the surviving roster through one evaluation phase (reusing `runPhase`, with a per-round disambiguated `kind` `evaluation-r<n>` to avoid the Pitfall-3 seq/filename collision), then reads the round's artifacts off disk: `readManifest` → filter by round kind → `gray-matter` double-parse (strip the engine wrapper, `trimStart`, parse the agent's frontmatter) → `EvaluationFrontmatter.safeParse`. Guards in fixed order: `agreed` (all survivors share `proposedBase`, no open disagreements → designate base + base-author integrator, D-44) → `capReached` (D-41c) → `unresolvable` (2 consecutive stable conflicting rounds, D-41b) → else increment + loop (D-43). Escalation (O-2 (a)) picks the most-supported `proposedBase` as a provisional fallback base, designates its author integrator, and records an `openDecision` so the run still yields a usable artifact + a flagged fork. Returns `{ base, integrator, rounds, status, concessions, openDecision? }`.
- `src/protocol/engine.ts`: exported `runPhase`, `ProtocolInput`, `PhaseResult` as the reuse seam.
- `test/converge.test.ts` (new): agreement-round-1 (integrator = base author), cap-reached (distinct bases, no open disagreement → escalate with fallback + open decision), unresolvable-deadlock (stable conflicting disagreement → escalate before the cap).

### Task 2 — Engine wiring + integrator-only reviewed merge (commit a059ef6)
- `src/protocol/engine.ts`: added `integrator?: AgentEntry` + `convergence?: ConvergenceResult` to `ProtocolContext`. The evaluation state now invokes a dedicated `convergenceActor` (`fromPromise(runConvergence)`); `onDone` records the convergence result + resolves the designated integrator into context. The integration phase threads `context.integrator` into `runPhaseGated`, which fans out over exactly that one writer (REVW-04; the gate independently expects 1, Pitfall 4). A run whose convergence `escalated` sets terminal status `escalated` (O-2 additive) but STILL integrates the fallback base. `designateIntegrator` now prefers the convergence-designated integrator (matched by name to the live roster), falling back to `roster[0]` only defensively.
- `src/protocol/converge.ts`: `convergenceCap ?? 10` fallback for unparsed configs.
- `test/integration.test.ts` (new): single integration writer = the converged base author; the gate call over the integration phase saw exactly 1 path; the integration artifact carries 3 per-addition verdicts (merged / merged-with-change / dropped); a conflicting addition is `dropped` with a `conflicts-with-resolved` rationale (RSLV-01), never auto-merged (REVW-05).
- `test/protocol-engine.test.ts`, `test/protocol-run.e2e.test.ts`, `test/validation-retry.test.ts`: pinned `MAR_EMIT_BASE` so the stock fixtures agree on round 1 (status `completed`, not `escalated`); evaluation kind expectation became `evaluation-r1`; the gate-count test now asserts 5 gated phases (evaluation is governed by the convergence agreement guard, not the artifacts gate).

## Verification

- `npx vitest run test/converge.test.ts test/integration.test.ts` — green (6 new tests).
- `npx vitest run` (full suite) — **264 passed / 32 files**, no Phase-1/2/3 regressions (was 258; +6).
- `npx tsc --noEmit` — clean. `npx biome check` — clean (74 files).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Round artifacts need a per-round kind, breaking the engine/e2e PHASE_KINDS assertions**
- **Found during:** Task 1/2 (the convergence loop runs the SAME evaluation phase multiple times — Pitfall 3).
- **Issue:** A fixed `evaluation` kind would collide across rounds; the round loop writes `evaluation-r<n>`. Existing protocol-engine / protocol-run.e2e tests asserted a single `evaluation` kind and `requiredArtifactsExist` being called 6 times.
- **Fix:** Disambiguated the round kind (`evaluation-r<n>`); updated the affected tests' `PHASE_KINDS` evaluation entry to `evaluation-r1` and the gate-count test to 5 gated phases (evaluation is now gated by the convergence agreement guard, not the artifacts gate). Pinned `MAR_EMIT_BASE` in those full-protocol tests so the loop agrees on round 1.
- **Files modified:** src/protocol/converge.ts, test/protocol-engine.test.ts, test/protocol-run.e2e.test.ts, test/validation-retry.test.ts
- **Commit:** efcfba0 / a059ef6

**2. [Rule 1 - Bug] Reading the agent's evaluation frontmatter required trimming the wrapper's trailing newline**
- **Found during:** Task 1 (every round signal parsed to `data: {}` — "no parseable proposedBase").
- **Issue:** `writeArtifact` writes the agent body as `\n${text}` after the engine wrapper, so `matter(file).content` has a LEADING newline. gray-matter only recognizes a frontmatter block at the very START of the input, so the agent's frontmatter was silently missed.
- **Fix:** `matter(outer.content.trimStart())` before the inner parse. Same double-parse rule the 04-03 validation gate follows (validate the agent's emitted frontmatter, not the engine wrapper).
- **Files modified:** src/protocol/converge.ts
- **Commit:** efcfba0

**3. [Rule 3 - Blocking] convergenceCap undefined under hand-built (unparsed) test configs**
- **Found during:** Task 2 (full-protocol tests cast `defaults` `as MarConfig` without MarConfig.parse, so the nested prefault default never fires → `cap` is undefined → `round <= undefined` is always false → zero rounds).
- **Fix:** `const cap = input.config.defaults.convergenceCap ?? 10;` — the schema default mirrored defensively. Production configs (parsed via MarConfig) get 10 from zod; hand-built test configs get the same.
- **Files modified:** src/protocol/converge.ts
- **Commit:** a059ef6

### Plan-vs-schema reconciliation (not a code defect)

The plan's Task 2 text mentions a `reject-conflicts-with-resolved` verdict literal. The 04-03 `IntegrationFrontmatter` shipped a `merged | merged-with-change | dropped+reason` union. I honored the SHIPPED schema: a conflicting addition is rejected as `dropped` with a reason flagging the conflict (`conflicts-with-resolved …`). Same behavioral intent (review-before-patch, no auto-merge of a conflicting addition — REVW-05), without redefining the existing schema contract.

## Threat Model Compliance

- **T-04-10 (redundant merging):** mitigated — integration fans out over exactly `context.integrator` (the base author, D-44); the gate expects 1 writer (Pitfall 4); other agents never merge. Asserted in test/integration.test.ts.
- **T-04-11 (auto-merge of unreviewed/conflicting addition):** mitigated — the integrator emits a per-addition verdict and `dropped`s a conflicting addition with a rationale BEFORE patching (REVW-05). Asserted in test/integration.test.ts.
- **T-04-12 (unbounded convergence loop):** mitigated — `convergenceCap` (default 10, D-41) hard backstop; cap-reached → escalate, never spin. Asserted in test/converge.test.ts.
- **T-04-13 (unlogged resolution decisions):** mitigated — `ConvergenceResult.concessions` + `openDecision` and the integration per-addition verdicts carry rationale threaded for the 04-05 decision record (RSLV-01).

## Known Stubs

None. The convergence loop and integrator merge are fully implemented and exercised by tests. (The 04-03 `designateIntegrator = roster[0]` stub is now resolved: the integrator is the convergence-designated base author.)

## Threat Flags

None — no security surface beyond the planned threat register was introduced. The new disk read (round artifacts) uses gray-matter's default js-yaml SAFE load, like the 04-03 validation read.

## Self-Check: PASSED

- FOUND: src/protocol/converge.ts, test/converge.test.ts, test/integration.test.ts (created); src/schema/config.ts, src/protocol/engine.ts, test/protocol-engine.test.ts, test/protocol-run.e2e.test.ts, test/validation-retry.test.ts (modified).
- FOUND commits: efcfba0 (Task 1), a059ef6 (Task 2) — both in git log.
- Full suite 264/264, tsc clean, biome clean.
