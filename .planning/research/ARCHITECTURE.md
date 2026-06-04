# Architecture Research

**Domain:** Vendor-neutral multi-agent adversarial review orchestration (driving heterogeneous AI CLIs through a phased, artifact-on-filesystem review protocol)
**Researched:** 2026-06-04
**Confidence:** HIGH (CLI invocation modes verified against official docs; orchestration patterns corroborated by multiple sources and the in-repo case study)

---

## Recommendation Up Front

**Build form (b): a filesystem protocol + thin runner.** A convention-based shared workspace (one run directory, one artifact file per turn) coordinated by a single-process, phase-driven runner that shells out to each vendor CLI in headless mode.

**Why this over the alternatives:**

| Candidate | Verdict | Reasoning |
|-----------|---------|-----------|
| (a) CLI orchestrator tool | **Partial — this IS the runner, packaged as a CLI** | "CLI orchestrator" and "filesystem protocol + thin runner" are not mutually exclusive. The right answer is a thin runner *exposed as* a CLI, whose source of truth is the filesystem. Reject the version of (a) that holds run state in memory/process only. |
| (b) Filesystem protocol + thin runner | **RECOMMENDED** | The case study already proved the artifact-per-turn convention works manually. The filesystem is the natural shared workspace, the natural independence boundary (gate by *not yet writing/exposing* a file), the natural audit/lineage record, and the natural resumability checkpoint (run state is reconstructable from which files exist). It maps 1:1 to how all three CLIs already operate (they read/write files in a working dir). Lowest mechanism, highest transparency, debuggable with `ls`. |
| (c) Daemon / message-bus service | **REJECT for v1** | The protocol is turn-based and artifact-based *by design* (PROJECT.md Out of Scope explicitly excludes real-time agent-to-agent chat and a message bus is overkill for ≤4 sequential turns per phase). A daemon adds process lifecycle, IPC, and a second source of truth (bus state vs. disk state) for zero v1 benefit. Revisit only if/when concurrent multi-run throughput or live streaming UI becomes a goal. |

The decision is essentially: **the filesystem is the database, the message queue, and the audit log.** Everything else is a stateless function over the contents of the run directory.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          ENTRY / CLI LAYER                         │
│   review run <doc> --agents claude,codex,gemini --gate phase       │
│   review resume <run-id>     review status <run-id>                │
└───────────────────────────────┬──────────────────────────────────┘
                                 │ (parsed config)
┌───────────────────────────────▼──────────────────────────────────┐
│                         ORCHESTRATION LAYER                         │
│  ┌────────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │ Phase State    │   │ Turn Scheduler   │   │ Gate Controller │  │
│  │ Machine        │──▶│ (who acts next,  │──▶│ (autonomous vs  │  │
│  │ (6 phases)     │   │  in what order)  │   │  human pause)   │  │
│  └───────┬────────┘   └────────┬─────────┘   └────────┬────────┘  │
│          │                     │                       │           │
│  ┌───────▼─────────────────────▼───────────────────────▼───────┐  │
│  │           Independence Enforcer (visibility policy)          │  │
│  │  decides which existing artifacts an agent's prompt may cite │  │
│  └───────────────────────────────┬─────────────────────────────┘  │
└──────────────────────────────────┼────────────────────────────────┘
                                    │ (invoke agent X for turn T)
┌───────────────────────────────────▼───────────────────────────────┐
│                         AGENT ADAPTER LAYER                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │ ClaudeAdapter│    │ CodexAdapter │    │ GeminiAdapter│  (+Grok)  │
│  │ claude -p    │    │ codex exec   │    │ gemini -p    │          │
│  │ --output json│    │ --json       │    │ --output json│          │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘          │
│         └───────────────────┴────────────────────┘                 │
│              normalized: {stdout, exit, cost, files_written}        │
└───────────────────────────────────┬───────────────────────────────┘
                                     │ (read context / write outputs)
┌───────────────────────────────────▼───────────────────────────────┐
│                    SHARED WORKSPACE (FILESYSTEM)                    │
│  runs/<run-id>/                                                     │
│    manifest.json        ← run state, single source of truth        │
│    input/               ← the document under review                 │
│    phase-1-drafts/      ← draft-claude.md, draft-codex.md ...       │
│    phase-2-reviews/     ← review-claude-of-codex.md ...             │
│    phase-3-responses/   ← response-codex.md ...                     │
│    phase-4-merge/       ← merged-<integrator>.md                    │
│    phase-5-eval/        ← evaluation.md (base selection)            │
│    phase-6-validation/  ← validation.md, DECISION-RECORD.md         │
│    .gates/              ← gate-phase-2.requested / .approved        │
│    logs/                ← per-turn raw stdout/stderr + cost         │
└────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility (owns) | Typical Implementation |
|-----------|----------------------|------------------------|
| **CLI / Entry** | Parse args (document, agent roster, gating mode); dispatch run/resume/status | Single binary/script; thin argument parsing only |
| **Phase State Machine** | Define the 6 phases, legal transitions, per-phase entry/exit conditions ("phase N complete when all expected artifacts exist") | Explicit enum + transition table; *no* implicit ordering |
| **Turn Scheduler** | Within a phase, expand the agent roster into ordered turns (e.g. Phase 2 = N×(N−1) review turns); decide next pending turn | Pure function over manifest + roster |
| **Gate Controller** | Pause at phase boundaries when gating enabled; write a gate request, block until approval marker appears | Sentinel files in `.gates/`; poll or block |
| **Independence Enforcer** | Compute the *visibility set* per turn — which prior artifacts an agent is allowed to receive — and enforce it by controlling what the adapter exposes | Visibility policy table keyed by (phase, turn role) |
| **Agent Adapter Layer** | Translate a normalized "do this turn" request into vendor-specific CLI invocation; normalize the result | One adapter module per vendor implementing a shared interface |
| **Shared Workspace** | Hold all run state and artifacts; *be* the durable checkpoint and audit trail | Plain directory tree + `manifest.json` |
| **Manifest** | Single source of truth: run id, roster, gating mode, current phase, per-turn status, artifact lineage | One JSON file, append/update transactionally |

---

## Recommended Project Structure

```
multi-agent-review/
├── bin/
│   └── review                  # entry point (CLI)
├── src/
│   ├── cli/                    # arg parsing, subcommands (run/resume/status)
│   ├── protocol/
│   │   ├── phases.ts           # 6-phase state machine: definitions + transitions
│   │   ├── scheduler.ts        # expand roster → ordered turns per phase
│   │   ├── visibility.ts       # independence policy (what each turn may see)
│   │   └── gates.ts            # human gating: request/approve markers
│   ├── adapters/
│   │   ├── adapter.ts          # shared AgentAdapter interface
│   │   ├── claude.ts           # claude -p --output-format json
│   │   ├── codex.ts            # codex exec --json
│   │   ├── gemini.ts           # gemini -p --output-format json
│   │   └── registry.ts         # name → adapter lookup (extensible: grok later)
│   ├── workspace/
│   │   ├── layout.ts           # run dir paths + artifact naming schema
│   │   ├── manifest.ts         # read/write/validate manifest.json
│   │   └── artifacts.ts        # write artifact, compute "phase complete?"
│   ├── runner/
│   │   └── engine.ts           # the loop: read state → pick turn → invoke → write
│   └── decision/
│       └── record.ts           # build DECISION-RECORD.md from artifacts
├── prompts/                    # per-phase prompt templates (document-type-agnostic)
│   ├── 1-draft.md
│   ├── 2-review.md
│   ├── 3-response.md
│   ├── 4-merge.md
│   ├── 5-eval.md
│   └── 6-validate.md
└── runs/                       # generated run directories (gitignored or archived)
```

### Structure Rationale

- **`protocol/` separated from `adapters/`:** the protocol is what makes this system valuable and must be vendor-agnostic. It must never import a vendor adapter directly — it only knows "invoke agent X for turn T." This boundary is what keeps a new vendor (Grok) a one-file addition.
- **`workspace/` owns all path/naming logic:** every component that touches the filesystem goes through `layout.ts`, so the artifact naming schema lives in exactly one place. Changing the schema does not ripple into the runner.
- **`prompts/` as data, not code:** because the system is generic over document type, phase instructions are templates fed the input document — not hardcoded strings. This is also where independence is *instructed* (e.g. the Phase 1 prompt says "you have not seen any other draft").
- **`runs/` is disposable but inspectable:** a human can `cd` into any run and read exactly what each agent saw and produced. This transparency is the chief argument for form (b).

---

## Architectural Patterns

### Pattern 1: Filesystem-as-State-Machine (event-sourcing-lite)

**What:** The run's state is *derived* from which artifacts exist on disk, with `manifest.json` as the authoritative index. There is no in-memory run state that can be lost. "Phase 2 is done" means "all N×(N−1) review files exist and are non-empty."

**When to use:** Sequential, checkpointable workflows where each step produces a durable artifact — exactly this domain. This is the lightweight cousin of durable-execution engines (Temporal, Restate, LangGraph durable mode) which record each completed step so a crashed run resumes from the last completed step rather than restarting.

**Trade-offs:**
- (+) Resumability is nearly free: `resume` = re-derive state from disk, skip completed turns.
- (+) Auditable and debuggable with standard tools; the lineage record is the directory itself.
- (−) Requires care that "completed turn" is detected idempotently (file exists AND valid) so a half-written file isn't treated as done — write to a temp name, then atomic rename.

**Example:**
```typescript
// A turn is complete iff its expected artifact exists and is non-empty.
function turnComplete(t: Turn): boolean {
  const p = layout.artifactPath(t);             // deterministic from (phase, agent, target)
  return fs.existsSync(p) && fs.statSync(p).size > 0;
}
// Resume = next pending turn in scheduler order whose artifact is missing.
const next = scheduler.turns(manifest).find(t => !turnComplete(t));
```

### Pattern 2: Adapter Interface with Normalized Invocation Contract

**What:** Each vendor CLI is hidden behind one interface. The runner builds a vendor-neutral `TurnRequest` (working dir, prompt, allowed-read files, output file); the adapter knows how to spell that for its CLI and returns a normalized `TurnResult`.

**When to use:** Any time you coordinate heterogeneous external tools with the same logical operation but different flags. Verified vendor specifics:

| Vendor | Headless invocation | JSON output | Session resume |
|--------|--------------------|-------------|----------------|
| Claude Code | `claude -p "<prompt>"` | `--output-format json` (returns result, cost, `session_id`) | `--resume <id>` / `--continue` |
| Codex CLI | `codex exec "<prompt>"` | `--json` (JSONL event stream; final msg to stdout) | session continuation supported |
| Gemini CLI | `gemini -p "<prompt>"` | `--output-format json` | (treat as stateless per-turn for v1) |

**Trade-offs:**
- (+) New vendor = implement one interface; protocol untouched (extensibility requirement met).
- (+) Lets the runner stay synchronous and simple — invoke, wait for exit, read the output file.
- (−) Vendors differ in sandbox/approval defaults (Codex `exec` sandboxes writes by default; needs `--full-auto`/explicit opt-in to write freely; Gemini has `--yolo`/`--non-interactive`; Claude needs `--allowedTools`). The adapter must own these flags so the protocol never sees them.

**Example:**
```typescript
interface AgentAdapter {
  name: string;
  invoke(req: TurnRequest): Promise<TurnResult>;
  // req: { cwd, promptText, outputPath } — adapter maps to CLI flags
  // result: { ok, finalText, costUsd?, raw } — runner only reads outputPath after
}
```

### Pattern 3: Independence via Visibility Policy (not via trust)

**What:** Independence is enforced *structurally*, not by asking agents to behave. Before Phase 2, no agent is ever handed another agent's draft. The Independence Enforcer computes a per-turn allow-list of readable artifacts; the adapter invokes the CLI in a context where only those files are present/referenced.

Two enforcement strengths (pick per risk level):
1. **Prompt-scoped (minimum):** the prompt references only allowed artifact paths; agents run in the shared run dir but are instructed not to read siblings. Cheap, leaky.
2. **Workspace-scoped (recommended):** each agent's turn runs in a *per-agent subdirectory* (or a copied/symlinked view) containing only its allowed inputs. Phase 1 drafts are written to a private location and only *promoted* into the shared review area at the Phase 1→2 transition. An agent physically cannot read a draft that isn't in its working directory.

**When to use:** Workspace-scoping whenever anchoring would defeat the product's core value — which the case study shows is always for Phase 1. ("Independent drafting before review… prevented anchoring.")

**Trade-offs:**
- (+) Workspace-scoping makes independence a property of the layout, not of agent compliance.
- (−) Requires the layout to distinguish "private/pending" artifacts from "promoted/shared" artifacts, and a promotion step at the gate.

**Example (promotion gate enforces independence):**
```
phase-1-drafts/.pending/draft-claude.md   ← written here during Phase 1 (private)
phase-1-drafts/.pending/draft-codex.md
   --- Phase 1 complete: all drafts exist → PROMOTE ---
phase-1-drafts/draft-claude.md            ← now visible to all for Phase 2 review
phase-1-drafts/draft-codex.md
```

### Pattern 4: Sentinel-File Human Gating

**What:** When `--gate phase` is set, the Gate Controller writes `.gates/gate-phase-N.requested` at a phase boundary and blocks until `.gates/gate-phase-N.approved` appears (created by the human via `review approve <run-id>` or by touching the file). Autonomous mode skips the wait.

**When to use:** Configurable human involvement (PROJECT.md requirement). High-stakes runs gate at every boundary; internal docs run autonomous. The same mechanism serves as the **debate-escalation hook**: an unresolved disagreement raises a gate the human arbitrates.

**Trade-offs:** (+) No extra process or IPC — gating is just files, consistent with the rest of the design. (−) Polling/blocking semantics must be chosen (block-and-poll is fine for a single-run CLI).

---

## Data Flow

### Run Flow (one full protocol execution)

```
review run <doc>
   ↓
[CLI] parse roster + gating → [Manifest] init runs/<id>/manifest.json, copy doc to input/
   ↓
┌─ for each PHASE (1..6) ──────────────────────────────────────────┐
│  [State Machine] enter phase                                      │
│      ↓                                                            │
│  [Scheduler] expand roster → ordered list of turns               │
│      ↓                                                            │
│  ┌─ for each pending TURN ────────────────────────────────────┐  │
│  │ [Independence Enforcer] compute visible artifacts          │  │
│  │      ↓                                                      │  │
│  │ [Adapter] invoke vendor CLI (cwd=scoped, prompt, output)   │  │
│  │      ↓                                                      │  │
│  │ agent reads visible artifacts → writes its artifact file   │  │
│  │      ↓                                                      │  │
│  │ [Workspace] verify artifact exists → mark turn done in      │  │
│  │             manifest (atomic write) + log cost/raw          │  │
│  └─────────────────────────────────────────────────────────────┘ │
│      ↓ (all turns done)                                           │
│  [State Machine] phase exit condition met → PROMOTE pending      │
│      artifacts (independence release)                             │
│      ↓                                                            │
│  [Gate Controller] if gated: write .requested, BLOCK for .approved│
└──────────────────────────────────────────────────────────────────┘
   ↓
[Decision Record] assemble DECISION-RECORD.md (resolved/open decisions, lineage)
```

### Resume Flow (after crash or pause)

```
review resume <run-id>
   ↓
[Manifest] load → [Workspace] re-derive truth: for each turn, artifact exists?
   ↓
[Scheduler] first turn whose artifact is missing/invalid = resume point
   ↓
continue Run Flow from there (completed turns are NOT re-invoked → idempotent)
```

### Key Data Flows

1. **Document → drafts (fan-out, isolated):** input document copied into N private working contexts; N agents draft in parallel-capable but independence-isolated dirs; nobody reads anyone.
2. **Drafts → reviews (fan-out, cross):** after promotion, each agent reads all *other* agents' drafts and emits one structured review per peer (numbered issues, severity, questions — the proven format).
3. **Reviews → responses (fan-in per author):** each agent reads reviews *of its own* draft, emits accept/reject-with-reason/refine.
4. **All artifacts → evaluation → single integrator:** one designated agent (or human) selects a base + identifies additions; *only the integrator* merges (kills the redundant-merge waste from the case study).
5. **Merged doc → validation → decision record:** final targeted review; resolved/open decisions captured; the directory itself is the lineage.

### State Management

```
manifest.json (authoritative index)
   ↑ updated after every completed turn (atomic temp-write + rename)
   ↓ read at start of every turn + on resume
Artifact files (the actual content + the implicit "done" signal)
```
No other state store. No daemon memory. The disk is the state.

---

## Build Order (dependency-driven)

The components have a clear dependency spine; build bottom-up so each layer is testable against real files before the layer above exists.

1. **Workspace layer first** (`layout`, `manifest`, `artifacts`). Everything depends on the naming schema and run-state representation. Testable standalone: create a run dir, write/read manifest, detect "phase complete."
2. **One adapter + a manual harness.** Get `claude -p --output-format json` invoked, output captured to a file, result normalized. Prove the invocation contract against a real CLI before generalizing. (Build the registry + 2nd/3rd adapter once the interface is proven.)
3. **Phase state machine + scheduler.** Encode the 6 phases and turn expansion as pure functions over the manifest. Testable with fixture manifests, no CLIs needed.
4. **Independence enforcer + promotion.** Layer the visibility policy and the pending→shared promotion onto the workspace. This is the load-bearing correctness mechanism — build and test it deliberately (assert that a Phase 1 turn's working dir contains no peer drafts).
5. **Runner engine** (the loop) — ties scheduler + enforcer + adapters + workspace together. First end-to-end run here.
6. **Resume** — falls out almost free once 1+5 exist (re-derive + skip-done); add explicit tests for crash-mid-turn (half-written artifact must NOT count as done).
7. **Gate controller** — additive; autonomous mode works without it, so build after the happy path runs end to end.
8. **Decision record assembly** — last; pure read over completed artifacts.
9. **Disagreement/debate mechanism** — deferred (PROJECT.md flags it as the genuinely unsolved problem to research separately). The gate controller already provides the human-escalation fallback, so v1 can ship with "escalate to human gate" as the resolution while the structured debate (majority/judge/debate-rounds) is researched.

**Critical path to v1 success bar** (a complete 3-agent run through all 6 phases with a decision record): steps 1 → 2 → 3 → 5, with step 4 as the non-negotiable correctness gate and step 8 to produce the record. Steps 6, 7, 9 harden it.

---

## Scaling Considerations

This is a developer/single-operator tool, not a multi-tenant service. "Scale" here means run complexity, not user count.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 2–4 agents, 1 run | The recommended design as-is. Sequential turns; one process. |
| 4+ agents | Phase 2 grows as N×(N−1) reviews — parallelize *within* a phase (independent turns can run concurrently) but keep phase boundaries as sync barriers. The filesystem already tolerates concurrent writers because each turn writes a distinct file. |
| Many concurrent runs | Still fine: each run is an isolated `runs/<id>/` dir. No shared mutable state between runs. This is where, *only if* it becomes a product need, form (c) (a daemon scheduling many runs) would earn its complexity. |

### Scaling Priorities
1. **First bottleneck: wall-clock from sequential turns.** Fix by parallelizing independent turns inside a phase (drafting and cross-review turns are independent). Keep promotion/gate as barriers.
2. **Second bottleneck: prompt/context size as drafts grow.** Fix in the adapter/prompt layer (summaries, targeted excerpts), not the orchestration layer.

---

## Anti-Patterns

### Anti-Pattern 1: Holding run state in process memory
**What people do:** Track current phase / which agent has seen what in the runner's memory; treat files as mere output.
**Why it's wrong:** A crash loses orchestration state; resume becomes guesswork; you've reinvented a daemon's fragility without its benefits. It also creates two sources of truth (memory vs. disk) that drift.
**Do this instead:** Make the filesystem authoritative. Run state is *derived* from disk + manifest. The runner is a stateless function of the run directory.

### Anti-Pattern 2: Enforcing independence by instruction alone
**What people do:** Put all drafts in one shared dir from the start and tell agents "don't peek at the others during drafting."
**Why it's wrong:** Independence is the product's entire reason to exist (non-overlapping blind spots). Trusting compliance risks silent anchoring that destroys the value while everything still "runs." It's also untestable.
**Do this instead:** Workspace-scope it. Drafts are written to private/pending locations and only *promoted* into the shared area at the Phase 1→2 boundary. Independence becomes a structural invariant you can assert in a test.

### Anti-Pattern 3: Leaking vendor flags into the protocol
**What people do:** Branch on agent name inside the state machine / scheduler (`if (agent === 'codex') addFlag(...)`).
**Why it's wrong:** Vendor-neutrality erodes; adding Grok means editing protocol code; the valuable, generic core becomes vendor-coupled.
**Do this instead:** All vendor specifics (flags, sandbox modes, JSON parsing, session handling) live behind the `AgentAdapter` interface. The protocol speaks only `TurnRequest`/`TurnResult`.

### Anti-Pattern 4: Treating a half-written artifact as a completed turn
**What people do:** "Turn done = output file exists."
**Why it's wrong:** A crash mid-write leaves a truncated file; resume skips a turn that never really finished; the run silently corrupts.
**Do this instead:** Write to a temp name and atomically rename on success; "done" = file exists AND non-empty AND (optionally) recorded in manifest. Idempotent completion detection is the foundation of safe resume.

### Anti-Pattern 5: Reaching for a message bus / daemon for v1
**What people do:** Stand up a broker or long-lived service to coordinate turns.
**Why it's wrong:** The protocol is sequential and turn-based by explicit design; a bus adds a second state store, process lifecycle, and IPC for no v1 gain — directly against PROJECT.md scope.
**Do this instead:** Synchronous runner over the filesystem. Add concurrency *within* a phase via plain process parallelism, not a bus.

---

## Integration Points

### External Services (the vendor CLIs)

| Service | Integration Pattern | Notes |
|---------|--------------------|-------|
| Claude Code | `claude -p` + `--output-format json` + `--allowedTools` | Returns `session_id`, cost; supports `--resume`. Must allow Read/Write tools for it to touch artifacts. |
| Codex CLI | `codex exec` + `--json` | Sandboxes writes by default — adapter must opt into write access (`--full-auto` / explicit sandbox flag) scoped to the run dir. Streams JSONL; final message to stdout. |
| Gemini CLI | `gemini -p` + `--output-format json` + `--non-interactive` | `--yolo` auto-approves in trusted env. Treat as stateless per-turn for v1. |
| Grok/xAI (future) | new adapter implementing `AgentAdapter` | No CLI installed yet; design already accommodates via registry. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Protocol ↔ Adapters | `AgentAdapter` interface only | Protocol must not import a concrete adapter; use the registry. The single most important boundary for vendor-neutrality. |
| Runner ↔ Workspace | path/manifest API in `workspace/` | All filesystem access funnels through one module so the naming schema lives in one place. |
| Independence Enforcer ↔ Adapter | scoped `cwd` + allow-list in `TurnRequest` | Enforcer decides visibility; adapter merely executes within the scoped working directory. |
| Gate Controller ↔ Human | sentinel files in `.gates/` | No process coupling; human approves out-of-band via a subcommand or `touch`. |

---

## Open Questions / Flags for Later Research

- **Debate mechanism (deferred by design).** v1 resolves disagreement by escalating to a human gate. The structured alternatives (majority vote with 3+ agents, designated judge agent, bounded debate rounds) need their own research spike — flagged in PROJECT.md as the one genuinely unsolved problem. The architecture supports any of them as an extra sub-phase between Evaluation and Integration without structural change.
- **Session continuity vs. fresh context per turn.** Claude/Codex support session resume; using it could preserve an agent's reasoning across its own turns, but risks leaking cross-turn context that undermines independence. Recommendation: **fresh, stateless invocation per turn for v1**, with all context supplied explicitly via the visible artifact set — this keeps independence auditable. Revisit if quality suffers.
- **Atomicity of multi-file turns.** If a single turn legitimately produces multiple files, "done" detection needs a per-turn completion marker rather than per-file existence. Resolve when/if a phase requires it.

---

## Sources

- In-repo case study `docs-case-study.md` — proven 6-phase protocol, artifact-per-turn convention, independence/anchoring observations, redundant-merge and last-edit-wins anti-patterns (primary evidence, HIGH).
- [Run Claude Code programmatically — Claude Code Docs](https://code.claude.com/docs/en/headless) — `-p`, `--output-format json`, `--resume`/`--continue` (HIGH).
- [Non-interactive mode — Codex / OpenAI Developers](https://developers.openai.com/codex/noninteractive) and [Codex CLI reference](https://developers.openai.com/codex/cli/reference) — `codex exec`, `--json`, default write sandbox (HIGH).
- [Headless mode reference — Gemini CLI](https://geminicli.com/docs/cli/headless/) and [gemini-cli headless.md (GitHub)](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md) — `-p`/`--prompt`, `--output-format json`, `--non-interactive`, `--yolo` (HIGH).
- [Durable execution — LangChain/LangGraph docs](https://docs.langchain.com/oss/python/langgraph/durable-execution) and [What is Durable Execution? — Restate](https://www.restate.dev/what-is-durable-execution) — resume-from-last-completed-step, idempotent steps (MEDIUM, pattern corroboration).
- [Temporal: Beyond State Machines](https://temporal.io/blog/temporal-replaces-state-machines-for-distributed-applications) and [Understanding Temporal](https://docs.temporal.io/evaluate/understanding-temporal) — event-sourced replay, idempotency tokens (MEDIUM, pattern corroboration).
- [The Orchestration of Multi-Agent Systems: Architectures, Protocols, and Enterprise Adoption (arXiv)](https://arxiv.org/html/2601.13671v1) and [Interpretable Context Methodology: Folder Structure as Agentic Architecture (arXiv)](https://arxiv.org/pdf/2603.16021) — filesystem-as-orchestration, single-writer/monotonic-artifact, turn-organization findings (MEDIUM).
- [Multi-Agent Orchestration: A Practical Architecture — Augment Code](https://www.augmentcode.com/guides/multi-agent-orchestration-architecture-guide) — component-boundary patterns (LOW/MEDIUM, vendor blog).

---
*Architecture research for: vendor-neutral multi-agent adversarial review orchestration*
*Researched: 2026-06-04*
