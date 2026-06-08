# Retrospective — Multi-Agent Review

## Milestone: v1.0 — MVP

**Shipped:** 2026-06-07
**Phases:** 5 | **Plans:** 23 | **Tasks:** 32

### What Was Built

A vendor-neutral orchestrator driving claude + codex + gemini CLIs through a 6-phase adversarial review protocol (draft → review → response → evaluation → integration → validation), producing a contested-only decision record. Filesystem is the single source of truth; runs are resumable, per-run gateable (autonomous vs human-gated), majority-tie-broken, and guarded against re-litigation via a rolling resolved-decisions ledger. ~5,700 LOC src + ~6,700 LOC tests, 315 tests, 38 threats closed across 2 security audits.

### What Worked

- **Vertical-slice phasing (MVP mode).** Each phase ended in something runnable — `mar invoke` → `mar preflight` → live `mar run`. The live checkpoints repeatedly caught integration gaps that hermetic tests missed (D-30 skip-failed un-wired; the validation gate's preamble/YAML brittleness).
- **Wave-based parallel execution in worktrees.** Independent plans ran concurrently with a manifest-driven merge; file-disjoint wave assignment held with zero merge conflicts across the whole milestone.
- **Hermetic fake-CLI fixtures.** Every protocol dynamic (convergence, majority, integrator, re-litigation, resume, gating) was provable on fixtures at zero credits, so CI never depended on live vendors.
- **Plan-time threat models → retroactive verification.** Authoring `<threat_model>` blocks during planning made the security audits a verification pass, not a scramble; 38/38 closed with file:line evidence.
- **gray-matter READ-only + hand-rolled YAML writer.** A single discipline neutralized injection across both human- and agent-authored frontmatter.

### What Was Inefficient

- **The dist packaging bug survived two fixes.** Phase 4 flagged it, Phase 5's 05-01 "fixed" it at the wrong path, and it took UAT (running the *compiled* binary) plus gap plan 05-07 to actually close it. Lesson: a guard test that asserts a file path is weaker than one that runs the real artifact.
- **The live-checkpoint validation gate needed 3 live runs.** Each run surfaced one more way real models deviate from the format contract (file-write attempts, preamble prose, unquoted-colon YAML). Could have front-loaded a "real models are sloppy" hardening pass.
- **`claude --bare` was carried in the plan long after it was known-wrong.** It stayed as register drift until the security audit; deciding it explicitly earlier would have saved churn.

### Patterns Established

- Live human-verify checkpoint as the final gate of an end-to-end phase (D-48).
- Tolerant frontmatter reader (locate frontmatter leniently, validate strictly) shared by every consumer.
- Resume by re-derivation from the manifest, never XState snapshot restore.
- `resolver` provenance field (convergence | majority | integrator | human) on every settled decision.

### Key Lessons

- Verify against the *shipped artifact* (compiled binary), not a proxy (source via tsx, or a file-existence assertion).
- Live runs are non-optional for agent-orchestration correctness — the generator self-evaluation blind spot is real.
- Pin reversed decisions in the record the moment they reverse, or they resurface as drift in audits.

### Cost Observations

- Model mix: Opus-driven orchestration + subagents throughout.
- Sessions: spanned 2026-06-04 → 2026-06-07.
- Notable: wave parallelism + hermetic fixtures kept iteration cheap; the only credit spend was the 3 live 3-vendor checkpoint runs.

## Cross-Milestone Trends

| Milestone | Phases | Plans | Tests | Threats closed | Live-run iterations to green |
|-----------|--------|-------|-------|----------------|------------------------------|
| v1.0 | 5 | 23 | 315 | 38 | 3 (Phase 4 checkpoint) |
