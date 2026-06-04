# Requirements: Multi-Agent Review

**Defined:** 2026-06-04
**Core Value:** Differently-trained frontier models catch each other's blind spots — the system must preserve genuine independence between agents while eliminating the human relay bottleneck.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Orchestration (CLI driving)

- [ ] **ORCH-01**: User can run any installed vendor CLI (claude, codex, gemini) headlessly through a common adapter interface that returns structured output
- [ ] **ORCH-02**: Every CLI invocation is wrapped with a configurable timeout and bounded retry, so a hung agent never blocks a run indefinitely
- [ ] **ORCH-03**: User can define an agent roster in config (name, vendor, CLI command template, model); adding a vendor requires no protocol-layer code changes
- [ ] **ORCH-04**: System refuses to start a run with fewer than 2 distinct vendors in the roster
- [ ] **ORCH-05**: System pre-flight checks each roster CLI (installed, authenticated, responsive) before starting a run
- [ ] **ORCH-06**: Every invocation is logged with command, prompt reference, exit code, duration, and output location

### Protocol (phases & workspace)

- [ ] **PROT-01**: User can start a run on any input document; the run progresses through all 6 phases (independent drafts → cross-review → responses → evaluation → integration → validation) with enforced turn-taking
- [ ] **PROT-02**: Each turn produces a deterministically named artifact file in the run's workspace; the artifact trail is the authoritative run state
- [ ] **PROT-03**: Phase N+1 cannot start until all required phase-N artifacts exist
- [ ] **PROT-04**: During drafting, an agent's working context physically cannot include another agent's draft (scoped workspaces; drafts promoted to shared area only at the phase boundary)
- [ ] **PROT-05**: User can choose per run: fully autonomous, or gated (run pauses for human approval at each phase boundary)
- [ ] **PROT-06**: User can resume an interrupted run from the last completed phase without re-running prior phases
- [ ] **PROT-07**: Run has an ID, status, and a manifest indexing all artifacts and phase completion

### Review Machinery

- [ ] **REVW-01**: Cross-reviews follow a structured format — numbered issues with severity (P1–P3) and a concrete question per issue — validated/normalized by the system
- [ ] **REVW-02**: Each agent responds to reviews of its own draft with a structured verdict per issue: accept, reject with reason, or refine
- [ ] **REVW-03**: An evaluation step selects a base document with cited, evidence-grounded justification
- [ ] **REVW-04**: Exactly one agent is designated integrator after evaluation; only the integrator merges (no redundant merging)
- [ ] **REVW-05**: The integrator reviews proposed additions before patching and may refine or reject those conflicting with resolved decisions

### Disagreement Resolution

- [ ] **RSLV-01**: Disagreements are resolved by tiered mechanism: evidence-grounded integrator judgment (default), with every resolution logged with rationale
- [ ] **RSLV-02**: For discrete forks (base selection, accept/reject), agents' positions are collected as a majority signal (3+ vendors) to inform or break ties
- [ ] **RSLV-03**: Disagreements unresolvable on evidence and without clear majority are escalated as open decisions — pausing for human arbitration in gated mode, logged for review in autonomous mode

### Decision Record

- [ ] **RCRD-01**: Every run produces a decision record: resolved decisions with rationale, open decisions, and artifact lineage
- [ ] **RCRD-02**: The resolved-decisions record is fed to later phases as a guard so settled decisions are not re-litigated within the run

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Observability

- **COST-01**: User can see estimated token/cost spend per run, parsed from CLI usage output
- **DASH-01**: Read-only run comparison/metrics view over the filesystem

### Resolution Extensions

- **RSLV-04**: Opt-in bounded structured debate rounds (anchoring-preserving design) for selected disagreements
- **RSLV-05**: Cross-vendor, blinded, position-randomized judge model as a tie-breaker

### Roster Extensions

- **ORCH-07**: Grok/xAI agent adapter (when CLI available)

### Domain Plugins

- **DOMN-01**: Legal-domain plugin (citation checks, filing formats) layered on the generic protocol

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time agent-to-agent chat | Destroys independence — shared context = anchoring = blind-spot overlap; protocol is turn-based and artifact-mediated by design |
| Mandatory debate loop for every disagreement | Evidence (arXiv 2508.17536): debate doesn't beat voting, can converge to wrong answers via peer pressure, N× token cost |
| Self-judging by a roster agent | Self-preference and family bias documented and large; any future judge must be cross-vendor + blinded |
| Single-vendor multi-instance review | Same training = same blind spots; defeats the project's premise |
| Direct vendor API/SDK integration | Breaks vendor-neutrality and loses existing CLI auth/subscriptions; CLIs are driven as black boxes |
| Web UI / dashboard (v1) | Pulls effort from the protocol into UI plumbing; filesystem-first is the differentiator |
| Auto-merge of every accepted suggestion | Case study's #1 anti-pattern; integrator review before patching is required |
| Unbounded autonomous runs | No convergence guarantee; fixed 6-phase protocol with defined terminal state |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (populated by roadmap) | | |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 ⚠️ (pre-roadmap)

---
*Requirements defined: 2026-06-04*
*Last updated: 2026-06-04 after initial definition*
