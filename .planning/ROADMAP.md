# Roadmap: Multi-Agent Review

## Overview

A vendor-neutral orchestrator that drives heterogeneous frontier-model CLIs (claude, codex, gemini) through a 6-phase adversarial review protocol, using the filesystem as the single source of truth. The journey is a strict dependency spine: first prove one CLI can be driven headlessly into a deterministic artifact workspace, then generalize that into a swappable adapter layer with a roster, then encode the 6-phase state machine with structural independence enforcement, then tie it all together into the first complete 3-agent end-to-end run that produces a decision record (the v1 success bar), and finally harden around the proven protocol with resume, human gating, majority signal, and re-litigation guards. Every phase is a vertical slice that ends in something a user can observe and run.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Workspace + First Adapter** - Drive one CLI headlessly into a deterministic, manifest-indexed artifact workspace (completed 2026-06-04)
- [x] **Phase 2: Adapter Layer + Roster + Pre-flight** - Swappable per-vendor adapters, configurable multi-vendor roster, and pre-run readiness checks (completed 2026-06-04)
- [ ] **Phase 3: Protocol Engine + Independence Enforcement** - 6-phase state machine with enforced turn-taking and structural draft independence
- [ ] **Phase 4: First End-to-End Run** - One complete 3-agent run through all 6 phases producing a decision record (v1 success bar)
- [ ] **Phase 5: Hardening — Resume, Gating, Majority, Guards** - Resumable runs, configurable human gating, majority-signal tie-breaking, and re-litigation guards

## Phase Details

### Phase 1: Workspace + First Adapter

**Goal**: A user can run one installed CLI headlessly and see its output captured as a deterministically named, normalized artifact in a manifest-indexed run workspace.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: ORCH-01, ORCH-06, PROT-02, PROT-07
**Success Criteria** (what must be TRUE):

  1. User can invoke one vendor CLI (claude) headlessly through a common adapter call and receive structured, normalized output
  2. Each invocation writes a deterministically named artifact file into `runs/<id>/`, and the artifact trail is the authoritative run state
  3. Every run has an ID, a status, and a manifest that indexes its artifacts and phase completion
  4. Every invocation is logged with command, prompt reference, exit code, duration, and output location
  5. A hung invocation is bounded by an external wall-clock timeout rather than blocking indefinitely

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold + schemas + filesystem-as-truth workspace (layout/manifest/artifacts) + fake-CLI fixture + RED e2e anchor

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — claude adapter (execa, no --bare, normalized TurnResult, timeout) + pino NDJSON invocation log

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — `mar invoke` CLI wiring end-to-end (turns e2e GREEN) + live human-verified smoke

### Phase 2: Adapter Layer + Roster + Pre-flight

**Goal**: A user can configure a roster of distinct-vendor agents and the system reliably drives each through a uniform adapter contract, refusing to start unsafe rosters and surfacing CLI problems before a run begins.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: ORCH-02, ORCH-03, ORCH-04, ORCH-05
**Success Criteria** (what must be TRUE):

  1. User can define an agent roster in config (name, vendor, command template, model); all three vendors (claude, codex, gemini) invoke through the same adapter interface with no protocol-layer branching on vendor
  2. Every CLI invocation is wrapped with a configurable timeout and bounded retry, so a hung or transiently failing agent never blocks a run indefinitely
  3. The system refuses to start a run when the roster contains fewer than 2 distinct vendors
  4. A pre-flight check verifies each roster CLI is installed, authenticated, and responsive before the run starts, reporting any failures

**Plans**: 5 plans

Plans:
**Wave 1** *(parallel — disjoint files)*

- [x] 02-01-PLAN.md — codex + gemini adapters + vendor->adapter registry (ORCH-03 seam; gemini fixture-built D-32)
- [x] 02-02-PLAN.md — vendor-agnostic withRetry wrapper + per-attempt logging (ORCH-02)
- [x] 02-03-PLAN.md — roster config schema/loader + vendor-distinctness gate + `mar init` (ORCH-03/04)

**Wave 2** *(blocked on Wave 1)*

- [x] 02-04-PLAN.md — tiered pre-flight (version + live probe) + cache + hints (ORCH-05)

**Wave 3** *(blocked on Wave 2)*

- [x] 02-05-PLAN.md — CLI wiring (`init`/`preflight`/roster `invoke`+withRetry) + live human-verify (ORCH-02/03/05)

### Phase 3: Protocol Engine + Independence Enforcement

**Goal**: A user can start a run on any input document and watch it progress through all 6 phases with enforced turn-taking and gates, where an agent physically cannot see a peer's draft before the cross-review phase.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: PROT-01, PROT-03, PROT-04
**Success Criteria** (what must be TRUE):

  1. User can start a run on any input document and it advances through all 6 phases (drafts → cross-review → responses → evaluation → integration → validation) with enforced turn-taking
  2. Phase N+1 cannot begin until all required phase-N artifacts exist on disk
  3. During drafting, an agent's working context provably excludes peer drafts (workspace-scoped), and drafts are promoted to the shared area only at the phase-1-to-2 boundary
  4. A planted-error catch test confirms independent drafts surface errors a shared-context run would mask

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Adapter cwd seam + scoped-workspace independence primitive (PROT-04) + RED `mar run` e2e anchor

**Wave 2** *(blocked on Wave 1)*

- [x] 03-02-PLAN.md — XState v5 protocol engine (6-phase loop + artifacts-on-disk gate) + `mar run` wiring (PROT-01/03/04); anchor GREEN

**Wave 3** *(blocked on Wave 2)*

- [ ] 03-03-PLAN.md — Planted-error A/B independence proof (success #4) + live human-verify checkpoint

### Phase 4: First End-to-End Run

**Goal**: A user can execute one complete 3-agent run through all 6 phases on a test document, with structured reviews, structured responses, a single designated integrator, and a decision record as output — the v1 success bar.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: REVW-01, REVW-02, REVW-03, REVW-04, REVW-05, RSLV-01, RCRD-01
**Success Criteria** (what must be TRUE):

  1. A complete 3-agent run finishes all 6 phases on a test document and produces a decision record
  2. Cross-reviews follow a system-validated structured format (numbered issues, P1-P3 severity, one concrete question per issue)
  3. Each agent responds to reviews of its own draft with a structured per-issue verdict (accept / reject-with-reason / refine)
  4. Exactly one integrator is designated after an evidence-grounded evaluation step, and only that integrator merges, reviewing proposed additions before patching
  5. The decision record captures resolved decisions with rationale, open decisions, and artifact lineage; each integrator resolution is logged with its rationale

**Plans**: TBD

### Phase 5: Hardening — Resume, Gating, Majority, Guards

**Goal**: A user can run the protocol unattended or human-gated with confidence: interrupted runs resume cleanly, the run can pause at phase boundaries for approval, discrete forks use a majority signal, unresolved forks escalate correctly, and settled decisions are not re-litigated.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: PROT-05, PROT-06, RSLV-02, RSLV-03, RCRD-02
**Success Criteria** (what must be TRUE):

  1. User can choose per run between fully autonomous and gated (pause for human approval at each phase boundary) execution
  2. User can resume an interrupted run from the last completed phase without re-running prior phases
  3. For discrete forks (base selection, accept/reject), agents' positions are collected as a majority signal to inform or break ties
  4. Disagreements unresolvable on evidence and without a clear majority escalate as open decisions — pausing for human arbitration in gated mode, logged for review in autonomous mode
  5. The resolved-decisions record is fed to later phases as a guard, so settled decisions are not re-litigated within the run

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Workspace + First Adapter | 3/3 | Complete    | 2026-06-04 |
| 2. Adapter Layer + Roster + Pre-flight | 5/5 | Complete   | 2026-06-04 |
| 3. Protocol Engine + Independence Enforcement | 2/3 | In Progress|  |
| 4. First End-to-End Run | 0/TBD | Not started | - |
| 5. Hardening — Resume, Gating, Majority, Guards | 0/TBD | Not started | - |
