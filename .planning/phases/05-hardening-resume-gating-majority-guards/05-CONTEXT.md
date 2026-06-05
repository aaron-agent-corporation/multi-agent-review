# Phase 5: Hardening — Resume, Gating, Majority, Guards - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

A user can run the protocol unattended or human-gated with confidence: interrupted runs resume cleanly from the last completed phase, gated runs pause at phase boundaries for human approval, discrete forks (base selection, accept/reject) use the agents' positions as a majority signal to break ties, unresolvable forks escalate correctly (live arbitration in gated mode, logged open decisions in autonomous mode), and settled decisions are not re-litigated within a run. Requirements: PROT-05, PROT-06, RSLV-02, RSLV-03, RCRD-02.

</domain>

<decisions>
## Implementation Decisions

### Gating & arbitration UX (PROT-05, RSLV-03)
- **D-50:** Gate mechanism is BOTH: a blocking terminal prompt by default (the `mar run` process stays alive and prompts at each phase boundary), plus a pause-and-exit path via flag — the run writes a `paused-awaiting-approval` status to the manifest and exits; `mar resume <run-id>` approves and continues. Pause-and-exit shares its mechanism with PROT-06 resume.
- **D-51:** Gate actions are approve / abort / feedback. Feedback = a short human note injected into the NEXT phase's prompts (lightweight steering, e.g. "focus the review on the security section"). No artifact editing at gates — provenance stays clean.
- **D-52:** Arbitration of an escalated disagreement in gated mode: present each agent's final position with its cited evidence; the human either picks a side or writes a free-form ruling. The ruling is recorded in the decision record as `resolver: human` with the human's rationale, and feeds the re-litigation guard like any resolved decision.
- **D-53:** Mode selection (gated vs autonomous) is an interactive prompt at run start. (Claude's discretion: non-TTY/scripted contexts need a deterministic bypass — e.g. flags that skip the prompt; a bare scripted `mar run` must not hang waiting for TTY input.)

### Resume semantics (PROT-06)
- **D-54:** Resume granularity = last completed phase. The interrupted phase re-runs from its start; convergence rounds restart from round 1 on resume (round artifacts from the interrupted attempt remain on disk for audit but are not resumed mid-loop).
- **D-55:** CLI: `mar resume <run-id>` (explicit id) plus `mar resume --last` (most recent resumable run). ONE command serves both interrupted-run recovery and gated-run approval (D-50 pause-and-exit).
- **D-56:** Resume re-validates before continuing: manifest integrity, every completed phase's artifacts exist and their frontmatter re-validates against the 04-01 schemas, and roster preflight runs (auth can decay between sessions — observed live with gemini). Refuse with a clear error naming exactly what is broken.
- **D-57:** FAILED runs are resumable too (not just interrupted/paused): `mar resume` re-attempts the failed phase from its start with the FULL original roster — dropped agents get another chance (auth may be fixed). A vendor-floor failure no longer wastes completed phases.

### Majority signal (RSLV-02)
- **D-58:** Collection: tally positions already stated in structured artifacts (`proposedBase` per evaluation round, verdicts across responses). NO extra vote turns, no new ballot artifact kind. converge.ts already reads these fields off disk.
- **D-59:** Authority: tie-break after cap/deadlock ONLY. The evidence-grounded convergence loop (D-40) stays primary. When the loop hits the iteration cap or a detected deadlock, a clear majority (e.g. 2-1 with 3 vendors) picks the base instead of escalating. No clear majority → escalate as today. The running tally is NOT injected into evaluation rounds (anchoring risk vs. the independence core value).
- **D-60:** 2-vendor 1-1 deadlock: escalate (human arbitration in gated mode, open decision + fallback base in autonomous mode — existing D-42 path). No heuristic tie-breakers, no credibility weighting.
- **D-61:** Decision record entries gain a `resolver` field: `convergence | majority | integrator | human`. Additive extension of the RCRD-01 schema — reading the record tells you HOW each fork settled.

### Re-litigation guard (RCRD-02)
- **D-62:** Guard is inject + enforce: a compact resolved-decisions digest is injected into later-phase prompts AND the integrator/validation path enforces post-hoc (04-03's conflicts-with-resolved drop generalizes).
- **D-63:** Within-run guard state lives in a rolling shared artifact: `resolved-decisions.md` in the run's shared/ folder, appended as forks settle (response verdicts, convergence concessions, integrator calls, human rulings). Gray-matter format like every artifact. The terminal decision-record (04-05) assembles FROM it. Agents can read it like any peer artifact; the prompt digest cites it.
- **D-64:** Re-litigation violation response: drop + warn, no retry. The re-litigating position is dropped with a logged `re-litigation` reason (consistent with 04-03 integrator drops); the run continues; the decision record notes the violation.
- **D-65:** Injected digest granularity: decision + one-line rationale per settled fork (plus what resolved it). Not bare decisions (confusion risk), not full lineage (prompt bloat — lineage is on disk).

### Claude's Discretion
- Exact flag names for gated/autonomous/pause-and-exit and the non-TTY bypass for D-53's interactive prompt.
- `paused-awaiting-approval` status naming and manifest/state-machine representation (must compose with existing `completed | escalated | failed | timeout` statuses).
- How gate feedback notes are stored (suggestion: in the run dir with attribution, so the decision record can reference human steering).
- Deadlock detection mechanics for D-59 (when rounds stop narrowing) — guided by 04-04's existing guards.
- Digest rendering format for D-65 and where in the prompt it is injected (thin-prompt convention from D-37 still applies — keep per-turn prompts thin; the digest may belong in the seeded instruction file or as a referenced shared artifact).
- XState modeling of pause/resume (actor persistence vs. re-derivation from manifest — D-14's "state derivable from disk" rule favors re-derivation).

### Carried-forward constraints (do not revisit)
- D-14: run state always derivable from disk — resume must NOT depend on in-memory state.
- D-30: ≥2-distinct-vendor floor is never compromised, including on resume.
- D-38: validation-with-one-retry stays the failure pattern for malformed turns.
- D-41/D-42/D-43: convergence cap (default 10, configurable); autonomous escalation = logged open decision; token cost is NOT a design constraint.
- Phase-4 live-checkpoint hardening (tolerant frontmatter reader, YAML-errors-feed-retry, OUTPUT CHANNEL + quoting contract rules) must be preserved by any engine refactor.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning artifacts
- `.planning/ROADMAP.md` §Phase 5 — goal, success criteria, requirement mapping
- `.planning/REQUIREMENTS.md` — PROT-05, PROT-06, RSLV-02, RSLV-03, RCRD-02 exact texts
- `.planning/phases/04-first-end-to-end-run/04-CONTEXT.md` — D-36..D-49 (format contract, convergence loop, decision record, escalation) that Phase 5 extends
- `.planning/phases/04-first-end-to-end-run/04-05-SUMMARY.md` — "Known gaps" section: dist packaging bug (`.tmpl` not copied to dist/) and the unimplemented claude `--bare` design call — both flagged for Phase 5 by the Phase 4 verifier
- `.planning/phases/04-first-end-to-end-run/04-VERIFICATION.md` — gap details and suggested fixes

### Code the phase extends
- `src/protocol/engine.ts` — XState machine, validation gate (tolerant reader + retry), terminal setStatus/decision-record wiring
- `src/protocol/converge.ts` — convergence loop, agreement/cap/deadlock guards, escalation + concessions (majority tie-break inserts here)
- `src/workspace/manifest.ts` — `setStatus`, manifest as authoritative run state (resume + paused status build on this)
- `src/protocol/decision-record.ts` — record assembly (resolver field + resolved-decisions.md sourcing change here)
- `src/schema/config.ts` — `convergenceCap` precedent for new config (mode default, etc.)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Manifest (`runs/<id>/manifest.json`) records per-phase artifacts and run status — already the source of truth for "what completed" (D-14); resume reads it.
- Per-round evaluation artifacts (`evaluation-r<n>`) persist on disk — majority tallies read them directly, no new collection step.
- 04-03 integrator drop path (`conflicts-with-resolved` + reason) — the post-hoc enforcement half of D-62 generalizes this.
- Preflight (`mar preflight`, D-26/27) — reused as the resume-time auth check (D-56).
- Validation-with-one-retry gate + tolerant frontmatter reader — unchanged foundation for any new artifact kinds.

### Established Patterns
- Statuses are terminal-write via `setStatus` (completed/escalated/failed/timeout) — `paused-awaiting-approval` joins this set; XState machine must support stopping/restarting at phase boundaries.
- All agent-facing structure rides in seeded instruction files; per-turn prompts stay thin (D-37) — the re-litigation digest must respect this.
- New schemas are zod in `src/schema/`, tests pin behavior on fake-CLI fixtures hermetically (D-49).

### Integration Points
- `src/cli.ts` — new `mar resume` subcommand; run-start mode prompt.
- `engine.ts` phase-boundary transitions — gate hooks (prompt/pause) insert between phases.
- `converge.ts` exit guards — majority tie-break inserts between "cap hit" and "escalate".

</code_context>

<specifics>
## Specific Ideas

- The gate-feedback mechanism (D-51) mirrors how the user steered the manual Claude+Codex process — short directional notes between phases, not artifact edits.
- Run 2 of the Phase-4 live checkpoint (20260605-MYPrO2) died at review below the vendor floor and wasted three completed drafts — D-57 (failed runs resumable) is directly motivated by that experience.
- Gemini auth decayed mid-day during Phase 4's live checkpoint — D-56's resume-time preflight is grounded in that observed failure mode.

</specifics>

<deferred>
## Deferred Ideas

- Dist packaging fix (`.tmpl` → dist/) and the claude `--bare` design call are Phase-4 verifier carry-overs, not new capabilities — the planner should fold them into Phase 5 plans as hardening tasks (they're listed in canonical refs), but if scoping pressure appears they are the first candidates for a dedicated fix plan.
- Credibility-weighted majority (scoring agents by review performance) — explicitly rejected for Phase 5 (D-60); note for future consideration only if 1-1 escalations become a pain point.

</deferred>

---

*Phase: 5-hardening-resume-gating-majority-guards*
*Context gathered: 2026-06-05*
