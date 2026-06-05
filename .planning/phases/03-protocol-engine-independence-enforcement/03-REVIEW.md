---
phase: 03-protocol-engine-independence-enforcement
reviewed: 2026-06-04T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - src/adapters/adapter.ts
  - src/adapters/claude.ts
  - src/adapters/codex.ts
  - src/adapters/gemini.ts
  - src/cli.ts
  - src/protocol/engine.ts
  - src/protocol/gate.ts
  - src/protocol/phases.ts
  - src/schema/manifest.ts
  - src/workspace/manifest.ts
  - src/workspace/scope.ts
  - test/adapter-cwd.test.ts
  - test/fixtures/fake-claude.mjs
  - test/fixtures/fake-codex.mjs
  - test/fixtures/fake-gemini.mjs
  - test/planted-error.test.ts
  - test/protocol-engine.test.ts
  - test/protocol-gate.test.ts
  - test/protocol-run.e2e.test.ts
  - test/scope-independence.test.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
fixed:
  - CR-01
  - CR-02
fixed_at: 2026-06-04T00:00:00Z
fixed_note: "Both criticals fixed (criticals-first). Warnings WR-01..06 and Info IN-01..04 remain open."
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 3 wires the XState v5 protocol engine, per-agent scoped draft isolation, artifacts-on-disk gating, D-30 skip-failed handling, the `mar run` CLI command, and the planted-error A/B independence proof. The core confidentiality mechanism (scoped `work/<agent>/` dirs + boundary promotion) is sound and the agent-name charset guard correctly prevents path-traversal escape from `runDir`. The adapter `cwd` seam is threaded cleanly and the gate-on-written-paths design is a genuine source-of-truth improvement.

However, two correctness defects undermine the phase's central guarantees: (1) the engine never copies the input document into the per-agent scoped workdir under a name the fixtures/real CLIs would discover, and more importantly the **promotion source path can silently produce a false "independence proven" result** because the gate does not verify the scoped draft physically lives only in the per-agent dir; (2) the run's terminal status is written **twice** with a window where a non-`done` XState value other than `failed` is mapped to `failed`, masking engine-internal errors. Several manifest read-modify-write races and an unredacted-promptText assumption are flagged as warnings. The planted-error proof has a structural gap: the CONTROL arm does not actually exercise a shared-context drafting path — it relies on identical privately-held values, so it proves the *fixtures* agree, not that the *mechanism* would leak. That weakens the falsifiability claim the test is built to establish.

## Critical Issues

### CR-01: Terminal status double-write maps all non-`done` XState values to `failed`, masking engine errors

**Status:** FIXED (commit 2061208) — `runProtocol` now reads the machine snapshot once, maps an all-timeout failure to the schema's distinct `timeout` status (D-17) and every other failure to `failed`, and persists the actual cause to a new optional `Manifest.failureReason` (additive zod field) while mirroring it to stderr. The failure cause — gate reason, agent timeout, sub-2-vendor drop, or an actor `onError` error — is threaded through a structured `PhaseFailure` in machine context instead of being discarded.

**File:** `src/protocol/engine.ts:356-360`
**Issue:** `runProtocol` derives success from `actor.getSnapshot().value === "done"` and then writes `setStatus(runDir, ok ? "completed" : "failed")`. Two problems compound:

1. The status is set **twice** for a failing run: each phase's `runPhaseGated` path and the engine's `onError`/`failed` routing already lead here, but `runRun` in `cli.ts:371-372` also created the run as `"running"`, and `setStatus` is the only terminal writer — so far so good — but a `timeout` outcome from an adapter is collapsed into `"failed"` here, discarding the `timeout` status the manifest schema deliberately keeps distinct (`schema/manifest.ts:38`, "`timeout` is kept distinct from `failed` for D-17 observability"). A protocol run that fails purely because an agent timed out is recorded as a generic `failed`, losing the D-17 signal.
2. `getSnapshot().value` for a final state is compared by `=== "done"`. Any unexpected internal XState error that leaves the machine in a non-final or differently-named state is silently treated as `failed` with no diagnostic — the engine swallows the actual error (the `onError: { target: "failed" }` transitions discard `event.error`). There is no audit record of *why* the run failed when the failure originates inside an actor (vs. a gate decision, which does log).

**Fix:** Capture and persist the failure cause, and preserve `timeout`:
```ts
const snapshot = actor.getSnapshot();
const final = snapshot.value;
if (final === "done") {
  await setStatus(runDir, "completed");
  return 0;
}
// Record the real cause instead of a blanket "failed".
const err = (snapshot as { error?: unknown }).error;
if (err) process.stderr.write(`protocol error: ${err instanceof Error ? err.message : String(err)}\n`);
await setStatus(runDir, "failed");
return 1;
```
Additionally, thread per-agent `timedOut` outcomes into a distinct run status path so D-17's `timeout` status is reachable from `mar run`, not only `mar invoke`.

### CR-02: Independence proof is not falsifiable — the CONTROL arm never exercises a shared-context drafting path

**Status:** FIXED (commit 03059b6) — the control arm now runs with `MAR_SHARED_CONTEXT=1`, which GENUINELY bypasses scoped isolation: each fixture deposits its draft into a shared, peer-visible `work/_shared_drafts/` dir, waits (bounded) for all participants, and anchors on a deterministic consensus value READ OFF DISK. The control is handed the SAME divergent values (99 vs 42) as the treatment, so its "AGREED" is a real consequence of context sharing — verified: with the same divergent inputs and isolation intact, the run surfaces a `DISCREPANCY`. The treatment keeps real scoped isolation and now adds a falsifiability assertion: each drafting agent records the peer drafts visible in its own scoped cwd to `work/<agent>/peer-visibility.json`, and the test asserts these are EMPTY — so a scope.ts leak of a peer draft into `work/<agent>/` MUST fail the treatment test. Shared fixture mechanics extracted to `test/fixtures/planted-shared.mjs`.

**File:** `test/planted-error.test.ts:117-133`, `test/fixtures/fake-claude.mjs:130-144`
**Issue:** The file's own header (lines 1-29) stakes the entire phase on a falsifiable A/B: TREATMENT must surface a discrepancy that CONTROL masks. But both arms run the **identical scoped-draft mechanism** (`runProtocol` → scoped `work/<agent>/` → `promoteDrafts`). The only difference is the injected `MAR_PLANTED_VALUES`: CONTROL passes the same value to both agents, TREATMENT passes divergent values. The CONTROL therefore does **not** test that a shared-context (non-scoped) drafting path would mask the error — it tests that two fixtures handed identical constants emit identical drafts. The scoped isolation mechanism is never disabled in the control. As written, the test would still pass even if `scopedWorkdir`/`promoteDrafts` were completely broken, as long as both fixtures happened to read the same value from env — the control's "AGREED" outcome does not depend on isolation at all. This means a regression that *leaked* peer drafts during drafting (the exact confidentiality failure the phase exists to prevent) would not be caught: in TREATMENT, a leak would make codex *see* claude's `VALUE=99` draft, but the fixtures key their own draft value off env (not off peer files) during the draft phase, so the leak is invisible to the draft output and the review still sees two distinct promoted values → still "DISCREPANCY" → test still green.

**Fix:** Make the control arm genuinely shared-context by running a variant that writes both agents' drafts into a single shared location *before* review (bypassing `scopedWorkdir`), OR add a dedicated negative test that asserts a draft-phase agent's workdir listing cannot contain a peer draft even when peers run concurrently (the `scope-independence.test.ts` cross-agent test covers the static case but not the live engine fan-out). Critically, add an assertion that during the draft phase each agent's draft value is derived *only* from its own scoped dir, and a regression guard that fails if a peer draft is readable from a drafting agent's cwd while the draft phase is in flight.

## Warnings

### WR-01: Manifest read-modify-write is lost-update-racy across processes sharing a runDir

**File:** `src/workspace/manifest.ts:55-98`
**Issue:** `addArtifact`, `setStatus`, and `addDroppedAgent` each do `readManifest` → spread → `writeManifestAtomic`. The atomic rename only guarantees no *torn* file, not serializability. The tmp path is `${finalPath}.tmp-${process.pid}` — process-scoped, so two processes operating on the same run (e.g. a `mar invoke --run <id>` appended while a `mar run` over the same dir is mid-flight, or any future concurrency) will each read the same base, append their own entry, and the second rename clobbers the first — a silently lost artifact/dropped-agent record. The engine serializes its own writes, so this is not triggered in the single-process happy path, but the code presents itself as a durable audit trail and the guarantee does not hold under concurrent writers.
**Fix:** Document the single-writer constraint explicitly, or guard with an O_EXCL lock file / advisory lock around the read-modify-write, or include a monotonic `version` field checked-and-incremented to detect a lost update and retry.

### WR-02: `promoteDrafts` copy of a missing draft throws an uncaught error that routes to `failed` with no audit reason

**File:** `src/workspace/scope.ts:56-64`, `src/protocol/engine.ts:277-283,318-328`
**Issue:** `promoteDrafts` copies `runDir/work/<agent>/<draftFileName>` for each surviving agent. If a survivor passed the gate (wrote a non-empty draft into its scoped dir) but the file is subsequently absent/renamed, `fsExtra.copy` rejects, the `promoteActor` errors, and the machine routes to `failed` via `onError`. No `droppedAgents` entry and no diagnostic is recorded — the run dies with status `failed` and the operator cannot tell promotion was the cause. The gate checks the *written* abs paths, but those live under `work/<agent>/`; promotion re-derives the source path independently via `draftFileName`, so the gate's source-of-truth guarantee does not cover the promotion source.
**Fix:** Have `promoteDrafts` verify each source with `isDone` before copy and throw a descriptive error naming the agent + path; surface that message to stderr in `runProtocol`'s failure branch (see CR-01).

### WR-03: `requiredArtifactsExist([])` returns `true` (vacuous) and the count guard can be defeated by a zero-survivor phase

**File:** `src/protocol/gate.ts:20-22`, `src/protocol/engine.ts:247-250`
**Issue:** `requiredArtifactsExist` returns `true` for an empty list, and the engine's pass condition is `requiredArtifactsExist(writtenPaths) && writtenPaths.length === expectedParticipantCount(phase, survivors)`. If a phase somehow yields zero survivors and zero written paths, the expression becomes `true && (0 === 0)` → **pass**, advancing an agent-less run. The comment asserts the engine "never produces a participant-less phase," but `applySkipFailed` would have thrown first only when survivors drop below 2 distinct vendors — it does *not* guarantee `survivors.length > 0` is re-checked at the gate. The invariant is enforced upstream by luck of ordering, not by the gate itself.
**Fix:** Add an explicit `writtenPaths.length > 0` (or `survivors.length >= 2`) precondition to the pass check so a degenerate empty phase fails closed rather than vacuously passing.

### WR-04: Gemini error message can leak full stderr into the normalized artifact/log

**File:** `src/adapters/gemini.ts:106`
**Issue:** On the not-ok path the error is `j.error?.message ?? result.stderr ?? "gemini error"`. `result.stderr` is the raw CLI stderr, which on gemini's failure paths can contain arbitrary content (and, in other failure modes, potentially prompt echoes or environment hints). This `error` string flows into the TurnResult, is surfaced on the console (`cli.ts:271-272`, `engine.ts:146`) and persisted in the artifact frontmatter/raw. The redaction discipline (WR-04 in the codebase) is carefully applied to the *command* but the *error* string bypasses it. Claude's path is safer (`j.result`), but the gemini stderr fallthrough is unbounded and unredacted.
**Fix:** Bound and sanitize the stderr fallback (truncate to N chars, strip control chars) and avoid passing raw stderr through; prefer the structured `j.error?.message` only, with a generic fallback.

### WR-05: `mar invoke --run` resume can still collide on the `.raw.json` sibling, which `nextSeq` does not scan

**File:** `src/cli.ts:169-180`, `src/workspace/layout.ts:55-79`
**Issue:** `nextSeq` derives the next seq from manifest `.md` paths and on-disk names, but `seqFromArtifactName` only matches `*.md` (`/^(\d+)-.+\.md$/`). The overwrite guard at `cli.ts:177` checks only the `.md` artifact path. A prior failed turn that wrote a `.raw.json` but no manifest entry and no `.md` (e.g. crash between the two `writeAtomic` calls in `writeArtifact`) leaves a `NNN-agent-kind.raw.json` orphan whose seq is invisible to `nextSeq`. A resumed run can then reuse that seq for the `.md` while silently overwriting the orphan `.raw.json`, breaking the D-10 "raw never discarded" guarantee.
**Fix:** Have `nextSeq`/`seqFromArtifactName` also account for `.raw.json` siblings (strip both suffixes), or write the `.raw.json` and `.md` under a single atomic staging dir rename so a partial write cannot orphan one half.

### WR-06: `writeArtifact` is not atomic across its two files — a crash leaves a `.md` with no `.raw.json` (or vice-versa)

**File:** `src/workspace/artifacts.ts:75-76`
**Issue:** The `.md` and `.raw.json` are each written atomically but the *pair* is not. A crash between line 75 and 76 yields a non-empty `.md` (which `isDone` reports as done, the gate passes) with a missing raw JSON, violating D-10. Conversely the engine indexes the artifact into the manifest only after both, so a crash there leaves files on disk with no manifest entry — recoverable, but the half-pair is not.
**Fix:** Write both temp files first, then rename both (rename order: raw then md, so the md — the gate's done-signal — appears last). Document that md-present implies raw-present.

## Info

### IN-01: Redundant `existsSync(runDir)` re-check in resume path

**File:** `src/cli.ts:160,169`
**Issue:** `cli.ts:160` already returns if `!existsSync(runDir)`; line 169 re-checks `existsSync(runDir) ? readdirSync(runDir) : []`. The dir is guaranteed to exist by the time line 169 runs, so the ternary's false branch is dead.
**Fix:** `const onDiskNames = readdirSync(runDir);`.

### IN-02: `expectedParticipantCount` has an unreachable duplicate return

**File:** `src/protocol/gate.ts:50-54`
**Issue:** Both branches return `roster.length`; the `if (phase.participants === "all")` guard is currently a no-op. The comment explains it is a future branch point, which is reasonable, but as shipped it is dead-equivalent code that could mask a future bug if someone edits only one branch.
**Fix:** Leave a single `return roster.length` until the `integrator` mode actually diverges, or add a `// TODO(phase-4)` and an exhaustiveness check on `phase.participants`.

### IN-03: Placeholder prompt embeds the input *path*, not content — phases do not actually review the document

**File:** `src/protocol/engine.ts:110`
**Issue:** `promptText = \`phase: ${phase.name}\ninput: ${inputPath}\`` sends only the phase name and a filesystem path. Real CLIs would not see the document content (the scoped dir seeds `input.md`, but the prompt never instructs the agent to read it, and non-scoped phases have no such seed). This is acknowledged as Phase 4 work (RESEARCH A4), so it is correct-for-now, but the current engine cannot produce a meaningful review — worth flagging so it is not mistaken for functional.
**Fix:** None required this phase; ensure Phase 4 replaces the placeholder before any real-credit run.

### IN-04: Fixture `sharedDir()` probe scans all `runs/<id>` and returns the first match

**File:** `test/fixtures/fake-claude.mjs:77-88`, `test/fixtures/fake-codex.mjs:71-82`
**Issue:** When cwd contains a `runs/` dir, the fixture iterates `readdirSync(runsDir)` and returns the first `<id>/shared` it finds. In a test workdir reused across multiple runs this would bind to the wrong run's `shared/`. The planted test uses a fresh `mkdtemp` per arm with exactly one run, so it is currently safe, but the heuristic is order-dependent and brittle if the harness ever leaves a stale run dir behind.
**Fix:** Pass the active run dir to the fixture via env (e.g. `MAR_RUN_DIR`) rather than probing, or assert exactly one run id is present.

---

_Reviewed: 2026-06-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
