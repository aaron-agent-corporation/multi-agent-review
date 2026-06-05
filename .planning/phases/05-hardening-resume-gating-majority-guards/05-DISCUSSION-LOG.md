# Phase 5: Hardening — Resume, Gating, Majority, Guards - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-05
**Phase:** 5-hardening-resume-gating-majority-guards
**Areas discussed:** Gating & arbitration UX, Resume semantics, Majority signal mechanics, Re-litigation guard

---

## Gating & arbitration UX

| Option | Description | Selected |
|--------|-------------|----------|
| Pause-and-exit | Run writes paused status, exits; `mar resume` approves | |
| Blocking terminal prompt | Process stays alive, prompts in TTY | |
| Both | Blocking prompt by default + flag for pause-and-exit | ✓ |

**User's choice:** Both (blocking prompt default, pause-and-exit via flag)

| Option | Description | Selected |
|--------|-------------|----------|
| Approve / abort / feedback | Feedback note injected into next phase's prompts | ✓ |
| Approve / abort only | Minimal gate | |
| Approve / abort / edit artifacts | Hand-edit artifacts before approving | |

**User's choice:** Approve / abort / feedback (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Pick a side OR write a ruling | Positions + evidence shown; select or free-form rule; recorded as resolver: human | ✓ |
| Pick a side only | Choose among agents' positions | |
| Free-form ruling only | Always write the resolution | |

**User's choice:** Pick a side OR write a ruling (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Flag + config default | `--gated`/`--autonomous` over `defaults.mode` | |
| Flag only | Always explicit per invocation | |
| Interactive prompt at run start | `mar run` asks each time | ✓ |

**User's choice:** Interactive prompt at run start
**Notes:** Non-TTY/scripting bypass left to Claude's discretion (D-53).

---

## Resume semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Last completed phase | Interrupted phase re-runs from start; convergence restarts round 1 | ✓ |
| Phase + convergence round | Checkpoint each round | |
| Turn-level | Skip agents with validated artifacts | |

**User's choice:** Last completed phase (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| `mar resume <run-id>` + `--last` | Explicit id, convenience flag | ✓ |
| `mar run --resume <run-id>` | Flag on run command | |
| Auto-detect on `mar run` | Offer resume for same input doc | |

**User's choice:** `mar resume <run-id>`, with `--last` (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Manifest + artifacts + preflight | Full integrity + auth re-check | ✓ |
| Manifest only | Trust completion records | |
| Full re-validation + content hash | Tamper detection | |

**User's choice:** Manifest + artifacts + preflight (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, failed runs resumable | Re-attempt failed phase with full roster | ✓ |
| No, only interrupted/paused | Failed is terminal | |

**User's choice:** Yes, failed runs resumable (recommended)

---

## Majority signal mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Tally existing artifacts | proposedBase/verdicts already on disk | ✓ |
| Explicit vote turn | Dedicated ballot phase | |
| Hybrid | Vote turn only when tally ambiguous | |

**User's choice:** Tally existing artifacts (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Tie-break after cap | Loop primary; majority only at cap/deadlock | ✓ |
| Inform each round | Tally injected into round prompts | |
| Majority short-circuits | Clear majority settles immediately | |

**User's choice:** Tie-break after cap (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Escalate | 1-1 = no majority → escalate (D-42 path) | ✓ |
| Integrator-candidate heuristic | Deterministic proxy tie-break | |
| Weight by review performance | Credibility scoring | |

**User's choice:** Escalate (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — resolver field | convergence \| majority \| integrator \| human | ✓ |
| No — uniform entries | Mechanism only in rationale text | |

**User's choice:** Yes — resolver field (recommended)

---

## Re-litigation guard

| Option | Description | Selected |
|--------|-------------|----------|
| Inject + enforce | Digest in prompts AND post-hoc enforcement | ✓ |
| Prompt injection only | Trust agents | |
| Post-hoc enforcement only | Drop on detection, never tell | |

**User's choice:** Inject + enforce (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Rolling shared artifact | `resolved-decisions.md` in shared/, appended as forks settle | ✓ |
| Manifest field | Engine-internal structured entries | |
| Derive on demand | Recompute from artifact trail | |

**User's choice:** Rolling shared artifact (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Drop + warn, no retry | Logged `re-litigation` reason, run continues | ✓ |
| Feed back for one retry | D-38-style retry | |
| Allow with new-evidence exception | Re-open on new evidence | |

**User's choice:** Drop + warn, no retry (recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Decision + one-line rationale | Compact digest | ✓ |
| Decision only | Bare outcomes | |
| Full lineage | Decision + rationale + citations | |

**User's choice:** Decision + one-line rationale (recommended)

---

## Claude's Discretion

- Flag names for gated/autonomous/pause-and-exit; non-TTY bypass for the run-start mode prompt
- `paused-awaiting-approval` status naming and state-machine representation
- Gate feedback note storage/attribution
- Deadlock detection mechanics for the majority tie-break
- Digest rendering and injection point (thin-prompt convention applies)
- XState pause/resume modeling (re-derivation from manifest favored per D-14)

## Deferred Ideas

- Credibility-weighted majority — explicitly rejected for Phase 5 (D-60); future consideration only if 1-1 escalations become a pain point
- Dist packaging fix + claude `--bare` design call — Phase-4 carry-overs to be folded into Phase 5 plans as hardening tasks
