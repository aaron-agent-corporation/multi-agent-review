# Multi-Agent Review

## What This Is

A vendor-neutral orchestration system that runs a structured adversarial review protocol across frontier-model CLIs from different vendors (Claude Code, Codex CLI, Gemini CLI — extensible to more). It automates the 6-phase process proven manually in the Code-KG architecture session: independent drafting → cross-review → responses → evaluation → integration → validation — replacing the human copy-paste relay with a shared workspace and an encoded protocol. Built as a component of the Roscoe AI paralegal platform, but generic over document type.

## Core Value

Differently-trained frontier models catch each other's blind spots — the system must preserve genuine independence between agents (no anchoring, no shared drafts before review) while eliminating the human relay bottleneck.

## Requirements

### Validated

- [x] Run one vendor CLI (claude) headlessly through a common adapter returning structured, normalized output — Validated in Phase 1: Workspace + First Adapter (ORCH-01 claude-only slice)
- [x] Deterministically named artifacts in manifest-indexed `runs/<id>/` workspace; artifact trail authoritative (PROT-02, PROT-07) — Validated in Phase 1
- [x] Every invocation logged with command, prompt reference, exit code, duration, output location (ORCH-06) — Validated in Phase 1
- [x] Hung invocations bounded by external wall-clock timeout — Validated in Phase 1
- [x] All three vendor CLIs (claude, codex, gemini) invoked through one uniform `AgentAdapter` contract via a vendor→adapter registry (ORCH-03) — Validated in Phase 2: Adapter Layer + Roster + Pre-flight
- [x] Configurable roster (`mar.config.json`) with vendor-distinctness gate refusing <2 distinct vendors (ORCH-04) — Validated in Phase 2
- [x] Transient failures retried with bounded exponential backoff, every attempt audit-logged (ORCH-02) — Validated in Phase 2
- [x] Tiered pre-flight (install check + live probe) surfaces CLI problems with actionable hints before a run (ORCH-05) — Validated in Phase 2 (live-verified: claude ✓, codex ✓, gemini correctly flagged for headless auth)
- [x] Encoded 6-phase protocol with explicit turn-taking, artifact naming, and artifacts-on-disk phase gates — no human sequencing (PROT-01, PROT-03) — Validated in Phase 3: XState v5 engine, live-verified with real claude+codex through all 6 phases
- [x] Independence enforcement: agents draft in scoped workdirs where peer drafts are physically absent; promotion to shared/ only at the draft→review boundary (PROT-04) — Validated in Phase 3 (falsifiable planted-error A/B proof: shared-context control masks the error, independent treatment surfaces it)
- [x] Partial-failure resilience: failed agents dropped with manifest audit record, run continues with ≥2 distinct surviving vendors (D-30) — Validated in Phase 3 (live: gemini auth failure no longer dooms the run)
- ✓ Orchestrate 3+ vendor CLIs through the full 6-phase protocol — v1.0 (live 3-vendor run 20260605-MlhRzU)
- ✓ Shared workspace where agents read each other's artifacts directly (artifact-per-turn) — v1.0 (run dir + manifest, scoped→shared promotion)
- ✓ Encoded protocol: explicit turn-taking, artifact naming, phase gates (PROT-01/03) — v1.0 (XState engine; Phase 5 added per-run gating)
- ✓ Independence enforcement: no agent sees another's draft before cross-review (PROT-04) — v1.0 (falsifiable planted-error A/B proof)
- ✓ Structured review format: numbered issues, severity, concrete questions (REVW-01) — v1.0 (validation-with-one-retry gate)
- ✓ Response round distinct from merging: accept / reject-with-reason / refine (REVW-02) — v1.0
- ✓ Single integrator after evaluation, integrator-only merge with per-addition verdicts (REVW-03/04/05) — v1.0
- ✓ Disagreement resolution: evidence-grounded convergence loop + majority tie-break + human arbitration (RSLV-01/02/03) — v1.0
- ✓ Configurable human involvement: autonomous OR gated with approve/abort/feedback + pause-and-exit (PROT-05) — v1.0
- ✓ Resume an interrupted run from the last completed phase (PROT-06) — v1.0 (re-derivation, full-roster restore on failure)
- ✓ Re-litigation guard: rolling resolved-decisions ledger fed to later phases (RCRD-02) — v1.0
- ✓ Decision record: resolved/open decisions with rationale + artifact lineage (RCRD-01) — v1.0
- ✓ Complete 3-agent run producing a decision record (v1 success bar) — v1.0 (LIVE 3-vendor checkpoint approved)

### Active

(v1.0 shipped all initial requirements. Next-milestone candidates below — promote during `/gsd:new-milestone`.)

- [ ] Generic over document type proven on a real (non-test) document — architecture docs, legal briefs, research memos
- [ ] Untrusted-input hardening — prompt-injection defenses for real input documents (deferred from Phase 4, T-04-05)
- [ ] Gemini adapter resilience past the 2026-06-18 free-tier sunset (Antigravity CLI adapter or API-key path)
- [ ] Cross-process-safe ledger writes (current mutex is in-process only — AR-05-01)
- [ ] Retroactive Nyquist VALIDATION.md for phases 1–4 (formalism gap; coverage already met by the test suite)

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
- **v1.0 shipped state (2026-06-07):** ~5,700 LOC TypeScript (src) + ~6,700 LOC tests; 40 test files / 315 tests green. Stack: Node 22 ESM, execa, XState v5, zod, gray-matter, commander, pino. 5 phases, 24/24 requirements, 38 threats closed across 2 security audits. Live 3-vendor protocol run verified end-to-end.
- **Known tech debt at v1.0:** in-process-only ledger mutex (AR-05-01); gemini free-tier sunset 2026-06-18; phases 1–4 lack formal VALIDATION.md (coverage met by test suite).

## Constraints

- **Tech stack**: Implementation language deliberately undecided — research phase evaluates what fits multi-CLI orchestration best (TypeScript/Node, Python, or shell/minimal are candidates)
- **Dependencies**: Must drive vendor CLIs as installed (claude, codex, gemini) rather than vendor APIs — coordination layer cannot live inside any one vendor's runtime
- **Budget/time**: No hard constraints for v1 — existing subscriptions cover usage

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 3+ vendors from the start (not 2) | Unlocks majority/judged disagreement resolution; structural advantage identified in case study | ✓ Good — 3-vendor live run works; majority tie-break + ≥2-vendor floor both proven |
| Coordinate CLIs, not APIs | User already has authenticated CLIs; vendor-neutrality requires staying outside any one runtime | ✓ Good — adapter/registry layer adds vendors with no protocol changes |
| Generic document type | Protocol is domain-agnostic; legal specialization deferred | ✓ Good — engine treats the document as an opaque input (proven on test docs; real-doc proof is a v1.1 candidate) |
| Debate mechanism via research | The one genuinely unsolved problem from the manual run — don't guess, research approaches | ✓ Good — landed as the evidence-grounded convergence loop + majority tie-break + escalation |
| Configurable gating (autonomous vs phase-gated) | High-stakes runs need human steering; internal docs don't | ✓ Good — run-start mode prompt + gates with approve/abort/feedback + pause-and-exit |
| Orchestrator form: CLI + filesystem protocol (no daemon) | Research chose a commander CLI over a run dir + manifest as authoritative state | ✓ Good — state always derivable from disk enabled clean resume |
| gray-matter READ-only; hand-rolled YAML writer | Avoid injection via agent/human-authored frontmatter while still parsing it | ✓ Good — verified across both security audits (T-04-07, T-05-17) |
| claude `--bare` omitted (vs the original plan) | `--bare` breaks subscription/OAuth auth; seeded ancestor-ignore contract proven sufficient | ✓ Good — live run measured zero instruction leakage |

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
*Last updated: 2026-06-07 after v1.0 milestone — full evolution review. All 24 initial requirements shipped and moved to Validated; Key Decisions resolved with outcomes; Active reset to v1.1 candidates. v1.0 = vendor-neutral 6-phase adversarial review across 3 frontier-model CLIs producing a decision record, resumable/gateable/guarded, 315 tests green, 38 threats closed.*
