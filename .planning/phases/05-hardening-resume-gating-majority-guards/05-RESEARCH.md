---
phase: 05-hardening-resume-gating-majority-guards
date: 2026-06-05
status: complete
researcher: gsd-phase-researcher
requirements: [PROT-05, PROT-06, RSLV-02, RSLV-03, RCRD-02]
---

# Phase 5 Research: Hardening — Resume, Gating, Majority, Guards

## Summary

Phase 5 hardens the working 6-phase engine (Phase 4 shipped, decision record + live 3-vendor
checkpoint APPROVED) along five axes plus two carry-over fixes. The dominant architectural finding:
**every one of D-50's, D-56's and the resume path's needs is already 90% served by existing, on-disk,
re-derivable state** — the manifest is authoritative (D-14), per-round evaluation artifacts already
persist `proposedBase`, and the convergence loop already tallies bases (`tallyBases`/`mostSupportedBase`
in `converge.ts`). This phase is mostly *new wiring around existing primitives*, not new subsystems.

The single highest-leverage decision is **re-derivation over XState actor-snapshot persistence**
(D-14 favors it, the machine structure supports it cleanly, and snapshot-restore-into-invoked-actors
is the documented XState v5 footgun). Resume = read manifest → find last completed phase → rebuild the
machine with `initial` set to the resume phase and `context.roster` rehydrated → run forward. No
`getPersistedSnapshot`.

The re-litigation guard (RCRD-02) is the most genuinely new code: a rolling `shared/resolved-decisions.md`
artifact appended as forks settle, read by agents as a peer artifact, with a compact digest cited from
the (seeded) instruction file — keeping per-turn prompts thin (D-37).

Two carry-overs are small but must be planned as explicit tasks: the dist `.tmpl` copy (one build-script
line) and the claude `--bare` design call (recommendation below: **status quo + explicit Read**, not
`--bare`).

---

## Key Findings (per research question)

### Q1 — XState pause/resume: re-derivation, not snapshot persistence

**Finding: re-derivation from the manifest is workable and is the right call.** The engine machine is
built fresh every run by `buildMachine()` (engine.ts:475–616). Its only persistent inputs are
`{ runDir, config, inputPath }` (the machine `input`) and the derived `context.roster`
(engine.ts:613: `context: ({ input }) => ({ input, roster: input.config.agents })`). Crucially:

- The machine is **constructed programmatically** from `PHASES` with `initial: PHASES[0].name`
  (engine.ts:611) and a `states` record keyed by phase name (engine.ts:498–605). To resume at phase N,
  set `initial` to the resume phase's name and start a fresh actor. **No new state graph is needed.**
- All actor inputs are pulled from `context` at invoke time (e.g. engine.ts:545–552, 515–518) — they are
  not closed-over machine-construction values. So a re-entered machine fans out over whatever roster
  context carries.
- Per-phase state derives entirely from disk: `runPhase` re-reads the manifest at entry
  (engine.ts:74–80) and `nextSeq` is monotonic over manifest paths + on-disk names (engine.ts:75–80),
  so re-running a phase appends new artifacts without clobbering prior ones.

**Why NOT `getPersistedSnapshot`/restore:** (a) D-14 mandates disk-derivable state and explicitly
disfavors in-memory persistence; (b) XState v5's documented restore limitation — `createActor(machine,
{ snapshot })` does **not** automatically restart `invoke`d/`spawn`ed child actors that were mid-flight
at snapshot time (the `fromPromise` phase actors here). A snapshot taken mid-phase would restore the
parent in an "invoking" state with a dead child promise → silent hang. Re-derivation sidesteps this
entirely: D-54 already says the interrupted phase re-runs from its start and convergence restarts at
round 1, so there is never a mid-actor state to restore.

**Concrete approach (decision-ready):**
1. `readManifest(runDir)` → enumerate artifact `kind`s present.
2. Map kinds → completed phases. A phase is "completed" iff its required artifacts pass the same gate
   logic `runPhaseGated` uses (`requiredArtifactsExist` + expected count) for the *recorded* surviving
   roster. The resume phase = the first phase in `PHASES` order that is NOT fully satisfied.
   (Evaluation completeness is special — see Q4; treat evaluation as incomplete unless a
   `convergence`-derived integrator can be reconstructed, simplest: re-run convergence from round 1 per
   D-54.)
3. Rehydrate `context.roster` to the *surviving* roster: `config.agents` minus `manifest.droppedAgents`
   — EXCEPT per D-57, on a `failed` run resume restores the FULL original roster (dropped agents get
   another chance). So the roster source differs by resume reason: paused/interrupted → survivors;
   failed → full config roster.
4. Rebuild the machine with `initial` = resume phase; start actor; `toPromise`.

**Pitfall flagged below (Pitfall 1):** the `draft → promote → review` transient state. If resume lands
on `review`, `promoteDrafts` already ran (shared/ holds promoted drafts) — re-entering at `review`
directly is correct and must NOT re-run `promote`. If resume lands on `draft`, the normal
`draft → promote → review` chain applies. Make the resume entry point a *phase name*, and the existing
`next` wiring handles promote correctly because `draft`'s `next` is `"promote"` (engine.ts:502).

### Q2 — Interactive TTY prompting from commander (D-50/D-53)

**Finding: use `node:readline/promises` — no new dependency.** Node 22 ships
`readline/promises`'s `createInterface(...).question()` returning a Promise, which is exactly the
blocking-prompt primitive both gates need (run-start mode prompt D-53, phase-boundary gate D-50). This
honors the minimal-dependency convention (D-35 precedent; stack already avoids p-limit, hand-rolls YAML
serialization). `@inquirer/prompts`/`prompts` add a dependency + the package-legitimacy checkpoint for
no material gain at this prompt complexity (three options: approve/abort/feedback; two options:
gated/autonomous).

**Non-TTY bypass (D-53, REQUIRED):** guard every interactive prompt with `process.stdin.isTTY`. When
false (piped/scripted/CI), do NOT call `question()` — instead require an explicit flag and fail-closed
if absent. Recommended flag surface (Claude's discretion per D-50/D-53):
- `mar run <input> --mode <gated|autonomous>` — explicit mode, skips the D-53 prompt.
- `mar run <input> --gated` / `--autonomous` — sugar; document `--gated` implies blocking prompts.
- `mar run <input> --gated --pause-and-exit` — D-50 pause-and-exit path (writes
  `paused-awaiting-approval` and exits 0 rather than blocking).
- No flag + TTY → interactive D-53 prompt. No flag + non-TTY → **default autonomous** (a bare scripted
  `mar run` must never hang — D-53 explicit requirement). Note: defaulting non-TTY to autonomous is
  safer than erroring, matching "scripted contexts need a deterministic bypass."

**Testability:** `isTTY` is settable in tests; fixtures drive non-TTY paths directly. The blocking
prompt itself is tested by feeding a child process's stdin (the e2e harness already spawns `mar` via
execa — pass `input:` to execa to answer prompts) OR by extracting the prompt logic behind a small
injectable `ask()` seam so unit tests stub it. Prefer the seam (`ask: (q) => Promise<string>`) so
hermetic tests never depend on real TTY behavior.

### Q3 — Resume re-validation mechanics (D-56)

**Finding: the wrapped-artifact reader already exists and must be reused verbatim.** Resume re-validates
completed-phase artifacts' AGENT frontmatter. The on-disk `.md` has the **engine-metadata wrapper
first**, the agent frontmatter second (writeArtifact prepends `runId/phase/agent/seq/...`). The correct
read is the established **double-parse**: `matter(file)` strips the wrapper, then
`matter(outer.content.trimStart())` parses the agent frontmatter. This pattern lives in three places
already and is the canonical reference:
- `converge.ts:82–102` (`readEvaluationSignal`) — note the explicit `.trimStart()` (the wrapper body
  starts with `\n${text}`; gray-matter only recognizes frontmatter at position 0).
- `decision-record.ts:100–110` (`readAgentFrontmatter`).
- The engine's live validation gate (engine.ts:198–206) uses the *tolerant* variant (`parseFront`):
  direct parse, else fall back to the FIRST `---` delimiter line — added in the 04-05 checkpoint because
  models emit preamble prose.

**Recommendation:** resume re-validation should use the **tolerant `parseFront` reader** (first-`---`
fallback), not the strict double-parse, because completed artifacts on disk were written by live models
and may carry preamble. Extract `parseFront` from engine.ts into a shared `readAgentFrontmatter`
utility (e.g. `src/workspace/artifacts.ts` or a new `src/protocol/frontmatter.ts`) so the gate,
converge, decision-record, and the new resume path share ONE reader — eliminating the current three
near-duplicate copies and the strict-vs-tolerant divergence (a latent bug: decision-record/converge use
the strict double-parse and would silently drop a preamble-prefixed artifact that the live gate accepted).

D-56's full re-validation set: (1) manifest integrity (`readManifest` → `Manifest.parse`, already
fail-closed); (2) every completed phase's artifacts exist (`isDone`) AND agent frontmatter re-validates
against the 04-01 zod schema for that kind; (3) roster preflight (`runPreflight` from preflight.ts,
the D-26/27 reuse — auth decay was observed live with gemini). Refuse with a specific error naming
exactly what broke (missing artifact path / failed schema / preflight failure per agent).

### Q4 — Majority tally mechanics (D-58/D-59)

**Finding: the tally primitives already exist in converge.ts and the tie-break insert point is exact.**
- `tallyBases(signals)` (converge.ts:119–123) already counts `proposedBase` per round off disk.
- `mostSupportedBase(signals)` (converge.ts:126–136) already picks the plurality base.
- Signals are read via `collectRoundSignals` (converge.ts:110–116) from the validated `proposedBase`
  field — no new collection step, no ballot artifact (D-58 satisfied as-is).

**The tie-break insert point (D-59):** the majority decision must fire **after cap/deadlock detection
but before escalation**. Today both Guard 2 (cap, converge.ts:222–229) and Guard 3 (deadlock,
converge.ts:242–249) call `escalate(...)` directly. The change: before `escalate`, compute the tally
and check for a **clear majority** over the *current surviving roster*. Define "clear majority" as
`> half the surviving agents propose the same base` (e.g. 2-of-3). If a clear majority exists →
return `{ status: "agreed", base: majorityBase, integrator: integratorFor(majorityBase, signals),
resolver: "majority" }` (note the new `resolver` field, D-61). If no clear majority → `escalate(...)`
as today (D-59/D-60). **2-vendor 1-1 is not a clear majority** (1 is not > half of 2) → escalates, exactly
D-60.

**Important nuance:** `mostSupportedBase` returns the plurality even on a tie (it takes the first base
to reach the max count — converge.ts:128–135). For the majority test you must check `bestCount > n/2`,
NOT just "a most-supported base exists." Add a `clearMajority(signals, rosterSize)` helper that returns
`base | null`. The fallback-base path (`escalate`) keeps using `mostSupportedBase` unchanged.

**D-59 anti-anchoring constraint (do not violate):** the running tally is NOT injected into evaluation
rounds. The tally is computed only at the exit boundary (post-cap/deadlock), never fed back into a
round's prompt. The current loop already never injects the tally — preserve that.

### Q5 — Re-litigation guard (RCRD-02, D-62..D-65)

**Finding: this is the one substantially-new artifact; design it as a rolling shared peer artifact.**

D-63 specifies `runs/<id>/shared/resolved-decisions.md`, gray-matter format, appended as forks settle,
readable by agents like any peer artifact, and the source the terminal decision-record assembles FROM.
Today `decision-record.ts` assembles directly from the artifact trail at run end; D-63 inverts this so
the rolling file is the running ledger and the terminal record reads from it.

**Inject + enforce (D-62) — two halves:**
1. **Inject (digest):** a compact digest — *decision + one-line rationale + what resolved it* per
   settled fork (D-65) — surfaced to later phases. Per the thin-prompt convention (D-37), the digest
   must NOT be stuffed into per-turn prompts. **Recommendation:** the seeded instruction file
   (`agent-instructions.md.tmpl`, rendered per vendor into the scoped cwd) gains a section directing
   agents to read `shared/resolved-decisions.md` before proposing changes, and the rolling file IS the
   digest (its frontmatter holds the machine-readable settled decisions, its body the one-line
   rationales). This keeps prompts thin AND gives agents the digest as a peer artifact they read — the
   D-63 "agents can read it like any peer artifact; the prompt digest cites it" model. NOTE: the seeded
   instruction file is currently copied into the *scoped draft cwd only* (scope.ts:53–67); later phases
   run non-scoped in the run dir (engine.ts:119–122). So either (a) seed instruction files into the run
   dir for all phases too, or (b) rely on `shared/resolved-decisions.md` being in the shared workspace
   that non-scoped phases read. Option (b) is cleaner and matches D-63: the file lives in `shared/`,
   which every non-scoped phase's cwd (runDir) can reach, and the format contract (seeded file)
   instructs agents to read it.
2. **Enforce (post-hoc):** generalize the existing 04-03 integrator drop. The decision-record writer
   already treats integration `dropped` additions as `conflicts-with-resolved` contested resolutions
   (decision-record.ts:183–209). D-64 says a re-litigating position is dropped with a logged
   `re-litigation` reason, the run continues, the record notes the violation. The enforcement check:
   when a later-phase artifact reopens a decision present in `resolved-decisions.md`, drop that position
   and append a `re-litigation` reason. This needs a comparison key (decision `id`) shared between the
   rolling file and the new artifacts.

**When each fork type settles (append triggers, D-63):**
- Response verdicts (`reject-with-reason`/`refine`) → append after the response phase.
- Convergence concessions → append as the loop concedes (or after evaluation completes — simplest:
  after the convergence actor resolves, append all concessions at once).
- Integrator calls (`dropped`/`merged-with-change`) → append after integration.
- Human rulings (D-52, gated arbitration) → append when the human resolves an escalation.

**Schema:** new `src/schema/resolved-decisions.ts` zod schema (gray-matter frontmatter), mirroring
`decision-record.ts`'s `ResolvedDecision` shape plus the `resolver` field (D-61: `convergence | majority
| integrator | human`). The terminal decision-record then reads this file instead of (or in addition to)
re-deriving from the trail. **Reuse the injection-safe hand-rolled YAML serializer** from
decision-record.ts (yamlScalar/serializeFrontmatter, lines 34–88) — gray-matter stays READ-only (T-04-07).

### Q6 — Phase-4 carry-over fixes

**(a) Dist packaging (`.tmpl` not copied to dist/):** `instructions.ts:22` resolves the template via
`new URL("../templates/agent-instructions.md.tmpl", import.meta.url)`, i.e. relative to the compiled
module at `dist/protocol/instructions.js` → expects `dist/templates/agent-instructions.md.tmpl`. `tsc`
(build script, package.json:16) only emits `.js`/`.d.ts`/`.map` and does not copy non-TS assets, so the
compiled `mar` ENOENTs at draft fan-out (confirmed: `dist/` does not exist yet; only `src/templates/`
has the file).
  **Recommendation: add a copy step to the build script** — `"build": "tsc && cp -R src/templates
  dist/templates"` (or a tiny `node`/`fs-extra` copy script for cross-platform safety; `cpSync` from
  `node:fs` is portable: `"build": "tsc && node -e \"require('fs').cpSync('src/templates','dist/templates',{recursive:true})\""`).
  Also add `"files": ["dist"]` to package.json so the template ships in the npm tarball. Rejected
  alternatives: embedding the template as a TS string (loses the single-file source-of-truth + makes the
  contract harder to read/edit); a bundler (overkill, new dep). The copy step is the minimal,
  convention-consistent fix. **Add a test that the built dist contains the .tmpl** (or that `seedInstructions`
  resolves against a dist-layout fixture) so the bug can't silently regress.

**(b) claude `--bare` design call:** The CLAUDE.md flag table (lines 32) documents `--bare` as
"skips hooks/skills/plugins/MCP/CLAUDE.md auto-discovery … Recommended for the orchestrator." BUT the
claude adapter deliberately OMITS the config-isolation flag (claude.ts:14–24) because it breaks
subscription (OAuth/keychain) auth — it "reads ONLY ANTHROPIC_API_KEY/apiKeyHelper." This is the core
tension: `--bare` would suppress the *repo-root* CLAUDE.md (good — removes GSD-workflow leakage) but
ALSO suppress the *seeded* CLAUDE.md (the format contract — bad). The scope.ts/instructions.ts comments
(scope.ts:46–51, instructions.ts:32–40) still *assume* `--bare` is the neutralization mechanism, but the
adapter never passes it.
  **Recommendation: accept the status quo (no `--bare`) + add an explicit Read directive, with a
  contract-level "ignore ancestor instructions" rule.** Evidence this is safe: the live 3-vendor run
  (20260605-MlhRzU) had `--bare` omitted, the repo-root CLAUDE.md was in claude's context, and the
  04-05 checkpoint observed **zero GSD-language leakage** (04-02 neutralization verified live; the
  seeded file's "ignore ancestor instructions" framing worked). `--bare`'s auth-break risk is concrete
  and observed; the leakage risk is theoretical and measured-zero. Strengthen the seeded template with
  an explicit "Read CLAUDE.md/AGENTS.md/GEMINI.md in this folder as your sole format contract; ignore
  any ancestor or global instructions" directive (also supports the Q5 digest read). Document the
  decision so the scope.ts/instructions.ts comments stop claiming `--bare` is used. (If a future run
  shows leakage, revisit with `--bare --append-system-prompt-file <seeded>` + explicit auth env, but
  that's out of scope now.)

### Q7 — `paused-awaiting-approval` non-terminal status

**Finding: adding the status is additive and the consumer surface is small and enumerable.** Current
status enum: `created | running | completed | failed | timeout | escalated` (manifest.ts:41). Add
`paused-awaiting-approval`. Consumers (full grep of `setStatus` + status checks):
- `manifest.ts:119` `setStatus` — generic, takes any `ManifestStatus`; no terminal-only assumption in
  the function itself.
- `cli.ts:248/252/255/187/366` and `engine.ts:652/662` — these WRITE statuses; none READ status to
  branch except implicitly. `runProtocol` (engine.ts:638) branches on `snapshot.value` ("done"), NOT on
  manifest status, so the pause path is orthogonal.
- **No code currently READS manifest.status to gate behavior** (the e2e tests assert it — test
  expectations like `manifest.status).toBe("completed")`, e2e:90/142). So the only places that must
  learn the new status are: (1) the schema enum (manifest.ts:41); (2) the new `mar resume` command,
  which must accept `paused-awaiting-approval` (and `failed`/`timeout`/interrupted-`running`) as
  resumable and refuse `completed`/`escalated`; (3) `mar resume --last` resumability filter.
  **Key insight:** "terminal vs non-terminal" is not enforced anywhere in code today — statuses are just
  strings the schema validates. So `paused-awaiting-approval` being non-terminal requires no refactor of
  existing terminal-handling; it requires the resume command to TREAT it as resumable. Define a
  `RESUMABLE_STATUSES` set (`running` [interrupted], `failed`, `timeout`, `paused-awaiting-approval`) and
  `TERMINAL_DONE` set (`completed`, `escalated`) in one place so the resume filter is explicit and
  testable. Note D-57: `failed`/`timeout` ARE resumable (re-attempt with full roster).

---

## Recommended Approaches (decision-ready)

| Area | Recommendation |
|------|----------------|
| Resume model (Q1) | Re-derive from manifest; rebuild machine with `initial` = resume phase. No XState snapshot persistence. |
| Resume roster (Q1/D-57) | Paused/interrupted → survivors (config minus droppedAgents); `failed`/`timeout` → full original roster. |
| TTY prompting (Q2) | `node:readline/promises`, behind an injectable `ask()` seam. No new dep. |
| Non-TTY bypass (Q2/D-53) | `--mode`/`--gated`/`--autonomous` flags; non-TTY + no flag → default autonomous (never hang). |
| Pause-and-exit (D-50) | `--pause-and-exit` writes `paused-awaiting-approval`, exits 0. `mar resume` continues. |
| Frontmatter reader (Q3) | Extract the tolerant `parseFront` into ONE shared util; replace the 3 duplicate strict double-parses. |
| Resume re-validation (D-56) | manifest.parse + per-artifact schema re-validate (tolerant reader) + `runPreflight`. Specific refusal errors. |
| Majority tie-break (Q4) | New `clearMajority(signals, rosterSize)` (`bestCount > size/2`); insert before `escalate` in both cap & deadlock guards. |
| `resolver` field (D-61) | Additive to ConvergenceResult + ResolvedDecision schemas: `convergence \| majority \| integrator \| human`. |
| Re-litigation guard (Q5) | Rolling `shared/resolved-decisions.md` (new zod schema, injection-safe writer); seeded-file directs agents to read it; enforce = generalize the integrator drop with a `re-litigation` reason. |
| Decision record (D-63) | Terminal record reads FROM resolved-decisions.md (inverts current assemble-from-trail). |
| dist .tmpl (Q6a) | `tsc && cpSync('src/templates','dist/templates')` + `"files": ["dist"]` + a guard test. |
| claude --bare (Q6b) | Accept status quo (no --bare); strengthen seeded "ignore ancestors" + explicit Read directive; fix the stale comments. |
| `paused-awaiting-approval` (Q7) | Add to enum; define RESUMABLE/TERMINAL_DONE sets in one place; only `mar resume` reads them. |

---

## Pitfalls (numbered; detection + avoidance)

1. **Re-entering the `promote` transient on resume.** If resume targets `review`, `promoteDrafts`
   already ran; re-running it is harmless (idempotent copy) but re-running `draft` would re-fan-out
   drafts. *Avoid:* make resume entry a phase NAME and let the existing `next` wiring
   (draft→promote→review) run only when resuming at `draft`. *Detect:* test resume-at-review asserts no
   new draft artifacts written.

2. **Snapshot-restore into a mid-flight `fromPromise` actor (the XState v5 footgun).** If anyone reaches
   for `getPersistedSnapshot`/restore, a snapshot captured mid-phase restores the parent "invoking" with
   a dead child → hang. *Avoid:* re-derivation only (D-14/D-54). *Detect:* there is no snapshot API in
   the resume path — code review gate.

3. **`mostSupportedBase` ≠ majority.** It returns the plurality even on a 1-1 tie (first-to-max). Using
   it for the D-59 tie-break would wrongly "resolve" a 1-1 deadlock. *Avoid:* separate
   `clearMajority` (`> size/2`) from `mostSupportedBase` (fallback only). *Detect:* a 2-vendor 1-1
   fixture must still escalate (D-60), and a 3-vendor 2-1 must resolve via `resolver: "majority"`.

4. **Strict vs tolerant frontmatter reader divergence.** converge.ts/decision-record.ts use the strict
   double-parse; the live gate uses the tolerant first-`---` fallback. A preamble-prefixed completed
   artifact passes the live gate but the strict reader returns null (silently dropped from tally/record).
   Resume re-validation inheriting the strict reader would wrongly refuse valid runs. *Avoid:* one shared
   tolerant reader. *Detect:* a fixture artifact with leading preamble must re-validate on resume AND
   contribute to the decision record.

5. **Blocking prompt hangs a scripted run.** A bare `mar run` in CI must never wait on TTY. *Avoid:*
   `process.stdin.isTTY` guard + default-autonomous on non-TTY. *Detect:* a non-TTY e2e (`stdin:'ignore'`)
   completes without hanging and without prompting.

6. **`paused-awaiting-approval` mistaken as terminal by future readers.** No code reads status today,
   but a future `mar status`/filter could treat it as done. *Avoid:* the explicit RESUMABLE set is the
   single source. *Detect:* `mar resume --last` selects a paused run; `mar resume` refuses a `completed`
   run.

7. **resolved-decisions.md concurrent append race.** Multiple agents settle forks; appends are
   read-modify-write like the manifest. *Avoid:* route appends through a `serializeWrite`-style per-runDir
   chain (manifest.ts:33–49 idiom) or write only at sequential phase boundaries (engine drives phases
   sequentially — the safer option). *Detect:* a test that two settled forks in the same phase both land.

8. **Digest bloat / thin-prompt violation (D-37/D-65).** Tempting to inline the full resolved set into
   prompts. *Avoid:* digest = one line per fork in the shared file; prompts only reference it. *Detect:*
   a test asserts per-turn prompts still carry no decision content (extend the existing
   protocol-gate.test "thin prompt" assertion at protocol-gate.test.ts:47).

9. **dist .tmpl regression invisible in dev.** `npm run dev` (tsx from source) always finds the
   template; only the built binary breaks — exactly why this shipped unnoticed. *Avoid:* a test
   exercising the dist layout (or the build + ENOENT-free seed). *Detect:* CI runs `npm run build` then a
   seed smoke.

10. **Failed-run resume re-litigating with the full roster (D-57) without restoring full context.** D-57
    restores the FULL roster, but the surviving-roster artifacts from completed phases were written by
    fewer agents. Re-attempting the failed phase with more agents than completed prior phases is
    intentional (dropped agents rejoin) — but the gate's expected-count must reflect the *resumed* roster,
    not the original-completed one. *Avoid:* recompute expected counts from the live resumed roster (the
    engine already does this — `expectedParticipantCount(phase, survivors)`). *Detect:* a failed-run
    resume fixture where a previously-dropped agent rejoins and the re-run phase expects the larger count.

---

## Validation Architecture (hermetic test strategy per requirement)

All testable on fake-CLI fixtures (D-49). Fixture extensions needed are noted per feature.

- **PROT-05 (gated/autonomous mode).**
  - *Autonomous:* `mar run --autonomous` (or non-TTY default) drives all 6 phases unattended → status
    `completed` (existing e2e, add `--autonomous`).
  - *Gated blocking:* inject an `ask()` seam stub that returns `approve` at each boundary → run completes;
    a stub returning `abort` at boundary 2 → run stops, no phase-3 artifacts, status reflects abort.
  - *Feedback (D-51):* `ask()` returns a feedback note → assert the note reaches the NEXT phase's prompt
    (the prompt is composed in `runPhase` engine.ts:113; thread an optional `feedback` through
    `ProtocolInput`/phase ctx). Fixture: assert via a fixture that echoes its received prompt.
  - *Non-TTY bypass (D-53):* spawn `mar run` with `stdin:'ignore'`, no mode flag → completes autonomous,
    never prompts. *Fixture extension:* none (existing structured fixtures suffice); the `ask` seam stub
    is test-only.

- **PROT-06 (resume).**
  - Build a run on disk to phase N (drive the engine, then truncate: delete phase N+1.. artifacts and
    set status `running`/`failed`/`paused-awaiting-approval`). `mar resume <id>` → completes from N+1;
    assert no phase ≤N artifacts were rewritten (seq monotonicity) and a `decision-record.md` lands.
  - `mar resume --last` selects the most-recent resumable run.
  - D-56 refusals: corrupt one completed-phase artifact's frontmatter → resume refuses with a specific
    error naming it; remove a required artifact → refuse; make preflight fail (fixture bin returns
    non-zero `--version` / unauth) → refuse naming the agent.
  - D-57: a `failed` run resumes with the FULL roster — fixture where a dropped agent (forced fail in the
    original run via `--emit-malformed`) succeeds on resume and the re-run phase expects the larger count.
  - *Fixture extension:* an env/flag to make a fixture fail on the first run and succeed on resume
    (e.g. honor a marker file the test creates between runs, or a `MAR_FAIL_ONCE` env toggled by the test).

- **RSLV-02 (majority).**
  - 3-vendor fixtures with *divergent* `proposedBase` (extend `structured-shared.mjs` so each fixture can
    emit a DIFFERENT base — today `MAR_EMIT_BASE` forces one shared base; add a per-author base map, e.g.
    `MAR_EMIT_BASE_<author>` or a JSON env). Drive convergence to cap/deadlock with a 2-1 split → assert
    the loop exits `agreed` via `resolver: "majority"` on the 2-base. 1-1-1 three-way split → no clear
    majority → escalate.
  - 2-vendor 1-1 → escalate (D-60) — assert `openDecision` present, no majority resolution.
  - *Fixture extension:* per-author proposedBase steering (the one real fixture change RSLV-02 needs).

- **RSLV-03 (escalation routing).**
  - *Gated:* deadlock + gated mode → the `ask()` arbitration stub is invoked with each agent's position;
    stub picks a side or writes a ruling → recorded as `resolver: "human"` with rationale
    (decision-record + resolved-decisions.md). Assert the human ruling feeds the re-litigation guard.
  - *Autonomous:* deadlock + autonomous → logged `openDecision`, no pause (existing D-42 path, already
    tested at decision-record level — extend to assert no prompt was issued).
  - *Fixture extension:* none beyond the arbitration `ask()` stub.

- **RCRD-02 (re-litigation guard).**
  - *Inject:* after a fork settles, `shared/resolved-decisions.md` exists and validates against the new
    zod schema; the seeded instruction file references it. Assert a later-phase fixture that READS the
    file (extend a fixture to echo whether it saw a given decision id) confirms availability.
  - *Enforce (D-64):* a fixture that re-litigates a settled decision in a later phase → that position is
    dropped with a `re-litigation` reason in the manifest/record; the run continues to `completed`;
    decision-record notes the violation.
  - *Digest thinness (D-65/D-37):* assert per-turn prompts carry no decision content (extend
    protocol-gate.test.ts:47).
  - *Fixture extension:* a fixture mode that emits a re-litigating position (e.g. re-raises a settled
    issueRef), plus a fixture mode that reports whether it read resolved-decisions.md.

- **Carry-overs.**
  - dist .tmpl: a test that after `npm run build`, `dist/templates/agent-instructions.md.tmpl` exists
    (or `seedInstructions` succeeds against the dist module layout).
  - --bare: a flag-pinning assertion (claude.ts buildArgv) confirming `--bare` is still omitted and the
    seeded "ignore ancestors" directive is present in the template — pins the documented decision so a
    future drift fails loudly (mirrors the existing claude-adapter flag-pinning test).

---

## Open Questions (genuinely undecidable here)

1. **resolved-decisions.md vs decision-record.md authority overlap.** D-63 says the terminal record
   "assembles FROM" the rolling file. Whether to *fully* invert (terminal record reads only the rolling
   file) or *additively* (rolling file for in-run injection, terminal record still re-derives from the
   trail as a cross-check) is a planning call — full inversion is cleaner but loses the trail re-derivation
   as a consistency check. Recommend the planner pick during plan-phase; both are testable.

2. **Gate feedback storage location/attribution (D-51, Claude's discretion).** The note must be
   referenceable by the decision record. Suggested: a `runs/<id>/gate-feedback/<phase>.md` with
   attribution + timestamp, referenced from the decision record. Exact format is a planning detail.

3. **Per-author base steering env shape (fixture).** `MAR_EMIT_BASE_<author>` vs a single JSON env
   (`MAR_EMIT_BASES='{"claude":"claude","codex":"codex"}'`). Trivial implementation choice for the
   plan; JSON env is more flexible for 3+ agents.

4. **Deadlock-detection interaction with the majority tie-break.** Q4 inserts majority before
   `escalate` in BOTH guards. Whether a 2-1 split should resolve via majority at the *deadlock* guard
   (early, round 2–3) or only at the *cap* guard (round 10) affects token spend (D-43: cost is not a
   constraint, so early-resolve-on-majority is acceptable). Recommend majority fires at both guards
   (resolve as soon as a stable clear majority is detected), but flag for the planner since it slightly
   changes when the loop ends.

---

## RESEARCH COMPLETE

- **Re-derivation, not XState snapshots:** the machine is rebuilt every run from `{runDir, config,
  inputPath}` with `initial`=phase-name; resume just sets `initial` to the resume phase and rehydrates
  `context.roster` from the manifest. Snapshot-restore-into-invoked-actors is the XState v5 footgun D-14/D-54
  let us avoid entirely.
- **Majority is a 30-minute insert, not a subsystem:** `tallyBases`/`mostSupportedBase` already exist in
  converge.ts; add a `clearMajority(> size/2)` helper and call it before `escalate` in both the cap and
  deadlock guards — but `mostSupportedBase` must NOT be reused for the tie-break (it returns a plurality on
  a 1-1 tie, which would wrongly resolve D-60's escalate case).
- **One frontmatter reader, not four:** the tolerant `parseFront` (engine.ts:198) and the strict
  double-parse (converge.ts:82 / decision-record.ts:100) have diverged; resume re-validation must use the
  tolerant variant, so extract ONE shared reader and fix the latent strict-reader drop of preamble-prefixed
  artifacts.
- **Re-litigation guard = rolling `shared/resolved-decisions.md`:** new zod schema + injection-safe writer
  (reuse decision-record.ts's serializer); agents read it as a peer artifact (seeded file directs the read,
  keeping prompts thin per D-37); enforcement generalizes the existing integrator `dropped`/conflicts path
  with a `re-litigation` reason; terminal record reads from it.
- **Two carry-overs, both small:** dist fix = `tsc && cpSync(src/templates→dist/templates)` + `files:["dist"]`
  + a guard test; claude `--bare` = keep omitting it (auth-break is real, leakage measured zero live),
  strengthen the seeded "ignore ancestors"+explicit-Read directive, and fix the now-stale scope.ts/instructions.ts
  comments that claim `--bare` is used.
