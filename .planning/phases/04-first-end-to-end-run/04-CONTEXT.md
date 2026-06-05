# Phase 4: First End-to-End Run - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

One complete 3-agent run through all 6 phases on a test document, producing: system-validated structured cross-reviews (REVW-01), structured per-issue responses (REVW-02), an iterative evidence-grounded evaluation that converges on a base document (REVW-03), exactly one designated integrator who alone merges (REVW-04/05), integrator-judgment disagreement resolution with logged rationale (RSLV-01), and a decision record (RCRD-01). This is the v1 success bar.

NOT in this phase: gated/paused runs and resume (PROT-05/06 — Phase 5), majority-signal tie-breaking machinery beyond what convergence naturally provides (RSLV-02 formalization — Phase 5), re-litigation guards (RCRD-02 — Phase 5), debate rounds (RSLV-04 — v2), cost reporting.

</domain>

<decisions>
## Implementation Decisions

### Review/response format + validation (REVW-01, REVW-02)
- **D-36:** Reviews and responses are markdown + YAML frontmatter (gray-matter convention): machine-readable issues/verdicts in frontmatter, human-readable prose in body. Issues are numbered with P1–P3 severity and one concrete question each; responses carry a per-issue verdict (accept / reject-with-reason / refine).
- **D-37:** Format contract is delivered via vendor-native instruction files seeded into each agent's working folder by the orchestrator: `CLAUDE.md` (claude), `AGENTS.md` (codex), `GEMINI.md` (gemini). All three are rendered from ONE source-of-truth template. Per-turn prompts stay thin — "review document X per your instructions" — no format-stuffing in prompts. This rides on the existing scoped-cwd machinery from Phase 3.
- **D-38:** Validation failure handling: ONE retry with the specific validation errors appended to the prompt. Second failure = failed turn (existing D-30 skip-failed path applies). Never silently auto-normalize.
- **D-39 (research item):** Verify codex/gemini native *skills* support (user reports codex has skills; gemini to confirm). Instruction files (D-37) are the locked default; researcher should flag only if vendor skills offer a material advantage.

### Evaluation + integrator (REVW-03, REVW-04, REVW-05, RSLV-01)
- **D-40:** Base selection is an ITERATIVE CONVERGENCE LOOP, not a one-shot vote: agents cross-evaluate each other's drafts/positions with cited evidence over repeated rounds, narrowing differences each round — systematizing the user's proven manual Claude+Codex dynamic. Through iteration the run reaches either an agreed base or an unresolvable disagreement.
- **D-41:** Loop exit conditions: (a) agreement → base picked; (b) unresolvable disagreement → escalate to user; (c) iteration cap hit → escalate to user. Iteration cap default 10, configurable in `mar.config.json`. The cap is a backstop, not a tuning knob.
- **D-42:** Escalation in Phase 4's autonomous-only mode = logged as an OPEN DECISION in the decision record for post-run user review. (Live pause-for-arbitration is Phase 5's gated mode, RSLV-03.)
- **D-43:** Token cost is explicitly NOT a design constraint for the convergence loop ("I don't give a shit about tokens"). Do not optimize rounds away at the expense of convergence quality.
- **D-44:** Integrator = the base draft's author (REVW-04). Only the integrator merges; it reviews each proposed addition before patching and may refine/reject proposals conflicting with resolved decisions (REVW-05), logging each judgment with rationale (RSLV-01).

### Decision record (RCRD-01)
- **D-45:** `decision-record.md` in `runs/<id>/` — markdown + YAML frontmatter, same gray-matter convention as reviews: machine-readable decisions in frontmatter, human rationale narrative in body.
- **D-46:** Granularity: CONTESTED ITEMS ONLY. Record an entry when agents disagreed and it was resolved (rejected-then-settled issues, convergence concessions, integrator judgment calls). Unanimous accepts get a one-line tally, not entries. The record reads as "what was argued and why it landed this way."
- **D-47:** Lineage: per-decision artifact references (e.g., "review 002-codex issue 3 → response 003-claude → integrator patch 005") plus a compact run-level chain (input → base draft → final). No duplicate full lineage graph — the manifest already indexes artifacts.

### The 3rd agent (live verification bar)
- **D-48:** The live checkpoint targets a TRUE 3-VENDOR LIVE RUN — fix gemini auth first. Primary path: `settings.json` OAuth on the user's paid tier (user holds above-free tier for every frontier model; paid tiers survive the June 18, 2026 Antigravity transition). Fallback: `GEMINI_API_KEY` (API billing). The live-checkpoint instructions must include both paths.
- **D-49:** Hermetic tests still prove all 3-agent dynamics (convergence, majority, integrator designation) on fixtures regardless — zero credits in CI, as in Phases 1–3.

### Claude's Discretion
- Convergence-round mechanics (what each round's evaluation artifact looks like, how "agreement" is detected operationally) — guided by D-40/D-41.
- Run progress UX during long convergence loops (per-round progress lines consistent with Phase 3's per-phase lines).
- Exact frontmatter schemas for reviews/responses/evaluations/decision record (zod, consistent with existing schema patterns).
- How the instruction-file template is stored and rendered (single template file in the repo rendered per vendor at run start).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Protocol foundation (what Phase 4 builds on)
- `.planning/phases/03-protocol-engine-independence-enforcement/03-02-SUMMARY.md` — XState v5 engine, PHASES descriptor, artifacts-on-disk gate, `mar run` wiring
- `.planning/phases/03-protocol-engine-independence-enforcement/03-01-SUMMARY.md` — scoped-cwd independence seam (`scope.ts`), the machinery D-37's instruction seeding rides on
- `src/protocol/phases.ts`, `src/protocol/engine.ts`, `src/protocol/gate.ts` — the engine Phase 4 extends (per-phase prompts/validators slot in here)

### Proven manual process (the behavioral spec for convergence)
- `docs-case-study.md` — the manual Claude+Codex session this phase systematizes: iterate-until-convergence dynamic, structured review style, integrator behavior, anti-patterns

### Prior decisions
- `.planning/phases/02-adapter-layer-roster-pre-flight/02-CONTEXT.md` — D-18..D-35 (roster, retry, preflight, gemini D-32)
- `.planning/REQUIREMENTS.md` — REVW-01..05, RSLV-01, RCRD-01 definitions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runPhaseGated` / `runPhase` (engine.ts): the fan-out + gate + skip-failed loop — convergence rounds are additional gated phase-like steps
- `scopedWorkdir` / `promoteDrafts` (scope.ts): per-agent folders where D-37's instruction files get seeded
- `writeArtifact` + `nextSeq` + `artifactName`: deterministic artifact trail — evaluation rounds and decision record follow the same conventions
- `withRetry(makeAdapter(...))` turn seam + `logInvocation`: every convergence-round invocation is just another audited turn
- zod schema patterns (`src/schema/`): review/response/evaluation/decision-record frontmatter schemas follow `manifest.ts`/`config.ts` conventions
- gray-matter is in the recommended stack (CLAUDE.md) but NOT yet installed — needs the package-legitimacy checkpoint pattern from Phase 3 (xstate precedent)

### Established Patterns
- Filesystem-as-truth; atomic temp-then-rename writes; monotonic seq; prompt bodies redacted from logs
- Fixture-first testing (fake-*.mjs with env-activated modes), one live human-verify checkpoint per phase
- Package legitimacy: new deps get a blocking-human verification checkpoint before install

### Integration Points
- `PHASES` descriptor (phases.ts): Phase 4 replaces placeholder prompts with real per-phase prompts + adds validation hooks and the convergence loop between review/response and integration
- `mar run` (cli.ts): gains the full structured protocol; exit codes and progress lines extend Phase 3's conventions
- `manifest.json`: gains decision-record/evaluation artifact kinds (additive schema change, like `droppedAgents`)

</code_context>

<specifics>
## Specific Ideas

- "When I did this originally by hand, I just kept giving the one agent's output to the other agent with instructions to evaluate it... Through iteration, the two sides got closer and closer until finally there was essentially agreement on what the final shape was. And that's kind of what I want this to do." — the convergence loop (D-40) IS the product; the case study (`docs-case-study.md`) is its behavioral spec.
- Seeding instruction files into spawn folders: "If you just create three folders, Claude, Codex, and Gemini, seed each one with AGENTS.md, GEMINI.md, and CLAUDE.md that tells them how to respond — that solves your problem."

</specifics>

<deferred>
## Deferred Ideas

- **pi.dev CLI tool backed by the Gemini API** as a substitute/additional adapter if the gemini CLI path dies — new adapter work, only if D-48's fallback fails
- **Grok as a 4th vendor via an API-backed CLI adapter** — user has paid Grok; PROJECT.md deferred it for lack of a CLI, but a pi.dev-style wrapper could bring it in (roadmap backlog)
- **Vendor-native skills as the instruction channel** (vs plain instruction files) — only if D-39 research shows material advantage; revisit in Phase 5 if so

</deferred>

---

*Phase: 04-first-end-to-end-run*
*Context gathered: 2026-06-05*
