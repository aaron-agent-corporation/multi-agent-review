# Phase 3: Protocol Engine + Independence Enforcement - Research

**Researched:** 2026-06-04
**Domain:** 6-phase turn-taking protocol engine over a filesystem artifact bus; phase-gate enforcement (artifacts-on-disk as the gate signal); structurally-enforced draft independence via per-agent scoped workspaces (process `cwd` isolation, NOT prompt instructions); parallel-with-failure-handling fan-out of N agent invocations per phase; planted-error catch test as the independence proof.
**Confidence:** HIGH on the existing foundation (read directly from source), HIGH on the protocol shape (proven in `docs-case-study.md`), MEDIUM on the XState-vs-sequential-engine recommendation (a judgment call the planner must ratify), MEDIUM on the precise independence-enforcement mechanism (the highest-stakes design choice — several viable structural approaches, recommendation below).

> **No CONTEXT.md exists for Phase 3 yet.** This phase has not been through `/gsd:discuss-phase`. The constraints below are extracted from CLAUDE.md, PROJECT.md, REQUIREMENTS.md, STATE.md, and the Phase 1/2 summaries — they are *de facto* locked decisions, but the items flagged in the Assumptions Log SHOULD be confirmed in discuss-phase before planning locks them.

## Summary

Phase 3 turns the per-turn `mar invoke` primitive (Phases 1-2) into a `mar run` engine that drives an input document through the proven 6-phase protocol (drafts → cross-review → responses → evaluation → integration → validation) with two hard invariants: (1) **phase N+1 cannot start until all required phase-N artifacts exist on disk** (PROT-03), and (2) **during drafting, an agent's working context provably excludes peer drafts** (PROT-04), with drafts promoted to a shared area only at the phase-1→2 boundary. The success bar includes a **planted-error catch test** proving independent drafts surface an error a shared-context run would mask.

Almost everything the engine needs already exists and must be **reused, not rebuilt**: `makeAdapter(vendor,bin,model)` (the invoke seam), `withRetry` + per-vendor classifiers, `loadConfig`/`resolveAgent`, `assertReviewable` (the ≥2-vendor gate), the atomic manifest (`createRun`/`addArtifact`/`setStatus`/`readManifest`), the deterministic artifact writer (`writeArtifact` + `isDone` = "exists AND non-empty"), `nextSeq` (monotonic seq), and the NDJSON audit log. The `cli.ts` `runInvoke` function is essentially the body of one turn; Phase 3 is the orchestration *around* it. CLAUDE.md explicitly notes `runInvoke`'s business logic was kept reusable for exactly this.

Two findings materially shape the plan. **First, on the engine: a hand-rolled sequential async engine is the right call for this MVP, not XState v5.** The phase 3 scope (PROT-01/03/04) is a strictly linear 6-phase sequence with a parallel fan-out inside each phase and a gate between phases — there are no sub-loops, no human-pause states, no resumability *in this phase* (PROT-05/06 are Phase 5). XState earns its keep when those land; introducing it now adds a statechart, actor model, and persistence API surface to model a `for`-loop over six phases. The recommendation is a typed phase-descriptor array driven by a plain `async` loop, with the manifest as the persisted state — keeping the door open to swap in XState in Phase 5 if pause/resume/debate complexity justifies it. **Second, on independence (the highest-stakes choice): enforce it structurally with per-agent draft-phase working directories** — each drafting agent runs with `cwd` set to its own `runs/<id>/work/<agent>/` directory that contains the input document but NOT a sibling's draft; promotion copies drafts to `runs/<id>/shared/` only at the phase boundary. This makes "agent A cannot see agent B's draft" a filesystem fact (B's file is not in A's tree), not a prompt request — exactly the project's stated design principle ("independence enforced structurally, not by prompt").

**Primary recommendation:** Build a `mar run <input>` command on a hand-rolled sequential phase engine: a typed `Phase[]` descriptor list, each phase fans out N agents in parallel (`p-limit`/`Promise.allSettled`) reusing the `withRetry(makeAdapter(...))` turn seam, writes deterministically-named per-phase artifacts, then a pure gate (`requiredArtifactsExist`) blocks advance until every required phase-N artifact `isDone()`. Enforce drafting independence by spawning each draft-phase adapter with a per-agent scoped `cwd` (workspace-scoped) that physically lacks peer drafts; promote drafts to a shared dir at the phase-1→2 boundary. Prove it with a planted-error fixture test that a shared-context control run fails to catch and the independent run does.

## User Constraints (from CLAUDE.md / PROJECT.md / REQUIREMENTS.md — no CONTEXT.md yet)

### Locked Decisions (de facto — confirm in discuss-phase)
- **Stack:** TypeScript on Node 22 LTS, ESM. Already installed: `execa@^9`, `zod@^4`, `commander@^15`, `pino@^10`, `fs-extra@^11`, `nanoid@^5`; dev `typescript@^6`, `tsx@^4`, `vitest@^4`, `@biomejs/biome@^2`.
- **No vendor SDKs / direct APIs.** Drive `claude -p`, `codex exec`, `gemini -p` through the existing adapters only (CLAUDE.md "What NOT to Use").
- **No real-time message bus, no MCP coordination, no agent-to-agent chat.** Filesystem is the artifact bus (PROJECT.md Out of Scope; CLAUDE.md).
- **Independence enforced structurally (workspace-scoping), NOT by prompt.** STATE.md: "highest-stakes design choice." This is PROT-04 and is non-negotiable.
- **Filesystem-as-truth.** Run state is always re-derivable from `runs/<id>/manifest.json` + on-disk artifacts (PROT-02/07, D-14).
- **≥2 distinct vendors to run** — reuse `assertReviewable` (ORCH-04/D-29). `mar run` is NOT exempt (unlike `mar invoke`).
- **No `--bare` for claude** (subscription-auth conflict, Phase 1 Pitfall 1). The claude adapter deliberately omits config-isolation flags.

### Claude's Discretion (recommended defaults, planner may adjust)
- Engine implementation (hand-rolled sequential vs XState) — CLAUDE.md *recommends* XState but explicitly frames the phase as MVP and invites evaluating a simpler engine. **This research recommends hand-rolled sequential for Phase 3** (see State of the Art + Don't Hand-Roll).
- Exact per-phase artifact `kind` naming, the scoped-workspace directory layout, the planted-error fixture content.
- Whether to add `gray-matter@4` for reading frontmatter back off promoted artifacts (recommended; see Standard Stack).

### Deferred Ideas (OUT OF SCOPE for Phase 3)
- **Structured review *content* schemas** (numbered issues, P1-P3 severity, accept/reject verdicts) — that is REVW-01/02 / Phase 4. Phase 3 enforces phase *sequencing and gating*; it does not validate review-document internal structure. Phase 3 prompts can be minimal placeholders that produce *a* phase-N artifact; Phase 4 makes those artifacts structured.
- **Disagreement resolution / majority / integrator designation logic** (RSLV-*, REVW-03/04) — Phase 4.
- **Gated (human-approval-per-boundary) mode and resume-from-last-phase** (PROT-05/06) — Phase 5. Phase 3 is autonomous-only, single straight-through run.
- **Decision record output** (RCRD-*) — Phase 4/5.
- **Cost/token reporting** (COST-01) — v2.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROT-01 | Start a run on any input doc; it progresses through all 6 phases with enforced turn-taking | `mar run <input>` command + typed `Phase[]` descriptor driving a sequential async loop; each phase fans out N agents and produces phase artifacts. Reuses `makeAdapter`+`withRetry` turn seam. |
| PROT-03 | Phase N+1 cannot start until all required phase-N artifacts exist | Pure gate `requiredArtifactsExist(phase, roster, runDir)` using existing `isDone()` (exists AND non-empty) + `artifactName` naming; engine refuses to advance until it returns true. |
| PROT-04 | During drafting, an agent's context physically cannot include another's draft; drafts promoted to shared area only at the phase boundary | Per-agent scoped `cwd` working dir in the draft phase (peer draft is not in the tree); explicit promotion copy `work/<agent>/draft → shared/` at the phase-1→2 transition. Verified by directory-listing assertion in the planted-error / independence test. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `mar run` CLI parsing & dispatch | CLI / Entry (`cli.ts`) | — | commander subcommand; thin — delegates to the engine, no business logic (established pattern, 02-05) |
| 6-phase sequencing / turn-taking | Protocol engine (NEW, e.g. `src/protocol/engine.ts`) | — | Owns the phase loop + gate checks; the heart of PROT-01 |
| Phase descriptors (what each phase does) | Protocol (NEW `src/protocol/phases.ts`) | — | Typed data: phase name, participants, artifact kind, independence flag |
| Phase gate (artifacts-exist check) | Protocol (NEW, pure fn) | Workspace (`isDone`, `artifactName`) | Pure derivation from disk — mirrors `gates.ts`/`layout.ts` pure-fn style; PROT-03 |
| One agent turn (spawn+retry+normalize) | Adapter + retry (EXISTING) | — | `withRetry(makeAdapter(vendor,bin,model).invoke(...))` — DO NOT reimplement |
| Parallel fan-out of N agents per phase | Protocol (NEW) | `p-limit` | Bound concurrency; one agent's failure must not abort the phase (`allSettled`) |
| Draft-phase workspace scoping (independence) | Workspace (NEW `src/workspace/scope.ts`) | fs-extra, execa `cwd` | PROT-04 structural enforcement — per-agent `cwd`, peer draft absent from tree |
| Artifact promotion at phase boundary | Workspace (NEW) | fs-extra `copy` | Copy `work/<agent>/` drafts → `shared/` only at the 1→2 boundary |
| Run/artifact naming & seq | Workspace (`layout.ts`, EXISTING) | — | `artifactName(seq,agent,kind)`, `nextSeq` already monotonic; extend `kind` per phase |
| Manifest as persisted run state | Workspace (`manifest.ts`, EXISTING) | — | `createRun`/`addArtifact`/`setStatus`/`readManifest`; add phase-completion tracking |
| Per-invocation audit logging | Logging (`log/invocation.ts`, EXISTING) | pino | Reuse via the `withRetry` `onAttempt` callback exactly as `runInvoke` does |
| Run-start ≥2-vendor gate | `gates.ts` (`assertReviewable`, EXISTING) | — | `mar run` calls it (NOT exempt) before phase 1 |

## Standard Stack

Phase 3 adds **at most one** runtime dependency. The heavy lifting libraries are already installed.

### Core (already installed — reuse)
| Library | Version (installed) | Purpose in Phase 3 | Why Standard |
|---------|--------------------|--------------------|--------------|
| execa | ^9 (9.6.x) | Subprocess spawn for each turn — and the `cwd` option is the independence mechanism (spawn each draft agent with `cwd: work/<agent>/`) | Already the adapter spawn layer; `cwd` per-spawn is the structural-independence lever `[VERIFIED: read in src/adapters/*.ts]` |
| zod | ^4 (4.4.x) | Validate `mar run` inputs + any new manifest phase-state fields | Existing schema layer |
| commander | ^15 | `mar run <input>` subcommand | Existing CLI seam |
| pino | ^10 | Per-attempt audit log via `withRetry onAttempt` (unchanged) | Existing |
| fs-extra | ^11 | `ensureDir` scoped workdirs, atomic writes, **`copy` for promotion** | Already used; `copy` is the promotion primitive |
| nanoid | ^5 | Run ids (unchanged) | Existing |

### Supporting (evaluate / one new dep)
| Library | Version (verified) | Purpose | When to Use |
|---------|--------------------|---------|-------------|
| p-limit | 7.3.0 `[VERIFIED: npm registry, 2026-06-04]` | Bound concurrency on the per-phase N-agent fan-out so 3+ agents don't all spawn unthrottled; pair with `Promise.allSettled` for partial-failure tolerance | **Recommended.** CLAUDE.md names it for "Phase 1 (drafting) and Phase 2 (cross-review) run N agents in parallel; bound concurrency and handle per-agent failure." For a 3-agent MVP a bare `Promise.allSettled` is *sufficient* (no real need to throttle 3 processes) — `p-limit` is cheap insurance and future-proofs to larger rosters. |
| gray-matter | 4.0.3 `[VERIFIED: npm registry, 2026-06-04]` | Parse YAML frontmatter back OFF promoted artifacts if the engine needs to read `agent`/`seq`/`kind` from a file rather than the manifest | **Optional.** The manifest already indexes everything (`path`/`agent`/`seq`/`kind`), so the engine can drive entirely off the manifest and `artifactName` parsing — likely NOT needed in Phase 3. Defer unless a concrete read-back need appears. CLAUDE.md names it for Phase 2+. |

### Explicitly NOT adding in Phase 3
| Library | Why not (this phase) |
|---------|----------------------|
| **xstate@5** (5.32.0 verified) | See State of the Art + Don't Hand-Roll. The Phase 3 scope is a linear loop with a parallel fan-out — no sub-loops, no pause states, no resume *this phase*. XState's value (persisted statechart, actor model, guards for human-gate pauses) lands in Phase 5 (PROT-05/06) + debate (RSLV-04, v2). Introducing it now is modelling a `for`-loop as a statechart. **Recommendation: hold XState for Phase 5; revisit when pause/resume/debate complexity is real.** This contradicts the CLAUDE.md *recommendation* — but CLAUDE.md frames the phase as MVP and the additional-context brief explicitly asks to evaluate this. Flag for discuss-phase ratification. |
| zod-to-json-schema | Structured-output schemas are Phase 4 (review content), not Phase 3 (sequencing). |
| Real-time bus / MCP / WebSocket | Out of scope by design. |

**Installation (if p-limit adopted):**
```bash
npm install p-limit@^7
# gray-matter only if a frontmatter read-back need is proven:
# npm install gray-matter@^4
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled sequential engine | **XState v5 statechart** | XState gives free persistence (`getPersistedSnapshot`/`createActor({snapshot})`) and clean modelling of *future* pause/resume/debate states. But for a linear 6-phase MVP it's a large API surface (actors, guards, snapshot restore) to model a loop. Adopt in Phase 5 when PROT-05/06 make states branch. `[CITED: stately.ai/docs/persistence]` confirms the persistence API exists for the later swap. |
| Per-agent scoped `cwd` for independence | **Prompt instruction ("don't read other drafts")** | Rejected by project principle (STATE.md): prompt-based is not enforcement — an agent CAN read a sibling file if it's on disk in reach. `cwd` scoping makes the peer draft physically absent from the tree. |
| Per-agent scoped `cwd` | **OS container / chroot / separate FS per agent** | Stronger isolation but heavyweight for an MVP and overkill when the CLIs already default to read-only-ish sandboxes (codex `-s read-only`, gemini no `--yolo`). `cwd`-scoping + not-placing-the-file is sufficient and testable. Revisit if untrusted inputs (Phase 5 threat note) demand more. |
| `Promise.allSettled` only | `p-limit` + `allSettled` | For 3 agents, `allSettled` alone is fine. `p-limit` matters at larger rosters; cheap to add now. |

## Architecture Patterns

### System Architecture Diagram

```
                         mar run <input-doc> [--config mar.config.json]
                                        |
                                        v
                          +---------------------------+
                          | load roster (loadConfig)  |
                          | assertReviewable (>=2 vnd) |  <-- run-start gate (gates.ts, REUSE)
                          | createRun -> runs/<id>/    |
                          +---------------------------+
                                        |
                                        v
                  +-------------------- PHASE ENGINE (sequential loop) --------------------+
                  |  for each phase in PHASES[6]:                                          |
                  |    1. resolve participants (whole roster, or designated agent later)   |
                  |    2. FAN OUT in parallel (p-limit + allSettled):                      |
                  |         for each agent:                                                |
                  |           build phase prompt (input + visible prior artifacts)         |
                  |           withRetry( makeAdapter(vendor,bin,model).invoke({            |
                  |              ...,  cwd = scopedWorkdir(phase, agent)  <-- PROT-04       |
                  |           }))                                                          |
                  |           writeArtifact(seq, agent, kind=phase.kind)                   |
                  |           addArtifact(manifest)  +  logInvocation (onAttempt)          |
                  |    3. PROMOTE (only at phase-1->2 boundary): copy work/<agent>/draft   |
                  |         -> shared/   (drafts become visible to peers ONLY here)        |
                  |    4. GATE: requiredArtifactsExist(phase, roster, runDir)?  <-- PROT-03 |
                  |         all isDone()  ? advance  :  fail run (status=failed)            |
                  +-----------------------------------------------------------------------+
                                        |
                                        v
                          status=completed; manifest indexes
                          all 6 phases' artifacts (PROT-07)

  FILESYSTEM (the bus):
    runs/<id>/
      manifest.json                 <- authoritative state (REUSE)
      invocations.ndjson            <- audit log (REUSE)
      work/<agent>/                 <- PROT-04 scoped cwd for the DRAFT phase only
          <input-doc copy>            (input present; peer drafts ABSENT)
          NNN-<agent>-draft.md
      shared/                       <- promoted drafts + all post-draft artifacts
          001-<agent>-draft.md ...    (visible to all agents from phase 2 on)
          0NN-<agent>-review.md
          0NN-<agent>-response.md
          0NN-<agent>-evaluation.md
          0NN-<agent>-integration.md
          0NN-<agent>-validation.md
```

### Recommended Project Structure (additions only)
```
src/
├── protocol/
│   ├── phases.ts        # typed PHASES descriptor array (name, kind, participants, scoped?)
│   ├── engine.ts        # runProtocol(runDir, roster): the sequential phase loop
│   └── gate.ts          # requiredArtifactsExist(phase, roster, runDir): pure, uses isDone
├── workspace/
│   ├── scope.ts         # scopedWorkdir(runDir, agent), promoteDrafts(runDir, agents)
│   └── (layout.ts, manifest.ts, artifacts.ts — EXISTING, extend kind usage)
└── cli.ts               # + `mar run <input>` subcommand (thin dispatch to engine)
```

### Pattern 1: Typed phase descriptor + sequential async loop
**What:** Represent the protocol as data, not control flow — an array of phase descriptors the engine iterates.
**When to use:** A fixed linear pipeline with a uniform per-step shape (fan-out + gate). Exactly Phase 3.
```typescript
// src/protocol/phases.ts — Source: derived from docs-case-study.md "Process Template"
export interface Phase {
  readonly name: "draft" | "review" | "response" | "evaluation" | "integration" | "validation";
  readonly kind: string;            // artifact kind -> artifactName(seq, agent, kind)
  readonly scoped: boolean;         // true only for "draft": run agents in isolated cwd (PROT-04)
  readonly participants: "all" | "integrator"; // Phase 3: "all"; "integrator" wiring is Phase 4
}

export const PHASES: readonly Phase[] = [
  { name: "draft",       kind: "draft",       scoped: true,  participants: "all" },
  { name: "review",      kind: "review",      scoped: false, participants: "all" },
  { name: "response",    kind: "response",    scoped: false, participants: "all" },
  { name: "evaluation",  kind: "evaluation",  scoped: false, participants: "all" },
  { name: "integration", kind: "integration", scoped: false, participants: "all" },
  { name: "validation",  kind: "validation",  scoped: false, participants: "all" },
];
```
```typescript
// src/protocol/engine.ts (shape) — reuses the EXISTING turn seam from cli.ts runInvoke
for (const phase of PHASES) {
  const results = await Promise.allSettled(
    roster.map((agent) => limit(() => runTurn(phase, agent, runDir))) // limit = p-limit(n)
  );
  if (phase.name === "draft") await promoteDrafts(runDir, roster);     // PROT-04 boundary
  if (!requiredArtifactsExist(phase, roster, runDir)) {                // PROT-03 gate
    await setStatus(runDir, "failed");
    throw new Error(`phase "${phase.name}" gate failed: missing artifacts`);
  }
}
await setStatus(runDir, "completed");
```

### Pattern 2: Structural draft independence via scoped `cwd` (PROT-04)
**What:** Each drafting agent's subprocess runs in its own directory that contains the input doc but no peer draft. Promotion is an explicit copy at the phase boundary.
**When to use:** The draft phase ONLY (`phase.scoped === true`). Post-draft phases run in `shared/` where peer artifacts are intentionally visible.
```typescript
// src/workspace/scope.ts (shape)
import { join } from "node:path";
import fsExtra from "fs-extra";
const { ensureDir, copy } = fsExtra;

export async function scopedWorkdir(runDir: string, agent: string, inputPath: string): Promise<string> {
  const dir = join(runDir, "work", agent);
  await ensureDir(dir);
  await copy(inputPath, join(dir, "input.md")); // input present; NO peer drafts placed here
  return dir; // pass as execa { cwd } when invoking the draft-phase adapter
}

export async function promoteDrafts(runDir: string, agents: string[]): Promise<void> {
  const shared = join(runDir, "shared");
  await ensureDir(shared);
  for (const agent of agents) {
    // copy this agent's draft artifact from work/<agent>/ into shared/ — peers see it from phase 2 on
    await copy(join(runDir, "work", agent, draftFileName(agent)), join(shared, draftFileName(agent)));
  }
}
```
**Note:** This requires threading a `cwd` into the turn invocation. The current `TurnRequest` has no `cwd` field and adapters spawn execa without one. Phase 3 must add an optional `cwd` to `TurnRequest` and pass it through `execa(cmd, argv, { cwd, ... })` in each adapter (a small, additive, behavior-preserving change — default = process cwd). This is the one adapter-contract touch Phase 3 needs.

### Pattern 3: Pure phase gate (PROT-03), mirroring `gates.ts` style
```typescript
// src/protocol/gate.ts — pure, no I/O beyond stat via isDone; testable without a real run
import { isDone } from "../workspace/artifacts.js";
import { artifactName } from "../workspace/layout.js";

/** Phase N+1 may start only when EVERY required phase-N artifact exists AND is non-empty. */
export function requiredArtifactsExist(
  expectedFiles: string[],     // absolute or run-relative paths the phase must have produced
): boolean {
  return expectedFiles.every((p) => isDone(p)); // isDone = existsSync && size>0 (EXISTING)
}
```

### Anti-Patterns to Avoid
- **Modelling the linear protocol as an XState statechart in Phase 3.** Adds an actor/persistence API surface to express a `for`-loop; defer until pause/resume/debate states are real (Phase 5).
- **Enforcing independence by prompt ("please don't look at other drafts").** Project-principle violation. Independence must be a filesystem fact.
- **Deriving phase completion from `artifacts.length` or success count.** Use `isDone()` per expected file (exists AND non-empty), matching the existing PROT-02 "done" definition. (The same monotonic-seq trap was already fixed in `nextSeq`/02-05 — honor it.)
- **Aborting the whole phase on one agent's failure.** Use `Promise.allSettled`; then the gate decides if enough artifacts exist. (Mirrors `applySkipFailed`/D-30: drop failures, proceed if ≥2 distinct vendors remain.)
- **Letting `mar run` skip `assertReviewable`.** Unlike `mar invoke` (gate-exempt, D-29), `mar run` is a review and MUST gate on ≥2 vendors.
- **Re-implementing spawn/retry/normalize.** Reuse `withRetry(makeAdapter(...).invoke(...))` exactly as `cli.ts:runInvoke` does (lines 197-227).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Spawn + timeout + kill + retry + normalize one turn | A new invocation path in the engine | `withRetry(makeAdapter(vendor,bin,model).invoke(req))` + `onAttempt`→`logInvocation` (the exact `runInvoke` body) | Already vendor-agnostic, audit-logged, retry-classified; rebuilding invites drift |
| Atomic run state | Custom JSON read/write | `createRun`/`addArtifact`/`setStatus`/`readManifest` (temp-then-rename) | Crash-safe atomic writes already solved (D-16) |
| "Is this turn/phase done?" | `fs.existsSync` ad hoc | `isDone(path)` (exists AND non-empty) | One canonical done-definition (PROT-02); half-written file is never "done" |
| Monotonic artifact seq | `artifacts.length + 1` | `nextSeq(manifestPaths, onDiskNames)` | Already guards against seq reuse on resumed/failed turns (WR-03) |
| Deterministic filenames | string templating | `artifactName(seq, agent, kind)` / `artifactPath` | Single naming source; charset-safe |
| ≥2-vendor gate / partial-failure | New count logic | `assertReviewable` / `applySkipFailed` (gates.ts) | Diversity invariant already enforced (ORCH-04/D-29/D-30) |
| Bounded parallel fan-out | A semaphore | `p-limit` + `Promise.allSettled` | Battle-tested; partial-failure tolerant |
| State machine / persistence | A custom statechart now | **Nothing in Phase 3** (plain async loop); XState v5 in Phase 5 if needed | Don't pay the statechart tax for a linear loop; `[CITED: stately.ai/docs/persistence]` confirms XState's snapshot API is there when Phase 5 needs persist/resume |

**Key insight:** Phase 3 is ~80% orchestration *around* primitives that already exist and are live-verified. The genuinely new code is small: the phase descriptor list, the sequential loop, the pure gate, the scoped-`cwd` workdir + promotion, the `cwd` pass-through on the adapter contract, and the `mar run` subcommand. Most risk is in **independence enforcement correctness** and **the planted-error proof**, not in plumbing.

## Runtime State Inventory

> Phase 3 is greenfield feature work (a new `mar run` command + protocol modules), NOT a rename/refactor/migration. No existing stored data, OS-registered state, or secrets are being renamed. The one *contract* change is additive: an optional `cwd` on `TurnRequest` threaded into each adapter's `execa` call (default = current behavior). Existing `runs/` artifacts from Phase 1-2 `mar invoke` are unaffected (different command path). **No runtime-state migration required — verified by: Phase 3 adds new code paths and a new artifact layout under fresh run ids; it does not alter the meaning of any existing on-disk key, name, or record.**

## Common Pitfalls

### Pitfall 1: Independence that isn't actually enforced
**What goes wrong:** Drafts get written into a shared dir from the start, or the input-copy step accidentally includes a sibling's draft, so "independence" is only nominal.
**Why it happens:** Convenience — it's easier to write everything to `runs/<id>/` flat and just *not prompt* agents to read peers.
**How to avoid:** Draft-phase agents run with `cwd = work/<agent>/` containing ONLY the input. Assert in a test that, at draft time, `readdirSync(work/<agentA>/)` does NOT contain agent B's draft filename. Promotion to `shared/` happens strictly AFTER all drafts are gated complete.
**Warning signs:** Any code that writes a draft directly to `shared/`; any prompt string containing "other agents' drafts are in…".

### Pitfall 2: The planted-error test doesn't actually prove the claim
**What goes wrong:** The catch test asserts "independent run found the error" without a *control* showing a shared-context run masks it — so it proves nothing about independence.
**Why it happens:** Writing only the positive case is easier.
**How to avoid:** Build the test as an A/B: (control) a shared-context run where all agents see a "consensus" draft containing a planted error → the error survives (no agent flags it); (treatment) independent drafts where at least one agent, drafting fresh, produces a different value that surfaces the discrepancy at cross-review. Use **deterministic fake-CLI fixtures** (the established `test/fixtures/fake-*.mjs` pattern) so the test is hermetic and burns zero credits — do NOT depend on live model behavior for a CI gate.
**Warning signs:** The test calls real `claude`/`codex`; the test has no control arm.

### Pitfall 3: Phase gate passes on a half-written or empty artifact
**What goes wrong:** Gate uses `existsSync` only; a crashed turn left a 0-byte file; the engine advances on incomplete state.
**Why it happens:** Forgetting that "exists" ≠ "done".
**How to avoid:** Use `isDone()` (exists AND size>0) for every required file — the definition already established in `artifacts.ts`. Writes are atomic (temp-then-rename) so a partial file never appears under the final name, but the size>0 check is the belt-and-suspenders.

### Pitfall 4: `cwd` change breaks the adapter's argv/output contract
**What goes wrong:** Adding `cwd` to the execa call changes how a CLI resolves the input or where it writes session files, breaking a previously-green adapter test.
**Why it happens:** codex requires a git repo (`--skip-git-repo-check` already pinned) and writes rollout files (`--ephemeral` already pinned); a new `cwd` could reintroduce git-repo or session-file surprises.
**How to avoid:** Make `cwd` optional and default to today's behavior (omit it → unchanged). Add an adapter test asserting `cwd` is passed through to execa when present and absent otherwise (mirror `test/adapter-stdin.test.ts` drift-guard style). Re-confirm codex's `--skip-git-repo-check`/`--ephemeral`/`-s read-only` still hold under a non-repo `cwd`.
**Warning signs:** codex preflight/turn hangs or errors only when `cwd` is set; session/rollout files appearing inside `work/<agent>/`.

### Pitfall 5: One slow/hung agent stalls the whole phase
**What goes wrong:** `Promise.all` (not `allSettled`) rejects on the first failure, discarding the other agents' good artifacts.
**Why it happens:** Reaching for `Promise.all`.
**How to avoid:** `Promise.allSettled` for the fan-out; each turn already has its own wall-clock timeout (execa `timeout`, D-17) so a hang is bounded per-agent. The gate then decides sufficiency.

### Pitfall 6: CLI flag drift across vendor minor versions
**What goes wrong:** A `mar run` works today, breaks after a CLI bump (Codex's flag set "changed notably across 0.12x" per CLAUDE.md; Gemini→Antigravity cutoff June 18 2026).
**Why it happens:** CLIs are external, fast-moving black boxes.
**How to avoid:** Keep adapters the only place that knows flags; the engine never builds vendor argv. Existing flag-pinning tests stay the guard. Note the Gemini churn risk in STATE.md blockers — `mar run` should tolerate gemini failing preflight (run with the ≥2 healthy survivors via `applySkipFailed`).

## Code Examples

### Wiring the engine into a `mar run` subcommand (reusing existing pieces)
```typescript
// src/cli.ts (addition) — Source: pattern mirrors existing runInvoke + 02-05 thin-CLI rule
program
  .command("run")
  .description("Run the 6-phase review protocol on an input document")
  .argument("<input>", "path to the input document")
  .action(async (input: string) => {
    const config = await loadConfig();                 // EXISTING
    assertReviewable(config.agents);                   // EXISTING gate (NOT exempt for run)
    const runId = newRunId();                          // EXISTING
    const runDir = runDirFor(runId);                   // EXISTING
    await createRun({ runDir, runId, status: "running" }); // EXISTING
    process.exitCode = await runProtocol(runDir, config, input); // NEW engine
  });
```

### One turn inside a phase (the reused seam)
```typescript
// Source: condensed from cli.ts runInvoke lines 197-227 (the proven turn body)
const adapter = makeAdapter(agent.vendor, agent.bin, agent.model);
const turn = await withRetry(
  () => adapter.invoke({
    agent: agent.name, promptText, runDir, seq, timeoutMs,
    cwd: phase.scoped ? scopedDir : undefined,   // NEW field — PROT-04
  }),
  { retries, classify: CLASSIFY[agent.vendor],
    onAttempt: (t, attempt) => logInvocation(runDir, { command: t.redactedCommand, promptRef, exitCode: t.exitCode, durationMs: t.durationMs, timedOut: t.timedOut, attempt }) },
);
if (turn.ok) {
  const w = await writeArtifact(runDir, seq, agent.name, { text: turn.text, raw: turn, kind: phase.kind, frontmatter: { runId, phase: phase.name } });
  await addArtifact(runDir, { path: w.path.slice(runDir.length + 1), agent: agent.name, seq, kind: phase.kind, createdAt: new Date().toISOString() });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CLAUDE.md stack rec: XState v5 for the phase machine | Hand-rolled sequential async loop for the **MVP** linear 6-phase flow; reserve XState for Phase 5 (pause/resume/debate states) | This research (Phase 3 is MVP-scoped per the brief) | Smaller surface, fewer deps, faster to a green PROT-01/03/04. XState's persistence (`getPersistedSnapshot`/`createActor({snapshot})`) `[CITED: stately.ai/docs/persistence]` remains the clean Phase-5 path for resumability. |
| Independence by convention/prompt | Independence by filesystem structure (scoped `cwd`, peer file physically absent) | Project principle (STATE.md) | PROT-04 is testable as a directory-listing fact, not a prompt audit |
| `Promise.all` fan-out | `Promise.allSettled` + `p-limit` + post-hoc gate | — | Partial-failure tolerance consistent with D-30 (`applySkipFailed`) |

**Deprecated/outdated:**
- Treating "artifact exists" as "phase done" — superseded by `isDone()` (exists AND non-empty) established in Phase 1.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hand-rolled sequential engine beats XState for Phase 3 MVP | Standard Stack / State of the Art | If Phase 5 pause/resume/debate is imminent and wants a unified machine, a Phase-3 rewrite to XState costs rework. Mitigation: keep the engine behind a `runProtocol()` boundary so swapping internals is contained. **Confirm in discuss-phase — directly counters CLAUDE.md's XState recommendation.** |
| A2 | Per-agent scoped `cwd` is sufficient structural independence (vs containers/chroot) | Architecture Patterns | If a vendor CLI reads outside `cwd` (e.g. absolute paths, home-dir config) it could still see a peer draft placed elsewhere. Mitigation: never place peer drafts anywhere reachable during the draft phase; assert directory contents in test. |
| A3 | Phase 3 needs only an additive optional `cwd` on `TurnRequest`/adapters | Architecture Patterns / Pitfall 4 | If codex/gemini misbehave under a non-default `cwd` (git-repo/session-file surprises) the change is larger than additive. Mitigation: spike codex under a non-repo `cwd` early; default omits `cwd`. |
| A4 | Phase 3 prompts can be minimal placeholders producing *a* phase artifact; structured review content is Phase 4 | Deferred Ideas | If the success criteria are read to require *structured* drafts/reviews now, scope grows into REVW-01/02. Mitigation: confirm with REQUIREMENTS traceability (REVW-* are mapped to Phase 4). |
| A5 | The planted-error catch test should use deterministic fake-CLI fixtures, not live models, for the CI gate | Pitfall 2 | If the success criterion demands a *live* multi-model demonstration, a separate human-verify checkpoint (not a CI test) is needed — mirror the 02-05 live-verify checkpoint pattern. Likely BOTH: hermetic CI test + one live human-verified run. |
| A6 | `p-limit@^7` is the right concurrency primitive (named in CLAUDE.md) | Standard Stack | Low risk; for 3 agents `Promise.allSettled` alone suffices. `[ASSUMED]` it remains the maintained standard — verified to exist at 7.3.0 but adoption tag is ASSUMED per package-provenance rule. |

## Open Questions

1. **Does the success criterion's "watch it progress" imply human-visible streaming/progress output, or just a final summary?**
   - What we know: `mar invoke` prints one human-readable progress line per turn (D-08).
   - What's unclear: whether `mar run` should stream a line per phase/per agent as it goes (likely yes — "watch it progress").
   - Recommendation: emit one progress line per phase boundary and per agent turn (reuse the `runInvoke` line format); keep structured detail in manifest/NDJSON.

2. **Is the integrator (single-agent) designation in scope for Phase 3's integration phase, or does Phase 3 run integration with "all" participants as a placeholder?**
   - What we know: REVW-04 (single integrator) is mapped to Phase 4.
   - What's unclear: Phase 3 success criterion lists "integration" as one of the 6 phases that must run.
   - Recommendation: Phase 3 runs an integration *phase* (produces integration artifacts) with a simple participant rule (e.g. first/all); the *designation logic* (evidence-based pick) is Phase 4. Confirm in discuss-phase.

3. **What exactly does the planted-error "shared-context run would mask" control look like?**
   - What we know: the case study's value is independent drafts surfacing errors at cross-review.
   - What's unclear: the precise fixture design proving masking.
   - Recommendation: A/B fixture test (shared-consensus-with-error vs independent-drafts); see Pitfall 2.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | runtime | ✓ | ≥22 (project), 24.x on machine | — |
| claude CLI | a roster vendor | ✓ | 2.1.162 (live-verified P2) | run with ≥2 healthy survivors |
| codex CLI | a roster vendor | ✓ | 0.128.0 (live-verified P2) | as above |
| gemini CLI | a roster vendor | ✗ (headless auth) | 0.45.0 installed, preflight ✗ responsive (D-32; Antigravity cutoff Jun 18 2026) | `applySkipFailed` → run with claude+codex (still ≥2 distinct vendors) |
| p-limit | parallel fan-out | needs install | 7.3.0 (npm verified) | `Promise.allSettled` without throttle (fine for 3 agents) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** gemini headless (drop to claude+codex via the existing ≥2-vendor partial-failure path — diversity invariant preserved). p-limit (bare `allSettled`).

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4 |
| Config file | `vitest.config.ts` (present) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npx vitest run` (currently 169/169 green across 18 files) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROT-01 | `mar run` advances through all 6 phases producing each phase's artifacts | integration (fake-CLI fixtures) | `npx vitest run test/protocol-engine.test.ts` | ❌ Wave 0 |
| PROT-01 | run-start `assertReviewable` enforced for `mar run` (not exempt) | unit | `npx vitest run test/protocol-engine.test.ts -t "refuses <2 vendors"` | ❌ Wave 0 |
| PROT-03 | phase N+1 blocked until all required phase-N artifacts `isDone()` | unit (pure gate) | `npx vitest run test/protocol-gate.test.ts` | ❌ Wave 0 |
| PROT-03 | gate fails on a 0-byte / missing artifact | unit | `npx vitest run test/protocol-gate.test.ts -t "empty artifact"` | ❌ Wave 0 |
| PROT-04 | draft-phase `work/<agentA>/` listing excludes agent B's draft | unit (fs assertion) | `npx vitest run test/scope-independence.test.ts` | ❌ Wave 0 |
| PROT-04 | promotion copies drafts to `shared/` only at the 1→2 boundary | unit | `npx vitest run test/scope-independence.test.ts -t "promote"` | ❌ Wave 0 |
| PROT-04 | adapters pass `cwd` through to execa when set, omit when unset | unit (drift guard, mirror adapter-stdin.test.ts) | `npx vitest run test/adapter-cwd.test.ts` | ❌ Wave 0 |
| Success #4 | planted-error A/B: independent run catches it, shared-context control masks it | integration (fake fixtures) | `npx vitest run test/planted-error.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the just-written test file (`npx vitest run <file>`).
- **Per wave merge:** `npx vitest run` (full suite) + `npx tsc --noEmit` + `npx biome check`.
- **Phase gate:** full suite green before `/gsd:verify-work`; plus ONE live human-verified `mar run` on a small real input (mirror the 02-05 live-verify checkpoint) since CI uses fixtures only.

### Wave 0 Gaps
- [ ] `test/protocol-engine.test.ts` — PROT-01 6-phase advance + ≥2-vendor gate (fake fixtures)
- [ ] `test/protocol-gate.test.ts` — PROT-03 pure gate incl. empty/missing artifact
- [ ] `test/scope-independence.test.ts` — PROT-04 scoped-dir listing + promotion boundary
- [ ] `test/adapter-cwd.test.ts` — `cwd` pass-through drift guard
- [ ] `test/planted-error.test.ts` — success-criterion #4 A/B catch test
- [ ] Possibly a new fixture mode (e.g. `fake-claude.mjs --emit <kind>`) so fixtures can return distinct per-phase outputs; extend existing `test/fixtures/fake-*.mjs`.
- [ ] Framework install: none (vitest present).

## Security Domain

> `security_enforcement` not present in config → treat as enabled. Phase 3 inputs are still trusted-ish documents (untrusted legal inputs are the Phase 5 elevated-threat note in STATE.md), but the new subprocess-with-`cwd` surface warrants the checks below.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | CLIs use the user's existing subscription auth; orchestrator holds no secrets |
| V3 Session Management | no | no sessions; run state is filesystem artifacts |
| V4 Access Control | yes (filesystem) | scoped `cwd` per agent + `ensureDir`; never write outside `runs/<id>/`; run-id charset already path-safe (`RUN_ID_RE`, no `..`) |
| V5 Input Validation | yes | validate `<input>` path is a regular file (reuse `resolvePrompt`-style bounded read, MAX 10MB, WR-05); zod-validate any new manifest fields; input copied into scoped dir, never executed |
| V6 Cryptography | no | none in scope |
| V12 File handling | yes | input copy is bounded/size-checked; atomic writes (temp-then-rename) already standard; no path from input content to a shell (execa array args, no shell — T-01-05) |

### Known Threat Patterns for {Node + multi-CLI subprocess + filesystem bus}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via input path or run id escaping `runs/` | Tampering | `RUN_ID_RE` charset gate (EXISTING); resolve/validate `<input>` before copy; `join` under `runDir` only |
| Prompt/document content injecting shell commands | Tampering/Elevation | execa array argv, no shell (EXISTING, T-01-05); prompt always an argv value, stdin closed (`stdin:'ignore'`, 02-05) |
| Agent reads peer draft → independence breach | Information Disclosure (the project's core invariant) | scoped `cwd` with peer draft physically absent (PROT-04); directory-listing assertion in test |
| Oversized input streamed to a model | DoS / cost | 10MB bounded read (WR-05 pattern) before copy into scoped dir |
| codex writing rollout/session files into the scoped workdir | Tampering | `--ephemeral` pinned (EXISTING); verify under the new `cwd` (Pitfall 4) |
| One hung agent stalls the run | DoS | per-turn execa wall-clock `timeout` (D-17) + `allSettled` fan-out |

## Sources

### Primary (HIGH confidence)
- `src/cli.ts`, `src/adapters/{adapter,claude,codex,gemini,registry,common}.ts`, `src/workspace/{layout,manifest,artifacts}.ts`, `src/gates.ts`, `src/config.ts`, `src/schema/{config,manifest,turn}.ts`, `src/preflight.ts` — read directly; the existing reusable foundation.
- `.planning/phases/02-*/02-01-SUMMARY.md`, `02-05-SUMMARY.md`, `.planning/phases/01-*/01-RESEARCH.md` — established decisions (D-12/D-17/D-24/D-29/D-30, stdin fix, version extraction, ok-rules).
- `docs-case-study.md` — the proven 6-phase protocol, artifact lineage, anti-patterns, "keep artifacts separate until merge" (the PROT-04 rationale).
- `CLAUDE.md` — locked stack, "What NOT to Use", per-CLI flag reference, p-limit/gray-matter/XState rationale; vendor-churn flags.
- `.planning/REQUIREMENTS.md` (traceability: REVW-*/RSLV-*/PROT-05/06 → Phase 4/5), `STATE.md`, `PROJECT.md`.

### Secondary (MEDIUM confidence)
- `stately.ai/docs/persistence` `[CITED]` — XState v5 `getPersistedSnapshot` / `createActor({snapshot})` exist (relevant for the Phase-5 swap, not Phase 3).
- npm registry `[VERIFIED]` — `xstate@5.32.0`, `p-limit@7.3.0`, `gray-matter@4.0.3` (current versions, 2026-06-04).

### Tertiary (LOW confidence)
- None relied upon; all recommendations trace to source files, the case study, or registry/doc verification.

## Metadata

**Confidence breakdown:**
- Existing-foundation reuse map: HIGH — read every relevant source file directly.
- Protocol shape (6 phases, gate, independence rationale): HIGH — proven in `docs-case-study.md`, matches REQUIREMENTS.
- Engine recommendation (sequential vs XState): MEDIUM — a defensible judgment that counters CLAUDE.md's XState rec; flagged A1 for discuss-phase.
- Independence mechanism (scoped `cwd`): MEDIUM — sound and testable, but A2/A3 (CLI behavior under non-default `cwd`) want an early spike.
- Pitfalls/validation: HIGH — derived from established project decisions and the existing test patterns.

**Research date:** 2026-06-04
**Valid until:** ~2026-07-04 (stable internal foundation; sooner re-check if vendor CLIs bump — note Gemini→Antigravity cutoff June 18 2026 and claude `-p` billing change June 15 2026).
