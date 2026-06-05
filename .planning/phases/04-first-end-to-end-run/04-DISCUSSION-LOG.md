# Phase 4: First End-to-End Run - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-05
**Phase:** 04-first-end-to-end-run
**Areas discussed:** Review format + validation, Evaluation + integrator, Decision record shape, The 3rd-agent problem

---

## Review format + validation

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown + frontmatter | Human-readable body, machine-readable YAML frontmatter (gray-matter) | ✓ |
| Pure JSON artifacts | Strongest validation, weakest human readability | |
| Vendor schema enforcement | --json-schema/--output-schema; couples to vendor flag surfaces | |

**User's choice:** Markdown + frontmatter

| Option | Description | Selected |
|--------|-------------|----------|
| One retry with feedback | Re-invoke once with validation errors appended; second failure = failed turn | ✓ |
| Auto-normalize best-effort | Fill defaults, never re-invoke | |
| Strict fail, no retry | Invalid output = failed turn immediately | |

**User's choice:** One retry with feedback

| Option | Description | Selected |
|--------|-------------|----------|
| Template + example in prompt | Few-shot embedded per prompt | |
| Schema in prompt + vendor flags | Belt-and-braces, per-vendor divergence | |
| Minimal instruction only | Prose + retry loop | |

**User's choice:** Free-text — pre-provisioned skills/instructions given to agents in advance; prompt tells the agent to follow them, then do the work. Refined through discussion to: orchestrator seeds vendor-native instruction files (CLAUDE.md / AGENTS.md / GEMINI.md) into each agent's spawn folder, rendered from one source of truth.
**Notes:** User reports codex supports skills and believes gemini does too — flagged as research item (D-39). User: "If you just create three folders... seed each one with AGENTS.md, GEMINI.md, and CLAUDE.md that tells them how to respond — that solves your problem."

---

## Evaluation + integrator

**User's choice (free-text, reshaped the design):** Iterative convergence — "I just kept giving the one agent's output to the other agent with instructions to evaluate it... through iteration, the two sides got closer and closer until finally there was essentially agreement." Convergence loop until agreed base OR unresolvable disagreement OR iteration cap; deadlocks escalate to the user. Cap default 10 (user floated 10/20/100, accepted 10 + config override). "I don't give a shit about tokens."
**Notes:** Clarified that REVW-03 evaluation (base pick) is distinct from disagreement resolution (RSLV-01/03); user's "the user is the evaluator" instinct maps to RSLV-03 escalation, which in Phase 4 autonomous mode = open decisions in the decision record.

| Option | Description | Selected |
|--------|-------------|----------|
| Base draft's author | Winner of convergence integrates | ✓ |
| A non-author merges | Fresh eyes, less familiarity | |
| Convergence picks it too | One more thing to converge on | |

**User's choice:** Base draft's author becomes integrator

---

## Decision record shape

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown + frontmatter | Same gray-matter convention as reviews | ✓ |
| Markdown + JSON sidecar | Two files to keep in sync | |
| JSON only | Most parseable, least readable | |

**User's choice:** Markdown + frontmatter

| Option | Description | Selected |
|--------|-------------|----------|
| Contested items only | Record what was argued and how it landed; unanimous accepts tallied | ✓ |
| Every review issue | Complete but noisy | |
| Integrator judgments only | Loses response-round reasoning | |

**User's choice:** Contested items only

| Option | Description | Selected |
|--------|-------------|----------|
| Per-decision references | Lineage cited where used + compact run-level chain | ✓ |
| Full lineage graph section | Duplicative of manifest | |
| Manifest pointer only | Least self-contained | |

**User's choice:** Per-decision references

---

## The 3rd-agent problem

| Option | Description | Selected |
|--------|-------------|----------|
| Fix gemini auth first | True 3-vendor live run as the bar | ✓ |
| 2 live + 3 hermetic | Fixtures prove 3-agent dynamics | |
| Defer 3-agent bar to Phase 5 | Weakens v1 bar | |

**User's choice:** Fix gemini auth first
**Notes:** Auth path: settings.json OAuth — user holds paid tiers ("higher than Free for every Frontier model and GROK"). Fallback: GEMINI_API_KEY; last resort: a pi.dev CLI tool backed by the Gemini API.

---

## Claude's Discretion

- Convergence-round mechanics (evaluation artifact shape, operational agreement detection)
- Run progress UX during convergence loops
- Exact zod frontmatter schemas for reviews/responses/evaluations/decision record
- Instruction-file template storage/rendering

## Deferred Ideas

- pi.dev CLI tool backed by Gemini API (fallback adapter)
- Grok as 4th vendor via API-backed CLI adapter (user has paid Grok)
- Vendor-native skills as instruction channel (pending D-39 research)
