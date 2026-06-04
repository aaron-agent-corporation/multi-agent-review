# Project Research Summary

**Project:** multi-agent-review (Roscoe)
**Domain:** Vendor-neutral multi-agent adversarial review orchestration (driving heterogeneous frontier-model CLIs through a 6-phase, artifact-on-filesystem review protocol)
**Researched:** 2026-06-04
**Confidence:** HIGH

## Executive Summary

This is a *protocol* tool, not a framework tool. It coordinates the user's already-authenticated AI CLIs — `claude -p`, `codex exec`, `gemini -p` — as black-box subprocesses, exchanging work through plain files on disk, to run a single document through a proven 6-phase adversarial review (draft → cross-review → respond → evaluate → integrate → validate) that ends in a decision record. The whole reason it exists is *cross-vendor blind-spot diversity*: differently-trained models catch each other's errors, but only if they draft **independently** before reviewing. The closest prior art (AWS `cli-agent-orchestrator`, the agentmaxxing family) optimizes parallel task throughput via live MCP/message-passing — the exact opposite of what this project needs. No mainstream framework (LangGraph/CrewAI/AutoGen) does cross-vendor adversarial review of one artifact with a decision-record output. This product is genuinely differentiated, and the case study in-repo already proves the manual protocol works.

The recommended build is deliberately thin: **a filesystem protocol plus a single-process runner exposed as a CLI**, built in **TypeScript/Node 22 (ESM)** using **execa** for subprocess control, **XState v5** for the 6-phase state machine, and **zod** for validating the heterogeneous JSON each CLI returns. The filesystem *is* the database, the message queue, and the audit log: run state is derived from which artifacts exist on disk, which makes resumability nearly free and the whole run debuggable with `ls`. The single most important architectural asset is the **typed per-vendor adapter layer** — because the CLIs are changing fast (Codex was rebuilt in Rust on GPT-5.5; **Gemini CLI is being retired to Antigravity CLI with a June 18, 2026 free-tier cutoff**), each CLI must be a swappable adapter and the vendor-neutral protocol must never branch on agent name.

The risks split into two surfaces. **Mechanical:** the CLIs hang in headless mode (no human to kill the spinner), break flags/JSON between versions, hit shared subscription rate limits, and re-prompt for sandbox approval — every invocation needs an external timeout, version pinning, pre-flight auth checks, and JSON-schema validation. **Epistemic** (the higher-stakes surface): the system can run flawlessly yet *fail silently* through sycophancy and anchoring — agents that see each other's drafts collapse into polite consensus, destroying the only value the tool provides. Mitigation is structural: enforce independence by *workspace-scoping* (an agent physically cannot read a peer's draft until promotion at the phase boundary), not by prompt instruction. The evidence is also clear that **debate loops are an anti-feature for v1** — voting matches or beats debate, debate amplifies bias and has no termination guarantee. Resolve disagreements with evidence-grounded integrator judgment plus human escalation, exactly as the manual case study did.

## Key Findings

### Recommended Stack

Build a vendor-neutral Node orchestrator that shells out to all CLIs equally; do NOT use vendor SDKs/APIs (breaks vendor-neutrality, re-solves auth) and do NOT build a pure-shell orchestrator (typed artifact schemas, three different JSON shapes, a resumable state machine, and parallel-with-failure-handling all become fragile in bash). See `STACK.md` for the full verified headless-invocation flag reference per CLI — that table is load-bearing and should be pinned in adapter tests.

**Core technologies:**
- **Node 22 LTS + TypeScript 5.6+ (ESM)** — runtime/language; the orchestrator is I/O-bound (waiting on subprocesses), Node's strength; types enforce the adapter interface, phase enums, and artifact schemas at compile time.
- **execa 9.x** — subprocess execution; separate stdout/stderr capture (critical: Codex puts progress on stderr, the answer on stdout), timeouts, graceful kill, no shell injection. Far better than raw `child_process`.
- **XState v5** — the 6-phase protocol IS a statechart with gates, parallel drafting, guards, and persist/restore for pause/resume; actor model maps each agent invocation to an actor.
- **zod 3.23+ (+ zod-to-json-schema)** — validate heterogeneous CLI JSON (the #1 runtime breakage source) and define the review-artifact schema once, emitting JSON Schema to feed `claude --json-schema` and `codex --output-schema`.
- Supporting: commander (CLI parsing), pino (NDJSON logs/audit trail), gray-matter (markdown+frontmatter artifacts), p-queue/p-limit (bounded parallel turns), fs-extra (atomic writes), nanoid (run/turn IDs).

### Expected Features

This project sits between multi-agent frameworks, multi-CLI orchestrators, and multi-agent-debate research — and is the only one treating *adversarial review of one document* as the unit of work with a *decision record* as a first-class output. See `FEATURES.md` for the full prioritization matrix and the evidence-based disagreement-resolution analysis.

**Must have (table stakes + core differentiators for v1):**
- Headless CLI invocation (claude/codex/gemini) with timeout + bounded retry — nothing works without it
- Configurable agent roster, **≥2 distinct vendors enforced** (extensible to Grok)
- Artifact trail with deterministic per-turn naming (the shared workspace and data model)
- Phase gating / turn-taking through all 6 phases (the encoded protocol spine)
- **Independence enforcement** in drafting (the Core Value, enforced by construction)
- Structured review format (numbered issues + severity + concrete questions)
- Response round → decision record (accept/reject/refine with rationale)
- Designated single integrator after evaluation (kills redundant-merge waste)
- **Tiered disagreement resolution** (evidence-grounded integrator default + human escalation; majority signal optional)
- Decision record output (resolved / open / lineage)
- Run management + structured logging; configurable human gating (autonomous OR phase-gated)

**Should have (v1.x, add after validation):**
- Cost/token tracking per run (deferred only because CLI usage parsing is fiddly)
- Robust resumability from an arbitrary failed phase (beyond the free filesystem-state resume)
- Majority-signal tie-breaking on discrete forks (if not in v1)

**Defer (v2+) — and explicit anti-features:**
- Opt-in structured debate rounds, cross-vendor blinded judge model — evidence does not justify cost/complexity for v1
- Grok agent (no CLI installed; architecture must *allow* it, don't build it)
- Domain plugins (legal citation checks) — document type stays a parameter; web UI/dashboard
- **Anti-features (do NOT build):** real-time agent-to-agent chat, mandatory debate-until-consensus loops, self-judging by a roster agent, single-vendor multi-instance "diversity", auto-merge every suggestion, direct vendor APIs — all conflict with independence or proven cost/quality evidence.

### Architecture Approach

Recommended form: **filesystem protocol + thin runner, exposed as a CLI.** The filesystem is the single source of truth — run state is *derived* from which artifacts exist (`manifest.json` as the authoritative index), so there is no in-memory state to lose, resume is nearly free, and the run is auditable with standard tools. Reject any version that holds run state in process memory, and reject a daemon/message-bus for v1 (the protocol is turn-based by design). See `ARCHITECTURE.md` for the full component diagram, project structure, and dependency-driven build order.

**Major components:**
1. **Shared Workspace (filesystem + manifest)** — holds all run state/artifacts; *is* the durable checkpoint and audit trail. `runs/<id>/` with per-phase artifact directories.
2. **Agent Adapter Layer** — one module per vendor implementing a shared `AgentAdapter` interface (`invoke(TurnRequest) → TurnResult`); all vendor flags/sandbox/JSON-parsing live here. The protocol speaks only the normalized contract.
3. **Orchestration Layer** — Phase State Machine (6 phases), Turn Scheduler (expand roster → ordered turns), Gate Controller (sentinel-file human gating), and the **Independence Enforcer** (per-turn visibility allow-list; workspace-scoped, with pending→promoted artifact promotion at the Phase 1→2 boundary).
4. **Runner Engine + Decision Record assembly** — the loop (read state → pick turn → invoke → write); resume = re-derive from disk, skip completed turns.

### Critical Pitfalls

See `PITFALLS.md` for all nine, the "looks done but isn't" checklist, and the pitfall-to-phase map.

1. **Sycophancy / anchoring contamination (highest stakes)** — agents seeing peers' drafts collapse into consensus, silently defeating the entire system. Avoid: enforce independence *structurally* via workspace-scoping (an agent's working dir physically lacks peer drafts until promotion), not by prompt; prompt for critique not praise; verify with a planted-error catch test.
2. **Headless silent hangs** — CLIs hang indefinitely with no human to notice (documented Claude/Gemini hang bugs). Avoid: wrap every invocation in an external wall-clock timeout, detect "done but not exited" and reap, add a liveness heartbeat, make every phase idempotent.
3. **CLI flag/output brittleness across versions** — a routine upgrade silently breaks parsing (Claude reversed `--resume` behavior; Codex trust-by-default changed). Avoid: thin per-CLI adapter, pin+record CLI versions per run with startup detection, validate JSON against an expected schema, per-adapter smoke test.
4. **Auth expiry / rate limits / sandbox prompts breaking unattended runs** — shared subscription buckets, expired OAuth quota demotion, Codex re-prompting in new dirs. Avoid: pre-flight auth probe, treat 429 as retryable with backoff (not fatal), establish Codex trust out-of-band, checkpoint-before-each-phase so a rate-limit pause resumes later.
5. **Degenerate debate / cost runaway** — last-edit-wins, debate amplifying bias with no termination, N² fan-out + retry storms draining a weekly quota. Avoid: separate phases (answer-round before merge), single accountable integrator, hard per-run token budget + circuit breaker, bounded retries, **no open-ended debate loop**.
6. **Over-engineering before the protocol is proven** — building daemon/bus/plugin-system around an unvalidated protocol. Avoid: protocol-first ordering; prove one complete 3-agent run on the thinnest orchestrator before any robustness/extensibility work.

Also flagged: non-determinism breaking resumability (filesystem-as-truth, not CLI session IDs), and **prompt injection / "prompt infection"** across shared artifacts — critical once untrusted legal documents are inputs (treat input as data not instructions, least-privilege agents, output validation between phases).

## Implications for Roadmap

Research points to a **protocol-first, bottom-up build**: harden the load-bearing foundation (headless invocation + artifact workspace), prove independence, run the review/response loop end-to-end to the v1 success bar, then harden around it. The dependency spine is explicit in both ARCHITECTURE.md (build order) and FEATURES.md (dependency graph). Suggested phases:

### Phase 1: Workspace + Single-Adapter Spike
**Rationale:** Everything depends on the artifact-naming schema, the manifest-as-source-of-truth, and proving one CLI can be driven headlessly and reliably. This is also where the timeout/liveness invocation primitive and version pinning must be born.
**Delivers:** `runs/<id>/` layout, manifest read/write, "phase complete?" detection, one working adapter (`claude -p --output-format json`) captured to a file and normalized, external-timeout wrapper, version detection.
**Addresses:** Artifact trail, headless CLI invocation, run management/logging.
**Avoids:** Pitfalls 1 (brittleness — adapter from day one), 2 (hangs — timeout primitive), 7 (resumability — filesystem-as-truth committed early).

### Phase 2: Adapter Layer + Pre-flight + Roster
**Rationale:** Generalize the proven invocation contract into the `AgentAdapter` interface across all three vendors; the adapter must own each vendor's stdout/stderr split, sandbox flags, and JSON shape so the protocol never branches on vendor.
**Delivers:** Claude/Codex/Gemini adapters + registry, pre-flight auth probe per CLI, configurable roster (≥2 vendors enforced), rate-limit/429 backoff.
**Uses:** execa (stream split), zod (validate each vendor's JSON), commander (roster config).
**Implements:** Agent Adapter Layer.
**Avoids:** Pitfalls 3 (version drift), 4 (auth/rate-limit), and Anti-Pattern 3 (vendor flags leaking into protocol).

### Phase 3: Phase State Machine + Scheduler + Independence Enforcer
**Rationale:** Encode the 6 phases and turn expansion as pure functions over the manifest (testable with fixtures, no CLIs), then layer the load-bearing correctness mechanism: workspace-scoped independence with pending→promoted artifact promotion at the Phase 1→2 boundary.
**Delivers:** 6-phase XState machine, turn scheduler (N×(N−1) cross-review expansion), Independence Enforcer + promotion gate.
**Implements:** Orchestration Layer; Pattern 3 (independence via visibility policy).
**Avoids:** Pitfall 5 (anchoring/sycophancy) — the single highest-stakes pitfall. **This phase needs an explicit verification gate: a planted-error catch test.**

### Phase 4: Runner Engine — First End-to-End Run (v1 success bar)
**Rationale:** Tie scheduler + enforcer + adapters + workspace into the loop and achieve the explicit v1 success bar: one complete 3-agent run through all 6 phases producing a decision record. Includes the structured review format, response round, designated integrator, and tiered evidence-grounded disagreement resolution (escalate-to-human as the v1 backstop).
**Delivers:** Working end-to-end protocol; structured reviews; response/decision-record entries; designated-integrator merge; DECISION-RECORD.md assembly.
**Addresses:** Structured review format, response round → decision record, designated integrator, decision record output, tiered disagreement resolution.
**Avoids:** Pitfall 6 (last-edit-wins — single integrator + answer-round before merge), Pitfall 9 (over-engineering — this is the minimal proof).

### Phase 5: Hardening — Resume, Gating, Budgets, Injection Defense
**Rationale:** Robustness hardens *around* a working protocol, not before it. Resume falls out nearly free once the engine exists; gating, cost circuit-breakers, and least-privilege/input-delimiting are additive.
**Delivers:** Crash-mid-turn-safe resume (atomic temp-write + rename), sentinel-file human gating (autonomous/phase-gated), per-run + per-agent token budgets with circuit breaker, least-privilege agent invocation + between-phase output validation, input-as-untrusted-data framing.
**Addresses:** Robust resumability, configurable human gating, cost tracking.
**Avoids:** Pitfalls 4 (checkpoint/resume after rate-limit window), 5/6 (cost runaway, retry storms), 8 (prompt injection — elevated for legal documents).

### Phase Ordering Rationale
- **Bottom-up by dependency:** workspace → adapter → protocol → runner is the strict dependency spine; each layer is testable against real files before the layer above exists (ARCHITECTURE build order; FEATURES dependency graph — "everything rests on headless CLI invocation + artifact trail").
- **Independence before the full loop:** anchoring is the highest-stakes failure, so the structural enforcer (Phase 3) lands *before* the first full run and gets its own verification gate, not bolted on later.
- **Protocol-first, robustness-after:** Pitfall 9 (over-engineering) dictates that resume/gating/budgets/injection-defense (Phase 5) come only after the v1 success bar (Phase 4), so machinery isn't built around an unvalidated protocol.
- **Anti-features stay out:** no debate loop, message bus, judge model, or vendor SDKs appear in any phase — they conflict with independence or lack supporting evidence.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** JSON Schema dialect parity — confirm empirically that one zod-generated schema is honored by both `claude --json-schema` and `codex --output-schema`, and how Gemini handles structured output (STACK open question #1, MEDIUM confidence; needs a spike).
- **Phase 5 / post-v1:** the debate/disagreement mechanism beyond evidence-integrator + human escalation (majority vote with 3+ agents, cross-vendor blinded judge) — flagged in PROJECT.md as the genuinely unsolved problem; v2 only, must be cross-vendor + blinded + position-randomized if built.
- **Phase 5:** prompt-injection / least-privilege defense for untrusted legal documents — elevated once the Roscoe use case is in scope.

Phases with standard patterns (lighter research):
- **Phase 1 & 4:** filesystem-as-state-machine and the runner loop are well-corroborated patterns (durable-execution lite); the in-repo case study already proves the protocol shape.
- **Phase 3:** the 6 phases and turn expansion are pure functions over fixtures — established statechart territory with XState.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | CLI invocation flags verified against official docs (June 2026); execa/XState/zod combination is the mature, best-documented fit. MEDIUM only on long-term CLI stability (vendor churn). |
| Features | MEDIUM-HIGH | Disagreement-resolution backed by recent peer-reviewed evidence; competitor set from current ecosystem surveys + the project's own proven manual case study. |
| Architecture | HIGH | CLI modes verified against official docs; orchestration patterns corroborated by multiple sources and the in-repo case study; the filesystem-as-truth form is unusually well-matched to the domain. |
| Pitfalls | HIGH | CLI-mechanics pitfalls from official docs + tracked GitHub issues; debate-dynamics pitfalls from recent research. MEDIUM only on cost/scale thresholds (vendor-dependent). |

**Overall confidence:** HIGH

### Gaps to Address
- **JSON Schema cross-vendor parity:** unverified that one schema satisfies both Claude and Codex structured-output flags, and Gemini's schema-constraint support is under-documented. Handle with a Phase 2 spike before committing the single-schema design.
- **Claude `-p` billing change (June 15, 2026):** subscription `-p` usage may draw from a separate Agent SDK credit pool. Re-validate the "existing subscriptions cover usage" assumption in PROJECT.md.
- **Gemini → Antigravity CLI (June 18, 2026):** free Google AI Pro/Ultra tiers lose Gemini CLI access. Confirm the user's tier; keep Gemini behind a swappable adapter; scope an Antigravity CLI adapter as a near-term follow-on.
- **Session resume vs. fresh context per turn:** recommendation is fresh, stateless invocation per turn for v1 (independence stays auditable, sidesteps unstable CLI session bugs); revisit only if quality suffers.
- **Sycophancy detection is hard post-hoc:** prevention >> recovery. The planted-error catch test (Phase 3 gate) and issues-per-review/acceptance-rate metrics are the practical detection mechanisms.

## Sources

### Primary (HIGH confidence)
- Claude Code headless docs (`code.claude.com/docs/en/headless`) — `-p`, `--output-format json`, `--json-schema`, `--bare`, `--resume`, billing note.
- Codex non-interactive docs + CLI reference (`developers.openai.com/codex/...`) — `codex exec`, `--json`, `--output-schema`, stdout/stderr split, sandbox.
- Gemini CLI headless docs + Antigravity transition announcement (`developers.googleblog.com`) — flags + June 18, 2026 cutoff.
- Tracked GitHub issues — Claude #8207/#8069/#26224/#25629/#53417, Codex #14068/#14345, Gemini #24384/#22648/#17906 (resume/hang/sandbox/auth bugs).
- execa (npm) and XState v5 (stately.ai) docs.
- In-repo `docs-case-study.md` — proven 6-phase protocol, artifact-per-turn convention, anti-patterns; `.planning/PROJECT.md` — requirements, v1 success bar.

### Secondary (MEDIUM confidence)
- "Debate or Vote" (arXiv 2508.17536) — voting matches/beats debate; debate is a martingale.
- Sycophancy/failure-mode MAD research (arXiv 2509.23055, 2509.05396, 2305.19118); bias-amplification (2505.19477); LLM-as-judge bias (2410.02736, 2410.21819, 2406.07791).
- Prompt Infection (arXiv 2410.07283), cross-user contamination (2604.01350).
- AWS `cli-agent-orchestrator` (closest prior art; coordination model differs); agentmaxxing / awesome-agent-orchestrators ecosystem surveys.
- LangGraph/Restate/Temporal durable-execution docs (pattern corroboration); "The Multi-Agent Trap" (cost/over-engineering).

### Tertiary (LOW confidence)
- Vendor blog architecture guides (Augment Code) — component-boundary patterns.
- Curated awesome-lists (CLI orchestrators / agentmaxxing pattern).

---
*Research completed: 2026-06-04*
*Ready for roadmap: yes*
