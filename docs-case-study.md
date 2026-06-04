# Multi-Agent Adversarial Review Process — Case Study

Date: 2026-05-25
Participants: Claude (Opus) via Claude Code CLI, Codex via Codex CLI
Facilitator: Human (copy-paste relay between CLIs)
Project: Code-KG unified architecture

## Purpose

This document records the manual multi-agent collaboration process used to
produce the final Code-KG architecture. It is intended as evidence and source
material for a later project that formalizes agent-to-agent collaboration
without requiring a user to copy outputs between tools.

The defining feature of the process is **model diversity**: the agents were
frontier models from different vendors (Claude and Codex), each with different
training, biases, and blind spots. The useful behavior came from independent
proposals followed by explicit cross-review and answer rounds — not from
either agent being consistently right. A future system should preserve this
cross-vendor property, scaling to two, three, or four frontier-model agents
(e.g., Claude, Codex, Gemini CLI, xAI/Grok).

This is not an implementation design for that future project. It does not
propose transport, orchestration, scheduling, identity, permissions, or runtime
mechanisms. It only documents the process that happened and the collaboration
pattern that proved useful.

## Participants and Roles

- **User/facilitator**: carried artifacts between agents, selected the next
  prompt, made sequencing decisions, and asked for specific review or merge
  steps. Did not author any architectural content.
- **Codex**: produced architecture drafts, critiques, answer documents, and
  final patches in the local workspace.
- **Claude**: independently produced architecture drafts, critiques, answers,
  and suggested additions through a separate CLI.

## Source Context

The subject was a proposed unified project combining two existing folders:

- `graphify-7`: automatic repository discovery and graph analysis.
- `lat.md-main`: markdown-based project memory, links, search, validation, and
  agent-facing query tools.

The architectural goal was to combine Graphify's extraction/bootstrap strengths
with lat.md's durable, reviewable knowledge layer.

## Artifact Trail

The working artifacts are archived in this folder:

- `_archive/ARCHITECTURE-codex.md`
- `_archive/ARCHITECTURE-claude.md`
- `_archive/CLAUDE_ARCHITECTURE_REVIEW.md`
- `_archive/REVIEW-codex-architecture.md`
- `_archive/CODEX_RESPONSE_TO_CLAUDE_REVIEW.md`
- `_archive/CLAUDE_ANSWERS.md`
- `_archive/ARCHITECTURE-merged-codex.md`
- `_archive/ARCHITECTURE-merged-claude.md`
- `_archive/ADDITIONS-for-codex-merged.md`

The final output of the session was `ARCHITECTURE.md` (promoted from
`ARCHITECTURE-merged-codex.md`). **That file has been intentionally removed
from this folder** — the architecture is being rebuilt from scratch. The
archived artifacts remain as the evidence trail for the process itself.

The artifact sequence matters because each file represents one turn in the
collaboration, not just a static document.

## Process Summary

```text
shared context
  -> independent architecture drafts
  -> cross-review
  -> answer the reviews
  -> produce competing merged drafts
  -> compare merged drafts and choose a base
  -> patch best ideas into the base
  -> targeted final critique
  -> final architecture
```

Each stage had a narrow job. Drafting, reviewing, answering, merging, and final
patching were separate actions. That separation made the work better because
the agents were not trying to defend, critique, and rewrite at the same time.

## Detailed Timeline

### Phase 0: Initial Repository Review (shared context)

Both agents reviewed the two source projects. The review established a shared
product model:

- Graphify should be treated as the discovery/bootstrap engine.
- lat.md should be treated as the curated, durable memory layer.
- The unified project should bridge automatic extraction into reviewable
  markdown that agents can maintain.

This shared model became the frame for every later critique.

### Phase 1: Independent Drafting

Both agents received the same inputs (source code of both projects) and the
same prompt: review both projects, then discuss a plan to combine them.
Neither agent saw the other's draft.

| Agent | Artifact | Description |
| --- | --- | --- |
| Claude | `ARCHITECTURE-claude.md` | Extraction pipeline detail, materialization pseudocode, confidence rubric, drift detection mechanics, ASCII diagrams, technology decisions, success metrics, open questions |
| Codex | `ARCHITECTURE-codex.md` | MVP phasing (1-4), risks section, git policy, storage layout, agent workflow, merge strategy outline, "what success looks like" narrative |

**Key observation:** The agents converged on the same high-level architecture
(Graphify extracts, lat.md stores, bridge materializes) without coordination.
They diverged on emphasis — Claude produced more implementation detail; Codex
produced more product and process structure. Neither draft was complete on its
own.

### Phase 2: Cross-Review

Each agent reviewed the other's architecture as a critique, not as a rewrite.

| Agent | Artifact | Description |
| --- | --- | --- |
| Claude | `REVIEW-codex-architecture.md` | 10 issues, each with a concrete question for Codex to answer |
| Codex | `CLAUDE_ARCHITECTURE_REVIEW.md` | 7 issues (P1-P3 severity), plus 15 questions for Claude to answer |

Claude's review of Codex found:

- MVP 1 ships lat.md without extraction — that's just lat.md again.
- Merge strategy is undefined — the hardest part is hand-waved.
- Separate `confidence.md` creates review debt nobody will do.
- Community detection algorithm unaddressed.
- No token budget model.
- No materialization quality gates or preview mode.
- `graph query` as an agent tool undermines single source of truth.
- No enforcement mechanism for agent workflow.
- No local search fallback.
- Success criteria are not measurable.

Codex's review of Claude found:

- Generated `lat.md/` layout conflicts with lat.md's actual naming convention
  (`index.md` vs `lat.md/lat.md`).
- TypeScript-only runtime understates Graphify porting and Python bridge work.
- Materialization pseudocode uses raw labels as wiki-link targets, which are
  not stable.
- Source backlink insertion is listed as both a rule and an open question.
- Drift detection needs a precise comparison model (not every edge is drift).
- "Two-phase system" contradicts four defined phases.
- Success metrics need baselines and collection points.

**Key observation:** The reviews were complementary, not redundant. Claude
focused on strategic and product gaps (who uses MVP 1? where's the token
budget?). Codex focused on implementation correctness (wrong filename
convention, unstable IDs, internal contradictions). Both categories of issue
were real. The reviews were useful because they were specific — they cited
concrete architecture claims and asked questions that forced a decision.

### Phase 3: Responses

Each agent answered the review of its own draft. This was different from
immediately merging changes. The answer round forced each agent to classify
feedback: accepted outright, accepted with correction, rejected or reframed,
or deferred as a later implementation concern.

| Agent | Artifact | Description |
| --- | --- | --- |
| Claude | `CLAUDE_ANSWERS.md` | Responses to all 15 of Codex's questions, with concrete design decisions for each |
| Codex | `CODEX_RESPONSE_TO_CLAUDE_REVIEW.md` | Responses to all 10 of Claude's issues, with revised positions and proposed architecture changes |

What changed through responses:

- Claude conceded: `index.md` should be `lat.md/lat.md`, source backlinks
  should be a separate opt-in command, raw labels can't be wiki-link targets,
  the two-phase/four-phase inconsistency is real.
- Codex conceded: MVP 1 must include skeleton bootstrap (not just runtime),
  `confidence.md` needs lifecycle semantics (not just a file), `graph query`
  should be debug-only, token budgets must be explicit, local search must be
  default, materialization needs preview, success needs benchmarks.
- Both converged: manifest-based provenance tracking, inline confidence
  parentheticals, advisory drift detection against manifest (not all edges),
  preview-first materialization.

**Key observation:** High acceptance rates suggest the reviews found genuine
issues, not style preferences. The agents were willing to concede when the
criticism was well-evidenced. The answer round produced a record of *why*
changes were accepted, not just what changed.

### Phase 4: Independent Merging

Both agents independently produced merged architecture documents,
incorporating accepted changes from both reviews and responses.

| Agent | Artifact | Description |
| --- | --- | --- |
| Claude | `ARCHITECTURE-merged-claude.md` | Merged spec emphasizing extraction detail, confidence rubric, and drift mechanics |
| Codex | `ARCHITECTURE-merged-codex.md` | Merged spec emphasizing storage layout, manifest schema, merge algorithm, and reconciliation |

The merged drafts converged on the main product shape: bootstrap mode plus
ongoing maintenance mode, `lat.md/` as canonical after bootstrap, `.code-kg/`
metadata for manifests and caches, preview-first materialization, optional
Python bridge with TypeScript fallback, advisory drift detection, opt-in
source backlink insertion, local search as the zero-key baseline.

**Key observation:** Even after reviewing the same material and accepting most
of each other's criticisms, the merged documents were not identical. Each
agent emphasized its own strengths while incorporating the other's
corrections. The differences highlighted which version was stronger in which
areas.

### Phase 5: Comparative Evaluation

Claude evaluated both merged documents and determined Codex's version was
stronger overall, citing three specific reasons:

1. `.code-kg/` vs `lat.md/.cache/` — Codex caught that lat.md rejects
   non-markdown files, so tool metadata must live outside `lat.md/`. Claude
   missed this.
2. The manifest schema was more detailed — relationships as first-class
   objects with their own lifecycle, content hashing for edit detection.
3. The confidence reconciliation problem — removing a parenthetical from
   markdown doesn't update the manifest. Codex identified this; Claude had
   glossed over it.

Codex's parallel review of Claude's merged draft found remaining
implementation issues that confirmed the choice: cache files still under
`lat.md/.cache/`, overly aggressive `drift --apply`, unsupported source
backlink comment styles, section markers placed before headings, confidence
promotion underspecified, and a `leidenalg` reference where Graphify actually
uses optional `graspologic` Leiden with NetworkX fallback.

Claude recommended adopting Codex's merged version as the base document — the
stricter storage and safety decisions, borrowing Claude's narrative strengths.

### Phase 6: Targeted Additions

Claude produced `ADDITIONS-for-codex-merged.md`: 9 specific additions from
its own merged version to patch into Codex's base — confidence rubric, edge
level definition, drift scope, backlink styles, search priority, bridge
failure mode, quality gates, token reporting, resolved decisions table.

Codex reviewed the additions before patching and split them into: worth
merging as written, worth merging only with policy corrections, and
conflicting with already-resolved decisions. Corrections included:

- "Structural edges are enforced" became "eligible for drift suggestions."
- Hosted semantic search priority was rejected in favor of local lexical
  search as default.
- Hard cohesion-threshold suppression became preview warning behavior.
- Exact token counts became estimated counts with a target budget model.

This stage showed the value of reviewing additions before patching them. Good
ideas were retained without reintroducing previously fixed errors.

### Phase 7: Final Integration and Polish

Codex integrated Claude's additions into its merged document, which was then
promoted to `ARCHITECTURE.md`. During integration Codex added the confidence
rubric verbatim, wove the edge level field into extraction, softened quality
gate thresholds to benchmark-gated warnings, added a `budget_model` field, an
explicit `search.backend` config, and the resolved decisions table.

Claude made one final targeted suggestion: `confidence reconcile` needed a
clear behavior when markdown no longer showed an inferred/ambiguous
parenthetical but the manifest still marked the relationship unaccepted. The
final policy: `reconcile` reports a promotion candidate; it does not silently
promote; manifest promotion requires explicit confirmation or
`--accept-promotions`. A small but important example of the process catching
an edge case that could otherwise become a bug.

## Artifact Lineage

```text
Phase 1 (independent drafts)
  ARCHITECTURE-claude.md
  ARCHITECTURE-codex.md

Phase 2 (cross-review)
  REVIEW-codex-architecture.md          Claude reviews Codex
  CLAUDE_ARCHITECTURE_REVIEW.md         Codex reviews Claude

Phase 3 (responses)
  CLAUDE_ANSWERS.md                     Claude responds to Codex review
  CODEX_RESPONSE_TO_CLAUDE_REVIEW.md    Codex responds to Claude review

Phase 4 (independent merges)
  ARCHITECTURE-merged-claude.md
  ARCHITECTURE-merged-codex.md

Phase 5 (evaluation)
  [inline in conversation]              Claude evaluates both merges

Phase 6 (additions)
  ADDITIONS-for-codex-merged.md         Claude's additions for Codex base

Phase 7 (final integration)
  ARCHITECTURE-merged-codex.md          Codex integrates additions
  -> promoted to ARCHITECTURE.md        Final spec (since removed; being
                                        rebuilt from scratch)
```

## Error Correction Examples

| Issue | How It Was Found | Final Direction |
| --- | --- | --- |
| Wrong root index filename | Codex reviewed Claude's draft against lat.md behavior. | Use `lat.md/lat.md`, not `index.md`. |
| Metadata inside `lat.md/` | Codex checked current lat.md validation. | Store metadata in `.code-kg/`. |
| Assumed Python module CLI | Codex checked Graphify module behavior. | Define an explicit bridge contract. |
| Drift auto-apply too broad | Cross-review challenged generated-doc noise risk. | Use conservative `drift --apply-safe`. |
| Source backlink styles overstated | Codex checked current code-ref scanner. | MVP supports only scanner-compatible styles; others are post-MVP. |
| Search default ambiguity | Additions review caught hosted-first drift. | Local lexical search remains default. |
| Confidence promotion ambiguity | Final Claude review caught reconcile edge case. | Require explicit confirmation. |
| MVP 1 was just lat.md renamed | Claude caught a product strategy error in Codex's phasing. | MVP 1 includes skeleton bootstrap. |
| Two-phase/four-phase contradiction | Codex caught a rhetorical error in Claude's framing. | Single consistent phase model. |

These corrections were not abstract disagreements. They were grounded in
actual repo behavior, current validation rules, or concrete user experience
risk.

## Observed Dynamics

### What worked

**Independent drafting before review.** Because neither agent saw the other's
draft, the reviews were genuinely independent assessments. This prevented
anchoring — neither agent was trying to improve the other's draft; each was
evaluating it from scratch.

**Structured review format.** Both agents produced numbered issues with
specific questions. This made responses tractable — each question had a clear
answer, and acceptance/rejection was unambiguous.

**Willingness to concede.** Both agents accepted the majority of criticisms
directed at them. Neither defended positions that were clearly wrong. The
`index.md` vs `lat.md/lat.md` issue is a good example — Claude immediately
conceded because Codex cited the actual validation behavior.

**Complementary strengths across different models.** Claude produced more
implementation detail (pseudocode, schemas, rubrics). Codex produced more
product structure (MVP phasing, risks, storage layout, git policy). The final
document needed both. This complementarity is an argument for using frontier
models from *different vendors* rather than multiple instances of one model:
different training produces different blind spots, and the blind spots did
not overlap.

**Comparative evaluation was honest.** Claude evaluated both merged documents
and chose Codex's as the better base, citing specific technical reasons. This
prevented the process from stalling on whose version to use.

### What the process caught that a single agent would have missed

- lat.md rejects non-markdown files under `lat.md/` (neither agent caught
  this in Phase 1; Codex caught it in Phase 4).
- Raw labels are not stable wiki-link targets (Claude's pseudocode was wrong;
  Codex caught it).
- Removing an inline annotation doesn't update the manifest (a subtle
  consistency bug in the design).
- MVP 1 without bootstrap is just lat.md renamed (Claude caught a product
  strategy error in Codex's phasing).
- The two-phase/four-phase inconsistency (Codex caught a rhetorical error in
  Claude's framing).

### What didn't work well

**The human was the bottleneck.** Every handoff required the human to copy a
file path, tell the other agent to read it, and relay context about what had
happened. This was slow and error-prone. The human had to remember which
agent had seen which documents.

**No shared workspace.** The agents couldn't read each other's outputs
directly. Everything went through the human. A shared filesystem or message
bus would have eliminated the relay overhead.

**No structured protocol.** The sequence of phases emerged organically through
the human's judgment ("now review this," "now respond to that," "now merge").
A formal protocol would have made the process repeatable without human
orchestration.

**Redundant merging.** Both agents produced merged documents independently,
but only one was selected. The other merge was wasted work. A protocol could
designate one agent as the integrator after evaluation, rather than having
both merge and then comparing.

**No debate on disagreements.** When agents disagreed (e.g., hard thresholds
vs benchmark-gated warnings for quality gates), the resolution was determined
by whichever agent had the last edit pass. There was no structured mechanism
for resolving genuine disagreements through argumentation.

## Metrics

| Metric | Value |
| --- | --- |
| Artifacts produced | 9 working documents + 1 final spec |
| Total phases | 7 |
| Issues raised in Claude's review of Codex | 10 |
| Issues raised in Codex's review of Claude | 7 (with 15 questions) |
| Acceptance of Claude's review (by Codex) | 9 of 10 fully accepted, 1 partial |
| Acceptance of Codex's review (by Claude) | 4 of 7 fully accepted, 2 partial, 1 reframed |
| Additions proposed | 9 |
| Additions integrated | 9 (all, some refined) |
| Final document length | ~1180 lines |
| Resolved decisions | 13 |
| Open decisions remaining | 5 |

## Process Template

The generalized, reusable process that emerged. It scales from two agents to
N agents (every agent reviews every other agent's draft):

```text
1. INDEPENDENT DRAFTING
   - All agents receive the same inputs and prompt
   - Each produces a draft independently
   - No agent sees another's draft

2. CROSS-REVIEW
   - Each agent reviews every other agent's draft
   - Reviews are structured: numbered issues, severity, questions
   - Reviews focus on errors, gaps, and contradictions — not rewrites

3. RESPONSES
   - Each agent responds to reviews of its own draft
   - Responses are structured: accept, reject with reason, or refine
   - Concrete design decisions are made for accepted issues

4. EVALUATION
   - One agent (or the human) evaluates all drafts holistically
   - Selects a base document with specific justification
   - Identifies additions from non-selected drafts

5. INTEGRATION
   - The base document's author integrates accepted additions
   - Additions are reviewed before patching (the integrator may refine
     them or reject those that conflict with resolved decisions)
   - Result is the final merged document

6. VALIDATION
   - A final targeted review catches remaining edge cases and ambiguity
   - Resolved decisions are recorded to prevent re-litigation
   - Open decisions are explicitly listed
```

This template describes the observed collaboration. It does not prescribe how
a future system should automate the coordination.

## Practices That Kept The Process Useful

- Keep artifacts separate until the merge stage.
- Make review documents name concrete issues rather than vague preferences.
- Separate "answer the critique" from "rewrite the document."
- Treat current repo behavior as evidence.
- Prefer conservative defaults where generated output can damage user trust.
- Record resolved decisions so later rounds do not relitigate them.
- Use final targeted reviews to catch small but dangerous ambiguities.

## Anti-Patterns Avoided

- Merging every suggestion immediately.
- Letting one agent's draft become authoritative before review.
- Treating disagreement as failure.
- Asking agents only for praise or summary.
- Hiding uncertainty in prose without a decision record.
- Allowing broad review late in the process to reopen settled scope.

## Toward Automation: Requirements For A Future System

The bottlenecks identified above (human relay, no shared workspace, no
protocol) are orchestration problems. Single-vendor tooling already solves
orchestration — Claude Code's workflow and subagent facilities can run
draft/review/merge pipelines today. **But single-vendor orchestration misses
the point of this process.** The error-correction record shows the value came
from model diversity: differently trained frontier models with non-overlapping
blind spots. Multiple instances of the same model reviewing each other share
training, biases, and failure modes.

A future system should therefore:

1. **Be vendor-neutral.** Coordinate at least two — ideally three or four —
   frontier models from different vendors via their respective CLIs (e.g.,
   Claude Code, Codex CLI, Gemini CLI, xAI/Grok). The coordination layer
   cannot live inside any one vendor's agent runtime.
2. **Provide a shared workspace.** A common filesystem (or message bus) where
   each agent reads the others' artifacts directly, replacing the human
   relay. The artifact-per-turn convention from this session is a workable
   starting schema.
3. **Encode the protocol.** The 6-step template above, with explicit
   turn-taking, artifact naming, and phase gates, so the sequence does not
   depend on human judgment calls.
4. **Designate roles after evaluation.** One integrator after base selection,
   avoiding the redundant-merge waste observed here.
5. **Add a debate mechanism.** The one genuinely unsolved problem: a
   structured way to resolve disagreements through argumentation rather than
   last-edit-wins. With three or more agents, majority or judged resolution
   becomes possible — a structural advantage of going beyond two agents.

The human's remaining role shifts from relay to steering: setting scope,
choosing when to stop, and arbitrating debates the agents cannot resolve.

## Final Outcome

The session produced a consolidated architecture (`ARCHITECTURE.md`, since
removed pending a from-scratch rebuild) that included the stronger narrative
framing, stricter implementation constraints, resolved decisions, conservative
drift policy, local-first search policy, merge-safe materialization model, and
explicit confidence reconciliation behavior that emerged from the multi-agent
review cycle.

The session demonstrated that two differently-trained frontier agents can
improve each other's work when the interaction is structured as independent
drafting, adversarial review, explicit answers, and controlled merging — and
that the final product was better than either agent's initial draft.
