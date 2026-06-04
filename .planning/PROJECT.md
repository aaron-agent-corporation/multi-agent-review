# Multi-Agent Review

## What This Is

A vendor-neutral orchestration system that runs a structured adversarial review protocol across frontier-model CLIs from different vendors (Claude Code, Codex CLI, Gemini CLI — extensible to more). It automates the 6-phase process proven manually in the Code-KG architecture session: independent drafting → cross-review → responses → evaluation → integration → validation — replacing the human copy-paste relay with a shared workspace and an encoded protocol. Built as a component of the Roscoe AI paralegal platform, but generic over document type.

## Core Value

Differently-trained frontier models catch each other's blind spots — the system must preserve genuine independence between agents (no anchoring, no shared drafts before review) while eliminating the human relay bottleneck.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Orchestrate 3+ vendor CLIs (Claude Code, Codex CLI, Gemini CLI) through the full 6-phase protocol
- [ ] Shared workspace where agents read each other's artifacts directly (artifact-per-turn convention)
- [ ] Encoded protocol with explicit turn-taking, artifact naming, and phase gates — no human judgment calls required for sequencing
- [ ] Independence enforcement: no agent sees another's draft before the cross-review phase
- [ ] Structured review format: numbered issues, severity, concrete questions
- [ ] Response round distinct from merging: accept / reject with reason / refine, producing a decision record
- [ ] Single integrator designated after evaluation (no redundant merging)
- [ ] Disagreement resolution mechanism (approach to be determined by research — majority vote, debate rounds, judge, and human escalation are candidates)
- [ ] Configurable human involvement per run: fully autonomous OR gated at phase boundaries
- [ ] Generic over document type — architecture docs, legal briefs, research memos are all just inputs
- [ ] Decision record output: resolved decisions, open decisions, artifact lineage preserved per run
- [ ] A complete 3-agent run on a test document finishing all 6 phases with a decision record (v1 success bar)

### Out of Scope

- Single-vendor multi-instance review — same model reviewing itself shares blind spots; defeats the purpose
- Vendor API integrations (direct SDK calls) — v1 coordinates existing CLIs the user already has installed and authenticated
- Grok/xAI agent — no CLI installed yet; architecture should allow adding it later
- Web UI / dashboard — CLI/filesystem-first for v1
- Real-time agent-to-agent chat — the protocol is turn-based and artifact-based by design
- Legal-domain-specific features (citation checking, filing formats) — document type is a parameter, not a specialization, in v1

## Context

- **Source evidence:** `docs-case-study.md` (in this repo) documents the manual Claude+Codex session that produced the Code-KG architecture. It contains the proven 6-step process template, observed dynamics, error-correction examples, anti-patterns, and explicit requirements for a future system (vendor-neutral, shared workspace, encoded protocol, designated integrator, debate mechanism).
- **Known bottlenecks from the manual run:** human relay between CLIs, no shared workspace, no formal protocol, redundant merging, last-edit-wins on disagreements.
- **Installed vendor CLIs (verified):** Claude Code 2.1.162, Codex CLI 0.128.0, Gemini CLI 0.45.0. All three support headless/non-interactive invocation modes.
- **Parent platform:** Roscoe (AI paralegal). This tool will eventually serve as review machinery for legal work product, but v1 proves the protocol on any document.
- **Workspace:** lives at `Roscoe/multi-agent-review/` as its own git repo within the Roscoe multi-repo workspace.

## Constraints

- **Tech stack**: Implementation language deliberately undecided — research phase evaluates what fits multi-CLI orchestration best (TypeScript/Node, Python, or shell/minimal are candidates)
- **Dependencies**: Must drive vendor CLIs as installed (claude, codex, gemini) rather than vendor APIs — coordination layer cannot live inside any one vendor's runtime
- **Budget/time**: No hard constraints for v1 — existing subscriptions cover usage

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 3+ vendors from the start (not 2) | Unlocks majority/judged disagreement resolution; structural advantage identified in case study | — Pending |
| Coordinate CLIs, not APIs | User already has authenticated CLIs; vendor-neutrality requires staying outside any one runtime | — Pending |
| Generic document type | Protocol is domain-agnostic; legal specialization deferred | — Pending |
| Debate mechanism via research | The one genuinely unsolved problem from the manual run — don't guess, research approaches | — Pending |
| Configurable gating (autonomous vs phase-gated) | High-stakes runs need human steering; internal docs don't | — Pending |
| Orchestrator form (CLI vs filesystem-protocol vs daemon) undecided | Research phase explores tradeoffs | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-04 after initialization*
