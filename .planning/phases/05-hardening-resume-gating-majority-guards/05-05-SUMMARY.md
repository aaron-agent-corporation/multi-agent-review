---
phase: 05-hardening-resume-gating-majority-guards
plan: 05
subsystem: gating-vertical-slice
status: complete
tags: [gating, prot-05, rslv-03, ask-seam, pause-and-exit, arbitration, feedback, wave-3]
requires:
  - "src/protocol/engine.ts buildMachine/runProtocol/resumeProtocol (05-04) — gate hooks woven in"
  - "src/schema/manifest.ts paused-awaiting-approval + RESUMABLE_STATUSES (05-02) — pause status"
  - "src/protocol/engine.ts resumeProtocol (05-04) — pause-and-exit continuation (D-55)"
  - "src/schema/resolved-decisions.ts ResolvedDecisionEntry + Resolver (05-02) — human ruling shape"
  - "src/protocol/decision-record.ts yamlScalar injection-safe serializer (04-05) — mirrored for rulings"
  - "test/fixtures/structured-shared.mjs resolveEmitBody (05-02) — extended with prompt-echo"
provides:
  - "src/protocol/gating.ts — gate parser/prompt, feedback injector+writer, arbitration, human-ruling writer, defaultAsk"
  - "src/protocol/engine.ts Ask + GatingOptions types; ProtocolInput.gating; runProtocol/resumeProtocol gating param"
  - "engine paused final state + gate__<phase> transient states + arbitrate state (no-op in autonomous)"
  - "src/cli.ts ask() seam (setAsk/resetAsk) + resolveGating (isTTY-guarded) + --mode/--gated/--autonomous/--pause-and-exit"
  - "src/schema/config.ts defaults.mode (autonomous|gated, default autonomous)"
  - "MAR_ECHO_PROMPT_DIR fixture prompt-echo — proves feedback reaches only the next phase prompt"
affects:
  - "05-06 appends the human ruling to the resolved-decisions ledger (resolver:\"human\") — shape + on-disk location below"
  - "05-06 adds re-litigation enforcement at the SAME gate-hook boundaries documented below"
commits:
  - "3e210a6 feat(05-05): phase-boundary gate hooks + paused state + pause-and-exit + feedback injection + gated arbitration (PROT-05/RSLV-03, D-50/D-51/D-52)"
  - "9f2bed1 feat(05-05): run-start mode prompt (isTTY-guarded) + mode/pause flags + ask() seam + mode config default (PROT-05, D-53, Pitfall 5)"
  - "4c14126 test(05-05): gating tests via ask() seam (autonomous, approve/abort/feedback, arbitration, non-TTY, pause-and-exit) + prompt-echo fixture"
key-files:
  created:
    - "src/protocol/gating.ts"
    - "test/gating.test.ts"
    - "test/protocol-gating.e2e.test.ts"
  modified:
    - "src/protocol/engine.ts"
    - "src/cli.ts"
    - "src/schema/config.ts"
    - "test/fixtures/structured-shared.mjs"
deviations:
  - "Gate hooks modeled as ALWAYS-present transient states (gate__<phase> + arbitrate) that no-op in autonomous mode, rather than conditionally inserted. Keeps the machine structure mode-independent (the autonomous path is byte-for-byte unchanged: the gate actor resolves `approve` without prompting) and the gate decision a pure runtime concern read from context.input.gating. PATTERNS file #2 offered both transient-state and driver-loop models; the transient-state model composes with the existing terminal-branch + the `paused` final state cleanly."
  - "The interactive ask() seam is injected TWO ways: the engine's gate prompts take `ask` directly via GatingOptions (so engine tests need no cli seam), while cli.ts ALSO exposes module-level setAsk/resetAsk for the run-start mode prompt. The engine-level injection is what the hermetic gating.test.ts uses."
  - "Gated arbitration of a free-form ruling KEEPS the escalation fallback base (result.base) and records the human's text as the rationale; picking a side switches the base to that author's proposedBase. Both record resolver:\"human\". D-52 leaves the base policy to the planner; this is the minimal, auditable choice."
  - "resumeProtocol gained an optional gating param threaded through; a bare `mar resume` continues autonomously (the human approved by resuming), which is the prior-wave continuation contract. A re-paused resumed run again writes paused-awaiting-approval."
self-check: PASSED
metrics:
  duration: "~20 minutes"
  completed: "2026-06-05"
  tasks: 3
  tests_added: 16
  tests_total: 299
---

# Phase 05 Plan 05: Gating Vertical Slice (PROT-05 + gated RSLV-03) Summary

A per-run autonomous/gated choice (D-53) — resolved by an explicit flag, else a TTY run-start prompt,
else (non-TTY, no flag) the config default autonomous so a scripted `mar run` NEVER hangs (Pitfall 5).
Gated mode pauses at every phase boundary with a blocking approve/abort/feedback prompt (D-50/D-51),
or — with `--pause-and-exit` — writes `paused-awaiting-approval` at the first boundary and exits 0,
with continuation handed to `mar resume` (D-55). Feedback is a short human note injected into ONLY the
next phase's prompt (steering, not artifact editing). An escalated convergence in gated mode is
arbitrated by the human (pick a side or write a ruling), recorded as `resolver:"human"` with rationale
(D-52); autonomous escalation stays a logged open decision and never prompts (D-42 preserved). ALL
human interaction rides an injectable `ask()` seam, so every path is proven hermetically — no real TTY.

## What Was Built

### Task 1 — ask() seam + run-start mode prompt + mode/pause flags + mode config default (cli.ts, config.ts)
- `src/schema/config.ts`: added `mode: z.enum(["autonomous","gated"]).default("autonomous")` INSIDE the
  `.prefault({})` defaults block (alongside `convergenceCap`), so a config without `mode` parses to
  autonomous (the nested default fires because prefault re-parses — the zod v4 rule the file documents).
- `src/cli.ts`: a module-level injectable `ask()` seam (`let askImpl: Ask = defaultAsk`) with exported
  `setAsk(fn)` / `resetAsk()` (mirroring the numEnv test-seam spirit); `defaultAsk` lives in gating.ts
  and uses `node:readline/promises` (NO new dependency). Registered `--mode <gated|autonomous>`,
  `--gated`, `--autonomous`, `--pause-and-exit` on the `run` command. `resolveGating(opts, configMode)`:
  an explicit flag WINS and skips the prompt (both TTY and non-TTY); else if `process.stdin.isTTY` it
  prompts once via `askImpl`; else it defaults to the config mode and NEVER calls ask (Pitfall 5 /
  T-05-15). `runRun` threads the resolved `{ mode, pauseAndExit, ask }` into `runProtocol`. cli.ts
  stays thin — no gate logic, only mode resolution + seam injection.

### Task 2 — gate hooks + paused state + pause-and-exit + feedback + gated arbitration (engine.ts, gating.ts)
- `src/protocol/engine.ts`: new exported `Ask` + `GatingOptions` types; `ProtocolInput.gating?`.
  `runPhase`/`runPhaseGated` take an optional `feedback` string that, when present, is prepended to the
  thin prompt via `injectFeedback` (the thin prompt below the note is unchanged — thin-prompt contract
  preserved, T-05-14). The machine gained, for each non-last phase, an ALWAYS-present transient
  `gate__<phase>` state that invokes a `gateActor`; the actor is a no-op in autonomous mode (resolves
  `approve`, no prompt — autonomous is byte-for-byte unchanged), and in gated mode either runs the
  blocking prompt or, with `pauseAndExit`, returns `pause`. Gate outcomes route: approve → the phase's
  REAL next (draft→promote→review preserved); pause → a NEW `paused` final state; feedback → assign the
  note to `context.feedback` + continue (the next phase consumes it, then the phase's `onDone` survivors
  action CLEARS it so it steers exactly one phase); abort → `failed` with an `aborted by human` cause.
  The evaluation phase now routes convergence → a transient `arbitrate` state → `gate__evaluation` →
  integration; the `arbitrate` actor is a no-op unless gated AND escalated, in which case it records the
  human ruling and returns an updated `ConvergenceResult` (status `agreed`, resolver `human`, arbitrated
  base, openDecision cleared). `runProtocol`/`resumeProtocol` accept gating and handle the `paused`
  final state: `setStatus(runDir, "paused-awaiting-approval")` + return 0 (no decision record yet).
- `src/protocol/gating.ts` (NEW): `parseGateAnswer` (forgiving leading-token parser; unrecognized → a
  feedback note, never a blind approve/abort); `runGate` (blocking prompt, empty-note re-ask→approve
  fallback); `writeGateFeedback` (auditable `gate-feedback/<phase>.md` with attribution+timestamp);
  `injectFeedback`; `readFinalPositions` (each agent's last-round proposedBase + remaining
  disagreements + citations, filesystem-as-truth); `runArbitration` (pick-a-side or free-form ruling);
  `arbitrationLedgerEntry` (the `resolver:"human"` ResolvedDecisionEntry); `writeHumanRuling`
  (`human-ruling.md` via the injection-safe scalar serializer mirrored from decision-record.ts —
  human prose is attacker-influenceable, T-05-16, never string-concatenated into YAML); `defaultAsk`.

### Task 3 — gating tests via the ask() seam + prompt-echo fixture (gating.test.ts, protocol-gating.e2e.test.ts, structured-shared.mjs)
- `test/gating.test.ts` (10 tests, in-process via the engine's `GatingOptions.ask`): parseGateAnswer +
  injectFeedback units; autonomous completes 6 phases and NEVER calls ask; gated approve completes;
  gated abort at boundary 2 → exit 1, status `failed`, "aborted by human", NO response/integration
  artifacts; gated feedback → the unique note reaches ONLY the `[phase:review]` prompt (asserted via the
  echo log) and is written to `gate-feedback/review.md` but into NO indexed artifact; arbitration
  ledger-entry unit; gated escalation (cap=1, 1-1 split) invokes ask, records `resolver:"human"` +
  rationale in `human-ruling.md`; autonomous escalation logs the open decision (status `escalated`) and
  NEVER prompts.
- `test/protocol-gating.e2e.test.ts` (3 tests, execa-via-tsx): `--autonomous` drives all 6 phases with
  `stdin:"ignore"`, never prints the mode prompt; a bare `mar run` (no flag, `stdin:"ignore"`) defaults
  autonomous and completes (Pitfall 5); `--gated --pause-and-exit` writes `paused-awaiting-approval` +
  exits 0 with only draft artifacts, then `mar resume --last` completes it to `completed` with a
  decision record.
- `test/fixtures/structured-shared.mjs`: `maybeEchoPrompt(author, args)` (no-op unless
  `MAR_ECHO_PROMPT_DIR` set) appends ONE flattened line per invocation to `<dir>/<author>.log`; called
  from `resolveEmitBody` so all three fixtures stay byte-aligned. Lets the feedback test prove the note
  reached exactly the next phase's prompt and no other.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | mode config default + ask seam + mode/pause flags + run-start prompt | 9f2bed1 | src/cli.ts, src/schema/config.ts |
| 2 | gate hooks + paused state + pause-and-exit + feedback + arbitration | 3e210a6 | src/protocol/engine.ts, src/protocol/gating.ts |
| 3 | gating tests via ask() seam + prompt-echo fixture | 4c14126 | test/gating.test.ts, test/protocol-gating.e2e.test.ts, test/fixtures/structured-shared.mjs |

(Commit order is Task 2 before Task 1 in git log so each commit compiles — cli.ts imports the engine's
gating types + gating.ts; engine.ts is self-contained.)

## Exported Signatures (for 05-06)

```ts
// src/protocol/engine.ts
export type Ask = (question: string) => Promise<string>;
export interface GatingOptions { mode: "autonomous" | "gated"; pauseAndExit: boolean; ask?: Ask; }
// ProtocolInput gained `gating?: GatingOptions`
export function runProtocol(runDir, config, inputPath, gating?: GatingOptions): Promise<number>;
export function resumeProtocol(runDir, config, gating?: GatingOptions): Promise<number>;

// src/protocol/gating.ts
export function arbitrationLedgerEntry(result: ConvergenceResult, outcome: { base; rationale }): ResolvedDecisionEntry;
export async function writeHumanRuling(runDir, entry: ResolvedDecisionEntry): Promise<string>; // → "human-ruling.md"
export async function readHumanRuling(runDir): Promise<string | null>;
// + parseGateAnswer, runGate, writeGateFeedback, injectFeedback, readFinalPositions, runArbitration, defaultAsk

// src/cli.ts (test seam)
export function setAsk(fn: Ask): Ask;  export function resetAsk(): void;
```

## NOTES FOR 05-06 (explicitly requested)

**Where the human ruling is stored and its shape.** A gated arbitration writes `runs/<id>/human-ruling.md`
via `writeHumanRuling` (gating.ts). Its frontmatter IS a `ResolvedDecisionEntry` (the 05-02 ledger
schema) serialized through the injection-safe scalar serializer:
```yaml
---
id: "arbitration-<rounds>"
summary: "human arbitrated escalated convergence → base \"<base>\""
rationale: "<the human's free-form ruling OR \"human picked <author>'s position ...\">"
lineage:
  - "escalation: <openDecision.reason>"
resolver: "human"
---
```
`arbitrationLedgerEntry(result, outcome)` produces exactly this entry object in memory — 05-06 should
call it (or read `human-ruling.md`) and APPEND it to the rolling `shared/resolved-decisions.md` ledger
with `resolver:"human"`. The rationale is attacker-influenceable prose: keep routing it through the
hand-rolled scalar serializer (`yamlScalar`), never `matter.stringify` (T-05-16).

**The gate-hook insertion point in the engine (where 05-06 adds enforcement).** The boundaries are the
ALWAYS-present transient states built in `buildMachine` (engine.ts): one `gate__<phase>` state per
non-last phase, plus the `arbitrate` state between evaluation and `gate__evaluation`. These are the
exact phase-boundary seams; 05-06's re-litigation enforcement belongs at the SAME boundaries — either
as additional logic in the gate actor (`runGateBoundary`) / arbitration actor (`runArbitrationBoundary`),
or as a peer transient check before each phase fan-out. The feedback/ruling already flow through these
hooks, so enforcement reads the same `context.input.gating` + the ledger written by this slice.

## Verification

- Per-task: named vitest files green after each commit; `npx tsc --noEmit` clean after each task.
- Full suite: `npm test` → **299 passed (38 files)** — 283 (05-04 baseline) + 16 new (10 gating
  unit/in-process + 3 gating e2e + 3 carried). No regressions; autonomous path unchanged.
- `npx tsc --noEmit`: clean.
- `npx biome check`: only the ONE PRE-EXISTING finding (`engine.ts:269` `phase.validate!`
  noNonNullAssertion, owned by 04-05) — nothing new introduced.
- Autonomous unchanged proof: protocol-run.e2e (2-vendor + 3-vendor + <2-vendor refusal) all green;
  the gated/autonomous in-process tests assert `ask` is NEVER called in autonomous mode.

## Deviations from Plan

- **Gate hooks are always-present no-op transient states**, not conditionally inserted — the autonomous
  path is byte-for-byte unchanged (gate actor resolves `approve` without prompting) and the gate
  decision is a pure runtime read of `context.input.gating`.
- **Two injection points for ask()**: engine gate prompts take `ask` via `GatingOptions` (what the
  hermetic engine tests use); cli.ts also exposes `setAsk/resetAsk` for the run-start mode prompt.
- **Free-form arbitration keeps the escalation fallback base**; picking a side switches to that author's
  proposedBase. Both record `resolver:"human"`.
- **resumeProtocol accepts an optional gating param**; a bare `mar resume` continues autonomously.

## Self-Check: PASSED

`src/protocol/gating.ts`, `test/gating.test.ts`, `test/protocol-gating.e2e.test.ts` exist on disk; all
3 task commits (3e210a6, 9f2bed1, 4c14126) verified in git log; full suite 299 green; tsc clean; only
the pre-existing biome finding remains; no STATE.md/ROADMAP.md modifications.
