# Roadmap: Multi-Agent Review

## Overview

A vendor-neutral orchestrator that drives heterogeneous frontier-model CLIs (claude, codex, gemini) through a 6-phase adversarial review protocol, using the filesystem as the single source of truth. v1.0 proved the full dependency spine — drive one CLI headlessly → swappable adapter layer + roster → encoded 6-phase state machine with structural independence → first complete 3-agent end-to-end run producing a decision record → hardening (resume, gating, majority, guards).

## Milestones

- ✅ **v1.0 MVP** — Phases 1–5 (shipped 2026-06-07)
- 📋 **v1.1** — next milestone (run `/gsd:new-milestone` to scope)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–5) — SHIPPED 2026-06-07</summary>

- [x] Phase 1: Workspace + First Adapter (3/3 plans) — completed 2026-06-04
- [x] Phase 2: Adapter Layer + Roster + Pre-flight (5/5 plans) — completed 2026-06-04
- [x] Phase 3: Protocol Engine + Independence Enforcement (3/3 plans) — completed 2026-06-05
- [x] Phase 4: First End-to-End Run (5/5 plans) — completed 2026-06-05
- [x] Phase 5: Hardening — Resume, Gating, Majority, Guards (7/7 plans, incl. gap closure 05-07) — completed 2026-06-07

Full detail archived in `.planning/milestones/v1.0-ROADMAP.md`. Audit: `.planning/milestones/v1.0-MILESTONE-AUDIT.md`.

</details>

### 📋 v1.1 (Planned)

No phases scoped yet. Candidate requirements live in PROJECT.md → Active. Run `/gsd:new-milestone` to gather context, research, requirements, and a phase breakdown.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Workspace + First Adapter | v1.0 | 3/3 | Complete | 2026-06-04 |
| 2. Adapter Layer + Roster + Pre-flight | v1.0 | 5/5 | Complete | 2026-06-04 |
| 3. Protocol Engine + Independence | v1.0 | 3/3 | Complete | 2026-06-05 |
| 4. First End-to-End Run | v1.0 | 5/5 | Complete | 2026-06-05 |
| 5. Hardening — Resume, Gating, Majority, Guards | v1.0 | 7/7 | Complete | 2026-06-07 |
