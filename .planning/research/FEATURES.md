# Feature Research

**Domain:** Vendor-neutral multi-agent adversarial review orchestration (coordinating frontier-model CLIs through a 6-phase protocol)
**Researched:** 2026-06-04
**Confidence:** MEDIUM-HIGH (disagreement-resolution backed by recent peer-reviewed evidence; competitor feature set from current ecosystem surveys and the project's own proven case study)

---

## Executive Orientation

This project sits at the intersection of three product categories, none of which fully covers it:

1. **Multi-agent orchestration frameworks** (LangGraph, CrewAI, AutoGen/AG2) — strong on run management, state/checkpointing, human-in-the-loop, but single-runtime and library-shaped, not protocol-shaped. They orchestrate *one vendor's models or APIs*, not independent vendor CLIs.
2. **Multi-CLI coding orchestrators** (Dex, Bernstein, Signum, agentmaxxing, llmtrio, multi_mcp) — actually drive `claude` / `codex` / `gemini` CLIs in parallel, often with git-worktree isolation. Closest competitors. But they optimize for *parallel task throughput* (decompose → launch → merge), not *adversarial review of a single artifact*.
3. **Multi-agent debate (MAD) research** — the academic literature on how N agents reach a decision. This is where the project's deferred decision (disagreement resolution) gets answered with evidence.

The project's distinctive position: it is the only one of the three categories that treats **adversarial review of a single document as the unit of work**, enforces **independence to preserve cross-vendor blind-spot diversity**, and produces a **decision record** as a first-class output. The case study (`docs-case-study.md`) already proves the protocol manually; this research confirms which surrounding features are table stakes versus differentiating, and resolves the debate-mechanism question.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Every credible orchestrator in categories 1 and 2 has these. Missing them = the tool feels like a toy script, not a system someone trusts with real work.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Run management** (start/track/identify a run) | Every orchestrator (LangGraph, CrewAI, AutoGen, Dex) has a notion of a discrete "run" with an ID | LOW | A run = one document through the 6 phases. Needs a run ID, timestamp, status. Foundation for everything else. |
| **Artifact trail / per-turn artifacts** | The case study already proves this is the core data model; multi-CLI orchestrators all persist intermediate outputs | LOW-MEDIUM | One file per turn (`ARCHITECTURE-claude.md`, `REVIEW-codex.md`, etc.). The artifact-per-turn convention IS the shared workspace. Naming convention must be deterministic. |
| **Resumability / checkpointing** | LangGraph's headline feature; CrewAI/AutoGen require bolt-ons and users complain. A 6-phase, 3-agent run is long and CLIs fail mid-run | MEDIUM | Must resume from last completed phase without re-running prior phases. Filesystem state (artifacts present = phase done) gives this nearly for free if the protocol is artifact-driven. |
| **Structured logging / run transcript** | Debuggability is non-negotiable when coordinating opaque external processes | LOW-MEDIUM | Capture each CLI invocation: command, prompt, exit code, stdout/stderr, duration. Essential for diagnosing a hung/failed agent. |
| **CLI invocation in headless mode** | The whole premise — drive `claude -p`, `codex exec`, `gemini` non-interactively | MEDIUM | All three verified to support headless. Must handle: auth already present, working-directory scoping, timeouts, non-zero exits, partial output. This is the riskiest table-stakes item (see PITFALLS). |
| **Phase gating / turn-taking** | The protocol requires strict sequencing; emergent ordering was the manual bottleneck | MEDIUM | Phase N cannot start until phase N-1 artifacts exist for all agents. Barrier synchronization across agents. |
| **Cost / token tracking** | Every production framework surfaces this; users on subscriptions still want to know spend per run | LOW-MEDIUM | CLIs vary in how they report tokens. May be estimate-based. The case study itself flagged "token reporting" as a needed feature. MEDIUM only because CLI output parsing for usage is inconsistent across vendors. |
| **Error handling: timeout / retry / fail-fast** | Coordinating 3 external processes guarantees one will misbehave per run | MEDIUM | Dex explicitly advertises "automatic retries with backoff." Need per-agent timeout, bounded retry, and a clear failure mode (abort run vs continue degraded). |
| **Configurable agent roster** | Users expect to pick which CLIs participate; extensibility to Grok was an explicit project requirement | LOW-MEDIUM | A config declaring agents (name, CLI command template, model). Adding a vendor = adding a config entry, not code. |
| **Document-type agnosticism (input as parameter)** | Project requires generic-over-document-type; competitors are mostly code-locked | LOW | The document and the task prompt are inputs. No domain logic in v1. This is "table stakes" *for this project's stated scope*, cheap to honor by simply not specializing. |

### Differentiators (Competitive Advantage)

These are where the project wins. They map directly to the Core Value (cross-vendor blind-spot diversity) and to the gaps the case study identified.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Cross-vendor model diversity (enforced)** | The entire reason the tool exists. No mainstream framework enforces *different vendors*; they all run within one runtime or one provider's API | MEDIUM | Differentiator is not "multi-model" (common) but "multi-VENDOR with independence." Out-of-scope guard: single-vendor multi-instance is explicitly rejected. |
| **Independence enforcement (no anchoring)** | The proven source of value — agents must not see each other's drafts before cross-review. MAD research confirms homogeneous/anchored agents lose the diversity advantage | MEDIUM | Enforce by construction: in the drafting phase, each agent's working context contains only the source inputs, never another agent's artifact. This is an *architectural* guarantee, not a prompt instruction. Strong differentiator vs "conversational" frameworks (AutoGen) where agents see shared chat. |
| **Structured review format (numbered issues + severity + questions)** | Makes responses tractable and acceptance/rejection unambiguous; proven in case study (9/10 and 4/7 acceptance rates) | LOW-MEDIUM | Enforce an output schema for reviews: issue #, severity (P1-P3), concrete question. Validate/normalize agent output into this shape. The structure is what made the manual process work. |
| **Response round distinct from merging (accept/reject/refine → decision record)** | The single most valuable process insight: separating "answer the critique" from "rewrite" prevents agents defending/critiquing/rewriting at once | MEDIUM | Each accepted/rejected issue becomes a decision-record entry with rationale. This is both a feature and the primary output artifact. |
| **Designated single integrator after evaluation** | Eliminates the "redundant merge" waste explicitly observed in the manual run | LOW-MEDIUM | After evaluation selects a base, exactly one agent integrates. Role assignment is a protocol step, not a user decision per run. |
| **Decision record output (resolved / open / lineage)** | The durable deliverable. Prevents re-litigation of settled decisions; preserves *why*, not just *what*. No competitor produces this | MEDIUM | Resolved decisions table + open decisions list + artifact lineage graph. The case study produced 13 resolved / 5 open manually — formalize it. |
| **Disagreement resolution mechanism** | The one genuinely unsolved problem from the manual run (last-edit-wins). See dedicated section below — **recommend tiered: integrator-judgment default + human escalation, NOT debate rounds for v1** | MEDIUM-HIGH | Evidence below strongly shapes this. Getting it wrong = the tool produces arbitrary outcomes. |
| **Configurable human gating (autonomous vs phase-gated)** | High-stakes runs (legal) need steering; internal docs run unattended. AutoGen does HITL but conversationally; this is *gate-at-phase-boundary* control | MEDIUM | Two modes: fully autonomous, or pause-for-approval at each phase boundary. Human role shifts from relay to steering (scope, stop, arbitrate). |
| **Filesystem-first / no-runtime-lock-in workspace** | The coordination layer lives *outside* any vendor runtime — a structural requirement competitors in category 1 cannot meet | MEDIUM | The shared workspace is just a directory of artifacts. Any CLI (or human) can read it. This is what makes vendor-neutrality real rather than aspirational. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Real-time agent-to-agent chat / shared conversation** | "Agents collaborating live" sounds powerful; AutoGen's GroupChat popularized it | Destroys independence — shared context = anchoring = blind-spot overlap, the exact failure the project avoids. Also non-deterministic and hard to resume | Turn-based, artifact-mediated protocol (already the project's design). Agents communicate only through committed artifacts at phase boundaries. |
| **Mandatory multi-round debate loop for every disagreement** | MAD papers and "AI debate" hype suggest more rounds = better answers | Strong recent evidence: debate is a martingale — it does *not* systematically improve correctness over voting, can converge to wrong answers via peer influence, costs N× tokens per round, and 5+ rounds can *degrade* results | Single structured response round + integrator judgment + human escalation. Reserve any debate as an opt-in v2 experiment, not the default. |
| **Self-judging by a participating agent (LLM-as-judge from the roster)** | "Just have one agent score the others" is cheap and obvious | Self-preference bias (NeurIPS 2024) and family bias are real and large — models favor their own / same-vendor outputs; frontier judges exceed 50% error on bias benchmarks; position bias too | If a judge is used, it must (a) be cross-vendor relative to the work it judges, (b) evaluate blinded/position-randomized artifacts, and (c) be a fallback, not the primary mechanism. Prefer evidence-grounded integrator selection (as the case study did) over opinion-based scoring. |
| **Single-vendor multi-instance "diversity"** | Cheaper, simpler, one auth, one CLI | Same training = same blind spots = no error correction. Defeats the entire premise. Already in project Out-of-Scope | Require ≥2 distinct vendors; warn/refuse if roster is single-vendor. |
| **Web UI / dashboard for v1** | llmtrio and Parallel Code ship dashboards; looks polished | Pulls effort from the protocol (the actual hard problem) into UI plumbing; the filesystem-first design is the differentiator. Already Out-of-Scope | CLI + readable artifact directory. A dashboard can read the same filesystem later if validated. |
| **Direct vendor API/SDK integration** | More control, structured token usage, no CLI parsing | Forces the coordination layer *inside* a provider's surface, breaks vendor-neutrality, and loses the user's existing CLI auth/subscriptions. Already Out-of-Scope | Drive installed CLIs as black boxes. Accept estimated token reporting as the cost. |
| **Auto-merge every accepted suggestion** | Faster, less human friction | Case study's #1 named anti-pattern ("merging every suggestion immediately"); reintroduces fixed errors, reopens settled scope | Review additions *before* patching (integrator may refine/reject); honor the resolved-decisions table as a guard against re-litigation. |
| **Domain-specific features in v1 (citation checks, filing formats)** | Roscoe is a legal platform; tempting to build legal logic now | Premature specialization; document type is a parameter. Couples v1 to one domain before the protocol is proven | Keep document type a pure input. Add domain plugins post-validation. |
| **Unbounded autonomous runs (no stop condition)** | "Let the agents keep improving" | No convergence guarantee; cost grows; case study shows late broad review *reopens settled scope* | Fixed 6-phase protocol with a defined terminal state. Human gating for high-stakes. |

---

## Disagreement Resolution: Evidence-Based Recommendation

This was the explicitly deferred decision. The candidates were: majority vote, structured debate rounds, judge model, human escalation. Here is what the evidence says.

### The Four Candidates Compared

| Mechanism | What It Is | Evidence For | Evidence Against | Cost | Fit for This Project |
|-----------|-----------|--------------|------------------|------|----------------------|
| **Majority vote** | With 3+ agents, take the answer ≥2 share | "Debate or Vote" (arXiv 2508.17536): voting matches or *beats* debate across 7 benchmarks; simpler, more reliable; improves as agents scale | Unreliable when agents share biases or the correct answer is the minority view; only works when outputs are *comparable discrete answers* | LOW (no extra rounds) | PARTIAL. Works for discrete decisions (which base doc? accept/reject an issue?). Does NOT work for synthesizing prose. A 3-vendor roster makes it *possible* (the project's stated structural advantage). |
| **Structured debate rounds** | Agents argue across iterative rounds until convergence | Popular in literature; occasionally helps on math/factual tasks | Martingale result: no systematic improvement over the initial ensemble; can converge to *wrong* answers via peer pressure; 5+ rounds degrade; N× token cost per round; re-introduces anchoring | HIGH | POOR for v1. High cost, weak evidence, and it reintroduces the anchoring the project works to prevent. Defer as opt-in experiment. |
| **Judge model** | A separate LLM evaluates and decides | Useful as a fallback; cross-vendor judge reduces self-preference | Self-preference bias, family bias, position bias, verbosity bias; no frontier judge is uniformly reliable (>50% error on hard bias benchmarks) | MEDIUM | CONDITIONAL. Only acceptable if cross-vendor, blinded, and position-randomized — and even then as a tie-breaker, not primary. |
| **Human escalation** | Surface unresolved disagreements to the human | Project already designs for human-as-steering; high-stakes (legal) work demands it; zero model bias | Requires a human; not "fully autonomous" | LOW (human time) | STRONG. Aligns with the configurable-gating differentiator. The right *final* backstop. |

### Recommended Mechanism (tiered, evidence-grounded)

The case study already demonstrated a mechanism that beat last-edit-wins **without** debate or voting: **evidence-grounded integrator judgment.** Claude evaluated both merged drafts and chose Codex's base citing *three specific, verifiable technical reasons* (grounded in actual repo behavior). The error-correction table shows nearly every resolution was settled by *appeal to evidence*, not by argument-winning or vote-counting.

Recommended tiered resolution for v1:

1. **Default — Evidence-grounded integrator decision.** During evaluation/integration, the designated integrator resolves each disagreement by citing concrete evidence (source behavior, internal contradiction, the resolved-decisions table). Every resolution is logged to the decision record with its rationale. This is what *actually worked* manually and costs nothing extra.
2. **Tie-breaker (3+ agents) — Majority signal on discrete choices.** For decisions that reduce to a comparable discrete answer (which base document, accept vs reject an issue), use the agents' positions as a majority signal. Backed by the strongest evidence in the literature, and the project's 3-vendor roster was chosen specifically to unlock this. Cheap and reliable for *discrete* decisions only.
3. **Escalation — Human arbitration.** Any disagreement the integrator cannot resolve on evidence, and that has no clear majority, is surfaced as an *open decision* to the human (always in phase-gated mode; logged for review in autonomous mode). Matches the project's steering model.
4. **Explicitly deferred to v2 — Debate rounds and judge-model scoring.** Evidence does not justify the cost/complexity for v1. If added later, judge must be cross-vendor + blinded + position-randomized; debate must preserve correct answers across rounds (MAD-Conformist/Follower style) rather than allowing free belief updates.

**Bottom line:** Do NOT build a debate loop for v1. Build evidence-grounded integrator resolution + majority signal on discrete forks + human escalation. This matches both the proven manual process and the best current evidence, at the lowest complexity.

---

## Feature Dependencies

```
Run management (run ID + status)
    └──requires──> Artifact trail (per-turn files)
                       └──requires──> Phase gating / turn-taking
                                          └──requires──> Headless CLI invocation
                                                             └──requires──> Configurable agent roster

Resumability ──requires──> Artifact trail (filesystem state = progress)
Structured logging ──requires──> Headless CLI invocation
Cost tracking ──requires──> Headless CLI invocation (parse usage from output)

Independence enforcement ──requires──> Phase gating (drafting phase isolates context)
Structured review format ──requires──> Independence enforcement (reviews follow independent drafts)
Response round / decision record ──requires──> Structured review format
Designated integrator ──requires──> Evaluation phase complete
Disagreement resolution ──requires──> Decision record (logs every resolution)
                          └──enhanced by──> Configurable human gating (escalation target)
                          └──enhanced by──> 3+ vendor roster (enables majority signal)

Configurable human gating ──requires──> Phase gating (gates ARE phase boundaries)

Real-time agent chat ──conflicts──> Independence enforcement
Mandatory debate loop ──conflicts──> Independence enforcement (reintroduces anchoring) + low-cost ethos
Self-judging roster agent ──conflicts──> Cross-vendor diversity (self/family bias)
```

### Dependency Notes

- **Everything rests on headless CLI invocation + artifact trail.** These two are the load-bearing foundation; if CLI driving is unreliable, no higher feature works. Build and harden these first.
- **Resumability is nearly free if the protocol is artifact-driven:** presence of phase-N artifacts = phase N done. Designing the artifact convention well buys checkpointing without separate state machinery.
- **Phase gating is the spine.** Independence, human gating, and turn-taking are all expressed as behaviors at phase boundaries.
- **Disagreement resolution depends on the decision record** existing to log resolutions, and is *enhanced* (not required) by the 3+ vendor roster (majority signal) and human gating (escalation target).
- **The two big conflicts** (real-time chat, mandatory debate) both conflict with independence enforcement — the project's Core Value. This is why they are anti-features, not deferrals.

---

## MVP Definition

### Launch With (v1) — the stated v1 success bar: a complete 3-agent run finishing all 6 phases with a decision record

- [ ] **Headless CLI invocation** for claude/codex/gemini with timeout + bounded retry — nothing works without it
- [ ] **Configurable agent roster** (≥2 vendors enforced) — enables vendor-neutrality and Grok extensibility
- [ ] **Artifact trail** with deterministic per-turn naming — the shared workspace and data model
- [ ] **Phase gating / turn-taking** through all 6 phases — the encoded protocol
- [ ] **Independence enforcement** in drafting — the Core Value; cheap to enforce by construction
- [ ] **Structured review format** (numbered issues + severity + questions) — proven essential
- [ ] **Response round → decision record** (accept/reject/refine with rationale) — the durable output
- [ ] **Designated integrator** after evaluation — eliminates redundant-merge waste
- [ ] **Tiered disagreement resolution** (integrator-evidence default + human escalation; majority signal optional) — the deferred decision, now resolved
- [ ] **Decision record output** (resolved / open / lineage) — the deliverable
- [ ] **Run management + structured logging** — basic trustworthiness/debuggability
- [ ] **Configurable human gating** (autonomous OR phase-gated) — needed to run the protocol attended or unattended

### Add After Validation (v1.x)

- [ ] **Cost/token tracking per run** — trigger: users ask "what did this run cost?"; deferred only because CLI usage parsing is fiddly, not because it's unimportant
- [ ] **Resumability from arbitrary failed phase** (beyond the free filesystem-state resume) — trigger: first time a 6-phase run dies at phase 4 and re-running phases 1-3 is painful
- [ ] **Majority-signal tie-breaking on discrete forks** (if not in v1) — trigger: integrator-only resolution proves arbitrary on base-document selection
- [ ] **Run comparison / metrics dashboard (read-only, filesystem-based)** — trigger: enough runs to want aggregate stats

### Future Consideration (v2+)

- [ ] **Opt-in structured debate rounds** (MAD-Conformist/Follower style) — defer: evidence doesn't justify cost; only after the simple protocol is proven
- [ ] **Cross-vendor blinded judge model as tie-breaker** — defer: bias-mitigation work required; integrator+escalation suffices first
- [ ] **Grok/xAI agent** — defer: no CLI installed yet (architecture must allow it; don't build it)
- [ ] **Domain plugins (legal citation checks, filing formats)** — defer: document type stays a parameter until protocol is validated
- [ ] **Web UI / dashboard** — defer: filesystem-first is the v1 differentiator

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Headless CLI invocation | HIGH | MEDIUM | P1 |
| Artifact trail (per-turn) | HIGH | LOW | P1 |
| Phase gating / turn-taking | HIGH | MEDIUM | P1 |
| Independence enforcement | HIGH | MEDIUM | P1 |
| Structured review format | HIGH | LOW | P1 |
| Response round → decision record | HIGH | MEDIUM | P1 |
| Designated integrator | HIGH | LOW | P1 |
| Tiered disagreement resolution | HIGH | MEDIUM | P1 |
| Decision record output | HIGH | MEDIUM | P1 |
| Configurable agent roster (≥2 vendors) | HIGH | LOW | P1 |
| Configurable human gating | HIGH | MEDIUM | P1 |
| Run management + logging | MEDIUM | LOW | P1 |
| Cost / token tracking | MEDIUM | MEDIUM | P2 |
| Robust resumability | MEDIUM | MEDIUM | P2 |
| Majority-signal tie-breaking | MEDIUM | LOW | P2 |
| Debate rounds (opt-in) | LOW | HIGH | P3 |
| Cross-vendor judge model | LOW | HIGH | P3 |
| Grok agent | LOW | LOW | P3 |
| Domain plugins | LOW | MEDIUM | P3 |
| Web UI / dashboard | LOW | HIGH | P3 |

**Priority key:** P1 = must have for launch · P2 = should have, add when possible · P3 = nice to have / future

---

## Competitor Feature Analysis

| Feature | Multi-agent frameworks (LangGraph/CrewAI/AutoGen) | Multi-CLI orchestrators (Dex/Bernstein/Signum/llmtrio) | MAD research systems | Our Approach |
|---------|---------------------------------------------------|--------------------------------------------------------|----------------------|--------------|
| Cross-vendor diversity | No (single runtime/provider) | Yes (drive claude/codex/gemini CLIs) | Sometimes (heterogeneous agents studied) | Yes, **enforced** (≥2 vendors) |
| Independence enforcement | No (shared chat/state common) | Partial (worktree isolation for parallel tasks) | Varies | Yes, by construction in drafting |
| Checkpointing/resume | LangGraph yes; CrewAI/AutoGen bolt-on | Partial (worktrees) | N/A | Filesystem-state native + explicit resume v1.x |
| Human-in-the-loop | Yes (conversational) | Yes (Dex "human-gated planning") | Rare | Phase-boundary gating, autonomous/gated modes |
| Adversarial review of one artifact | No (task throughput focus) | No (parallel-task throughput focus) | Yes (debate over answers) | Yes — **the core unit of work** |
| Decision record output | No | No | No (produces an answer, not a record) | Yes — resolved/open/lineage, first-class |
| Disagreement resolution | Workflow-defined / orchestrator-coded | Mostly human-merged or last-writer | Vote / debate / judge | Tiered: evidence-integrator + escalation (+ majority signal) |
| Retries/backoff | Yes | Yes (Dex advertises) | N/A | Yes (P1 table stakes) |
| Cost tracking | Yes (API usage) | Varies | Token cost reported in papers | Estimate-based (CLI parsing), P2 |

---

## Sources

Disagreement resolution (load-bearing evidence):
- [Debate or Vote: Which Yields Better Decisions in Multi-Agent LLMs? (arXiv 2508.17536)](https://arxiv.org/html/2508.17536v1) — voting matches/beats debate; debate is a martingale; 5+ rounds can degrade. HIGH relevance.
- [Multi-Agent Debate Frameworks overview (EmergentMind)](https://www.emergentmind.com/topics/multi-agent-debate-mad-frameworks) — taxonomy of aggregation: majority vote, judge agents, convergence stopping.
- [Justice or Prejudice? Quantifying Biases in LLM-as-a-Judge (arXiv 2410.02736)](https://arxiv.org/html/2410.02736v1) — judge bias taxonomy.
- [Self-Preference Bias in LLM-as-a-Judge (arXiv 2410.21819)](https://arxiv.org/abs/2410.21819) — models favor own outputs; scales with capability.
- [Judging the Judges: Position Bias in LLM-as-a-Judge (arXiv 2406.07791)](https://arxiv.org/abs/2406.07791) — U-shaped position bias across 150k instances.
- [LLM-as-a-Judge reliability/bias (Adaline)](https://www.adaline.ai/blog/llm-as-a-judge-reliability-bias) — frontier judges >50% error on bias benchmarks (cites RAND).

Competitor / ecosystem feature set:
- [CrewAI vs LangGraph vs AutoGen (DataCamp)](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen) — orchestration models, checkpointing, HITL.
- [LangGraph vs CrewAI vs AutoGen 2026 (Pockit/DEV)](https://dev.to/pockit_tools/langgraph-vs-crewai-vs-autogen-the-complete-multi-agent-ai-orchestration-guide-for-2026-2d63) — state persistence comparison.
- [Agentmaxxing: Parallel Multi-CLI Orchestration (Daniel Vaughan)](https://codex.danielvaughan.com/2026/04/11/agentmaxxing-parallel-multi-cli-orchestration/) — worktree isolation, decompose→launch→review→merge, review-bottleneck anti-pattern, unresolved merge-conflict resolution.
- [Multi-agent LLM orchestrator (DEV, ji_ai)](https://dev.to/ji_ai/building-a-multi-agent-llm-orchestrator-with-claude-code-86-sessions-of-hard-won-lessons-13n6) — parallel claude/gpt/gemini lessons.
- [awesome-agent-orchestrators (GitHub)](https://github.com/andyrewlee/awesome-agent-orchestrators) — Dex, Bernstein, Signum, llmtrio feature descriptions.
- [multi_mcp (GitHub)](https://github.com/religa/multi_mcp) — multi-model consensus code review via CLI.

Proven internal process (the manual case study):
- `docs-case-study.md` (this repo) — the 6-phase protocol, structured reviews, accept/reject rounds, evidence-grounded integrator selection, decision record, named anti-patterns. HIGH relevance, primary source.

---
*Feature research for: vendor-neutral multi-agent adversarial review orchestration*
*Researched: 2026-06-04*
