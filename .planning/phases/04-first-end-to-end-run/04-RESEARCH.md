# Phase 4: First End-to-End Run - Research

**Researched:** 2026-06-05
**Domain:** Multi-CLI orchestration — structured review/response artifacts, iterative convergence loop, integrator designation, decision record (TypeScript/Node, XState v5, zod v4, gray-matter)
**Confidence:** HIGH (codebase + vendor docs verified; convergence-loop mechanics are a design decision, MEDIUM)

## Summary

Phase 4 turns the Phase-3 skeleton — a real 6-phase XState engine with gates, independence, and turn-taking but **placeholder prompt bodies** (engine.ts:110) — into the v1 success bar: a complete 3-agent run that produces structured cross-reviews, structured per-issue responses, an iterative evidence-grounded convergence loop that designates exactly one integrator, and a `decision-record.md`. Every requirement (REVW-01..05, RSLV-01, RCRD-01) is a **content + control-flow extension of existing seams**, not new infrastructure. The engine's `runPhase` fan-out, `withRetry` turn seam, `writeArtifact` trail, `scopedWorkdir` seeding, zod schema patterns, and manifest are all reusable as-is; the work is (a) real per-phase prompts delivered via vendor instruction files, (b) zod frontmatter schemas + a validation-with-one-retry gate, (c) a convergence loop inserted between response and integration, (d) integrator designation + integrator-only merge, and (e) the decision record writer.

The single highest-risk discovery: **all three vendor CLIs discover their instruction file (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`) by walking from the git project root down to cwd** [VERIFIED: developers.openai.com/codex/guides/agents-md, geminicli.com/docs/cli/gemini-md]. Because runs execute inside this very repo (`runs/<id>/work/<agent>/`), each agent will ALSO inherit this project's own root `CLAUDE.md` (which contains GSD workflow-enforcement directives) and `AGENTS.md`/`GEMINI.md` if present — polluting or overriding the seeded format contract. The plan must neutralize project-root instruction inheritance (run outside the repo, use vendor "ignore-config"/"bare" flags, or place a stop-marker). This is the #1 pitfall.

**Primary recommendation:** Extend the existing engine in-place. Add `gray-matter` (verified legitimate) for frontmatter round-tripping, define zod schemas for review/response/evaluation/decision-record frontmatter, render one source-of-truth instruction template into per-vendor files seeded into each scoped cwd, implement validation-with-one-retry (D-38) as a post-turn gate that re-invokes once with errors appended, and model the convergence loop as a bounded XState sub-loop between the response and integration phases. Keep all 3-agent dynamics provable on fixtures (D-49); gate the one true 3-vendor live run behind a human-verify checkpoint after fixing gemini auth (D-48).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Review/response format + validation (REVW-01, REVW-02)**
- **D-36:** Reviews and responses are markdown + YAML frontmatter (gray-matter convention): machine-readable issues/verdicts in frontmatter, human-readable prose in body. Issues numbered with P1–P3 severity and one concrete question each; responses carry a per-issue verdict (accept / reject-with-reason / refine).
- **D-37:** Format contract delivered via vendor-native instruction files seeded into each agent's working folder by the orchestrator: `CLAUDE.md` (claude), `AGENTS.md` (codex), `GEMINI.md` (gemini). All three rendered from ONE source-of-truth template. Per-turn prompts stay thin — "review document X per your instructions" — no format-stuffing in prompts. Rides on the existing scoped-cwd machinery from Phase 3.
- **D-38:** Validation failure handling: ONE retry with the specific validation errors appended to the prompt. Second failure = failed turn (existing D-30 skip-failed path applies). Never silently auto-normalize.
- **D-39 (research item):** Verify codex/gemini native skills support. Instruction files (D-37) are the locked default; flag only if vendor skills offer a material advantage. → **RESOLVED below: instruction files remain the default; skills are install-from-source, heavier, no advantage here.**

**Evaluation + integrator (REVW-03, REVW-04, REVW-05, RSLV-01)**
- **D-40:** Base selection is an ITERATIVE CONVERGENCE LOOP, not a one-shot vote: agents cross-evaluate each other's drafts/positions with cited evidence over repeated rounds, narrowing differences each round. Through iteration the run reaches either an agreed base or an unresolvable disagreement.
- **D-41:** Loop exit conditions: (a) agreement → base picked; (b) unresolvable disagreement → escalate to user; (c) iteration cap hit → escalate to user. Iteration cap default 10, configurable in `mar.config.json`. Cap is a backstop, not a tuning knob.
- **D-42:** Escalation in Phase 4's autonomous-only mode = logged as an OPEN DECISION in the decision record for post-run user review. (Live pause-for-arbitration is Phase 5's gated mode, RSLV-03.)
- **D-43:** Token cost is explicitly NOT a design constraint for the convergence loop. Do not optimize rounds away at the expense of convergence quality.
- **D-44:** Integrator = the base draft's author (REVW-04). Only the integrator merges; it reviews each proposed addition before patching and may refine/reject proposals conflicting with resolved decisions (REVW-05), logging each judgment with rationale (RSLV-01).

**Decision record (RCRD-01)**
- **D-45:** `decision-record.md` in `runs/<id>/` — markdown + YAML frontmatter, same gray-matter convention: machine-readable decisions in frontmatter, human rationale narrative in body.
- **D-46:** Granularity: CONTESTED ITEMS ONLY. Record an entry when agents disagreed and it was resolved. Unanimous accepts get a one-line tally, not entries. Reads as "what was argued and why it landed this way."
- **D-47:** Lineage: per-decision artifact references (e.g., "review 002-codex issue 3 → response 003-claude → integrator patch 005") plus a compact run-level chain (input → base draft → final). No duplicate full lineage graph — the manifest already indexes artifacts.

**The 3rd agent (live verification bar)**
- **D-48:** Live checkpoint targets a TRUE 3-VENDOR LIVE RUN — fix gemini auth first. Primary: `settings.json` OAuth on the user's paid tier (survives June 18, 2026 Antigravity transition). Fallback: `GEMINI_API_KEY`. Live-checkpoint instructions must include both paths.
- **D-49:** Hermetic tests still prove all 3-agent dynamics (convergence, majority, integrator designation) on fixtures regardless — zero credits in CI, as in Phases 1–3.

### Claude's Discretion
- Convergence-round mechanics (what each round's evaluation artifact looks like, how "agreement" is detected operationally) — guided by D-40/D-41.
- Run progress UX during long convergence loops (per-round progress lines consistent with Phase 3's per-phase lines).
- Exact frontmatter schemas for reviews/responses/evaluations/decision record (zod, consistent with existing schema patterns).
- How the instruction-file template is stored and rendered (single template file in the repo rendered per vendor at run start).

### Deferred Ideas (OUT OF SCOPE)
- **pi.dev CLI tool backed by the Gemini API** as a substitute/additional adapter if the gemini CLI path dies — only if D-48's fallback fails.
- **Grok as a 4th vendor via an API-backed CLI adapter** — roadmap backlog.
- **Vendor-native skills as the instruction channel** — only if D-39 research shows material advantage (it does not; see Open Question O-1).
- **From phase boundary (NOT in Phase 4):** gated/paused runs and resume (PROT-05/06 — Phase 5), majority-signal tie-breaking machinery beyond what convergence naturally provides (RSLV-02 — Phase 5), re-litigation guards (RCRD-02 — Phase 5), debate rounds (RSLV-04 — v2), cost reporting.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REVW-01 | Cross-reviews follow a structured format (numbered issues, P1–P3 severity, concrete question per issue) — validated/normalized by the system | zod `ReviewFrontmatter` schema + gray-matter parse + validation-with-one-retry gate (Pattern 2, Pattern 3); format delivered via instruction file (D-37) |
| REVW-02 | Each agent responds to reviews of its own draft with a structured per-issue verdict: accept / reject-with-reason / refine | zod `ResponseFrontmatter` (discriminated union on verdict); response phase fan-out keyed to which review targets which draft (Pattern 4) |
| REVW-03 | An evaluation step selects a base document with cited, evidence-grounded justification | Convergence loop (Pattern 5): bounded XState sub-loop emitting per-round evaluation artifacts that cite peer artifacts; agreement detection → base pick |
| REVW-04 | Exactly one integrator designated after evaluation; only the integrator merges | `participants: "integrator"` phase branch in `expectedParticipantCount` (already stubbed, gate.ts:53); integrator = base author (D-44) |
| REVW-05 | Integrator reviews proposed additions before patching; may refine/reject those conflicting with resolved decisions | Integration phase reads non-base drafts' additions, integrator turn emits per-addition verdict + patched output |
| RSLV-01 | Disagreements resolved by evidence-grounded integrator judgment; every resolution logged with rationale | Each integrator verdict + each convergence concession written to the decision record (D-46) |
| RCRD-01 | Every run produces a decision record: resolved decisions with rationale, open decisions, artifact lineage | `decision-record.md` writer (Pattern 6): zod `DecisionRecordFrontmatter`, contested-items-only (D-46), per-decision lineage refs (D-47), escalations as open decisions (D-42) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Format contract delivery (instruction files) | Workspace seeding (`scope.ts`) | Vendor CLI runtime | Each vendor reads its native file from cwd; orchestrator only seeds, never parses prompts at runtime |
| Structured output production | Vendor CLI (agent) | — | The agent authors the structured artifact per its instruction file; orchestrator does not generate content |
| Structured output validation | Orchestrator (zod gate) | — | Heterogeneous CLI output is the #1 runtime breakage source (CLAUDE.md); validation must be orchestrator-side, never trusted to the agent |
| Convergence loop control | Orchestrator (XState sub-machine) | — | Turn-taking, round counting, agreement/cap exit are protocol concerns, not agent concerns |
| Integrator designation | Orchestrator (engine, from evaluation output) | — | "Exactly one" is a structural guarantee the orchestrator enforces (REVW-04); agents only propose/justify |
| Merge / patch | Vendor CLI (the designated integrator only) | Orchestrator (gate enforcing single-writer) | Only the integrator agent writes the merged doc; orchestrator gates that no other agent does (no redundant-merge anti-pattern) |
| Decision record assembly | Orchestrator (writer) | Vendor CLI (rationale text) | Lineage/structure is orchestrator-derived from the artifact trail; rationale narrative comes from agent outputs |

## Standard Stack

### Core (already installed — reuse)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| xstate | ^5.32.0 | Convergence loop as a bounded sub-machine; integrator-branch states | Already the engine substrate; bounded loops with guards are statechart-native [VERIFIED: package.json] |
| zod | ^4 | Review/response/evaluation/decision-record frontmatter schemas | Existing schema pattern (`src/schema/*`); `z.infer` + discriminated unions for verdicts [VERIFIED: codebase] |
| execa | ^9 | Subprocess turn execution (unchanged) | Existing turn seam [VERIFIED: package.json] |
| pino | ^10 | Per-turn invocation log (unchanged) | Existing audit trail [VERIFIED: package.json] |
| fs-extra | ^11 | Atomic artifact writes, instruction-file seeding (unchanged) | Existing workspace layer [VERIFIED: codebase] |

### Supporting (ONE new dependency)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| gray-matter | ^4 (4.0.3) | Parse/serialize YAML frontmatter + markdown body for reviews/responses/evaluations/decision record (D-36/D-45) | When reading agent artifacts back for validation and when writing the decision record. The repo currently hand-rolls frontmatter SERIALIZATION (artifacts.ts `toFrontmatter`/`yamlScalar`) but has NO parser — gray-matter is needed to READ frontmatter back out for validation. |

**gray-matter 4.0.3** [VERIFIED: npm registry — but see provenance note]: 6.6M weekly downloads, maintainers jonschlinkert/doowb/rmassaioli (Atlassian), `git+github.com/jonschlinkert/gray-matter`, deps js-yaml/kind-of/section-matter/strip-bom-string, last modified 2023-07-12 (stable, mature). It is the package named in this project's own CLAUDE.md recommended stack.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| gray-matter (parse) | Hand-rolled YAML parse using js-yaml directly | gray-matter is the documented stack choice and round-trips body+frontmatter cleanly; raw js-yaml means re-implementing the `---` delimiter split the repo's `toFrontmatter` only does one-way. Use gray-matter. |
| gray-matter (serialize) | Keep existing `artifacts.ts toFrontmatter` for WRITING, use gray-matter only for READING | Viable and lower-risk: the existing injection-safe serializer (yamlScalar control-char stripping) is battle-tested. **Recommendation: keep writing via the existing serializer, add gray-matter ONLY for parsing/validation reads.** Avoids re-securing serialization. |
| zod discriminated union for verdicts | Plain enum + optional reason field | Discriminated union on `verdict` (`reject-with-reason` requires `reason`) is stronger — mirrors the existing `config.ts` `discriminatedUnion("vendor", ...)` pattern. Use it. |

**Installation:**
```bash
npm install gray-matter@^4
```
Run through the Phase-3 package-legitimacy human-verify checkpoint pattern (xstate precedent, 03-02 Task 0) before install.

**Version verification:**
```bash
npm view gray-matter version   # → 4.0.3 (confirmed 2026-06-05)
```

## Package Legitimacy Audit

> slopcheck was not available in this session; gray-matter is verified via npm registry metadata + it is named in the project's own CLAUDE.md recommended stack. Treat as `[ASSUMED-PENDING-CHECKPOINT]` per the graceful-degradation rule — the planner MUST gate the install behind a `checkpoint:human-verify` task (the established Phase-3 xstate pattern).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| gray-matter | npm | ~2.8 yrs since last publish (4.0.3, 2023-07-12); pkg ~10 yrs | 6.65M/wk | github.com/jonschlinkert/gray-matter | unavailable | Approved — gate behind human-verify checkpoint |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Postinstall check:**
```bash
npm view gray-matter scripts.postinstall   # → (none); no postinstall script
```

## Architecture Patterns

### System Architecture Diagram

```text
mar run <input>
   │
   ▼
loadConfig ─► assertReviewable (≥2 vendors) ─► createRun ─► runProtocol (XState)
                                                                │
   ┌────────────────────────────────────────────────────────────┘
   ▼
 [1 DRAFT]  scopedWorkdir per agent ──┐ each agent's work/<agent>/ seeded with:
   │  (independence: PROT-04)         │   • input.md
   │                                  └─► • CLAUDE.md|AGENTS.md|GEMINI.md   ← D-37 instruction file
   ▼                                       (rendered from ONE template)
 promoteDrafts ─► shared/
   ▼
 [2 REVIEW]  each agent reviews every PEER draft
   │   thin prompt: "review <peer-draft> per your instructions"
   │   ▼ agent emits frontmatter(issues[]:{n,severity P1-P3,question}) + body
   │   ▼ ORCHESTRATOR VALIDATES (zod ReviewFrontmatter)
   │       fail → re-invoke ONCE with errors appended (D-38)
   │       fail again → failed turn → D-30 skip-failed
   ▼
 [3 RESPONSE]  each agent answers reviews OF ITS OWN draft
   │   ▼ frontmatter(responses[]:{issueRef,verdict accept|reject-with-reason|refine,reason?})
   │   ▼ validate (zod ResponseFrontmatter, one-retry)
   ▼
 [4 EVALUATION = CONVERGENCE LOOP]  ◄────────────────┐  (D-40, bounded sub-machine)
   │   round r: each agent cross-evaluates peers'      │
   │     positions WITH CITED EVIDENCE → evaluation    │
   │     artifact (frontmatter: agreements/remaining   │
   │     disagreements + proposed base + citations)    │
   │   ▼ agreement-detection guard ──────────────────┘ (loop while disagreement & r < cap)
   │       (a) agreement   → designate base + integrator (base author)  → exit
   │       (b) unresolvable→ log OPEN DECISION (D-42)  → escalate-exit
   │       (c) r == cap    → log OPEN DECISION (D-42)  → escalate-exit
   ▼
 [5 INTEGRATION]  participants: INTEGRATOR ONLY (REVW-04)
   │   integrator reads non-base additions, emits PER-ADDITION verdict
   │   (accept|refine|reject-conflicts-with-resolved) + patched merged doc (REVW-05)
   │   each verdict + rationale → decision record (RSLV-01)
   ▼
 [6 VALIDATION]  final targeted review of merged doc (catch edge cases)
   ▼
 WRITE decision-record.md (RCRD-01): contested resolved decisions + open decisions
   + per-decision lineage refs + compact run chain (D-45/46/47)
   ▼
 setStatus("completed") ─► manifest indexes all artifacts
```

### Recommended Project Structure (additions only)
```
src/
├── protocol/
│   ├── phases.ts            # extend: per-phase prompt + validator + participants
│   ├── engine.ts            # extend: real prompts, validation gate, integrator branch
│   └── converge.ts          # NEW: convergence sub-machine (loop, agreement guard, cap)
├── schema/
│   ├── review.ts            # NEW: ReviewFrontmatter (issues[]: n, severity, question)
│   ├── response.ts          # NEW: ResponseFrontmatter (verdict discriminated union)
│   ├── evaluation.ts        # NEW: EvaluationFrontmatter (round, agreements, base, citations)
│   └── decision-record.ts   # NEW: DecisionRecordFrontmatter (resolved[], open[], lineage)
├── protocol/
│   ├── instructions.ts      # NEW: render ONE template → per-vendor instruction files; seed into cwd
│   └── decision-record.ts   # NEW: assemble + write decision-record.md from the artifact trail
└── templates/
    └── agent-instructions.md.tmpl   # NEW: single source-of-truth format contract
```

### Pattern 1: Per-phase prompt + validator as TYPED DATA (extend PHASES descriptor)
**What:** Phase 3 made the 6 phases a frozen `as const` descriptor (`phases.ts`). Phase 4 adds two fields per phase: a `prompt` (thin, references the instruction file) and an optional `validate` (zod schema). The engine's `runPhase` loop reads them instead of the hardcoded placeholder at engine.ts:110.
**When to use:** Always — keeps the engine a pure iterator over typed phase data (the established repo idiom; mirrors `adapters/registry.ts`).
**Example:**
```typescript
// Extend the Phase interface (phases.ts) — kind === name preserved
export interface Phase {
  readonly name: "draft" | "review" | "response" | "evaluation" | "integration" | "validation";
  readonly kind: string;
  readonly scoped: boolean;
  readonly participants: "all" | "integrator";   // integrator branch now LIVE (REVW-04)
  readonly prompt: (ctx: PhasePromptCtx) => string;        // thin, per D-37
  readonly validate?: (frontmatter: unknown) => ValidationResult;  // zod gate (REVW-01/02)
}
```

### Pattern 2: Validation-with-one-retry gate (D-38)
**What:** After a turn writes its artifact, parse the frontmatter (gray-matter) and validate (zod). On failure, re-invoke the SAME agent ONCE with the validation errors appended to the thin prompt. Second failure → treat as a failed turn so the existing D-30 `applySkipFailed` path drops the agent (≥2 vendors must survive). Never auto-normalize.
**When to use:** Every structured phase (review, response, evaluation, integration).
**Example:**
```typescript
// Source: derived from engine.ts withRetry seam + zod safeParse
async function turnWithValidation(invoke, validate, prompt, errAppend): Promise<TurnResult> {
  let turn = await invoke(prompt);
  let parsed = validate(turn);               // gray-matter parse → zod safeParse
  if (parsed.ok) return { ...turn, ok: true };
  // D-38: ONE retry with the specific zod errors appended (NOT a generic "try again")
  turn = await invoke(`${prompt}\n\n## Validation errors to fix\n${parsed.errors}`);
  parsed = validate(turn);
  return parsed.ok ? { ...turn, ok: true } : { ...turn, ok: false, error: "validation-failed" };
}
```
**Note:** This wraps INSIDE the existing `withRetry` (which handles transient CLI failures); validation-retry is a distinct, semantic retry on top of transport-retry. Keep them separate — do not conflate the D-23 transport `retries: 2` with the D-38 single validation retry.

### Pattern 3: Frontmatter parse for validation (gray-matter, read-only)
**What:** Use gray-matter ONLY to READ frontmatter back out of an artifact for validation; keep the existing injection-safe `toFrontmatter` serializer for WRITING (it already strips control chars / CR-01).
```typescript
import matter from "gray-matter";
const { data, content } = matter(fs.readFileSync(artifactPath, "utf8"));
const result = ReviewFrontmatter.safeParse(data);   // zod
```

### Pattern 4: Review/response targeting (who reviews/answers whom)
**What:** In review, each agent reviews every PEER draft (N agents → N×(N-1) review artifacts, or N reviews each covering all peers — pick one; case study did one review-per-peer-pair). In response, each agent answers ONLY reviews OF ITS OWN draft. The orchestrator must thread "which artifact targets which draft" — add a `targets: <agent>` field to review frontmatter so the response phase can route.
**When to use:** Review and response phases. This is new control flow over the existing all-mode fan-out.

### Pattern 5: Convergence loop as a bounded XState sub-machine (D-40/41)
**What:** Insert a sub-machine between response and integration. Each iteration is a fan-out round (reuse `runPhase`) emitting per-agent evaluation artifacts that cite evidence. An **agreement-detection guard** inspects the round's artifacts: if agents converge on the same base → exit with `{base, integrator}`; if a hard disagreement persists → exit `escalate`; if `round === cap` (config `convergenceCap`, default 10, D-41) → exit `escalate`. Escalation logs an OPEN DECISION (D-42), it does NOT pause (autonomous-only in Phase 4).
**When to use:** The evaluation phase (REVW-03). This is the product (D-40).
**Agreement detection (Claude's discretion, D-40):** Recommended operational signal — each round's evaluation frontmatter carries a `proposedBase: <agent>` field and a `remainingDisagreements: []` list. Agreement = all surviving agents propose the same base AND `remainingDisagreements` is empty (or all marked `conceded`). This is observable from artifacts (filesystem-as-truth), not from model self-report of "we agree."
```typescript
// converge.ts — sketch (XState bounded loop)
states: {
  round: {
    invoke: { src: "evaluationRound",  // reuse runPhase over surviving roster
      onDone: [
        { guard: "agreed",       target: "designate" },   // same proposedBase, no open disagreements
        { guard: "capReached",   target: "escalate" },    // round === convergenceCap (D-41c)
        { guard: "unresolvable", target: "escalate" },     // explicit deadlock signal (D-41b)
        { target: "round", actions: "incrementRound" },    // else loop (D-43: don't cut rounds)
      ] } },
  designate: { /* base = proposedBase; integrator = base author (D-44) */ },
  escalate:  { /* push OPEN DECISION to record (D-42); pick a fallback base or fail run */ },
}
```
**Open sub-question (see O-2):** on escalate, does the run still attempt integration with a fallback base, or terminate as `failed`/`escalated`? Recommendation below.

### Pattern 6: Decision record writer (RCRD-01, contested-only)
**What:** After validation, assemble `decision-record.md` from the artifact trail. Frontmatter: `resolvedDecisions[]` (only contested-then-settled items, D-46), `openDecisions[]` (escalations, D-42), and per-decision `lineage` (artifact refs, D-47). Body: human rationale narrative. Unanimous accepts → a single `unanimousTally: N` field, not entries.
**When to use:** Once, at run end (terminal write, like `setStatus`). Source the contested items from: response `reject-with-reason`/`refine` verdicts, convergence concessions, and integrator `refine`/`reject` judgments.

### Anti-Patterns to Avoid
- **Auto-merging every accepted suggestion** (case study #1 anti-pattern; REQUIREMENTS Out of Scope): integrator MUST review additions before patching (REVW-05).
- **Redundant merging** (case study "What didn't work well"): do NOT let multiple agents merge then compare — designate ONE integrator (REVW-04). The whole point of evaluation.
- **Format-stuffing the per-turn prompt** (violates D-37): the format contract lives in the instruction file, not the prompt. Thin prompts only.
- **Silent normalization of malformed output** (violates D-38): validate, retry once, then fail — never quietly fix.
- **Trusting model self-report for agreement** (convergence): detect agreement from artifact fields, not from prose "I agree."
- **Letting the run's git-root instruction files leak into agents** (see Pitfall 1): the project's own CLAUDE.md/AGENTS.md would override the seeded contract.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Frontmatter parsing | Custom `---` splitter + YAML parse | gray-matter | Edge cases (BOM, CRLF, `---` in body, empty frontmatter) already handled; it's the documented stack pick |
| Bounded loop with guards/exit conditions | Hand-rolled `while` + counter in engine.ts | XState sub-machine | Cap, agreement, and escalate are guarded transitions; statechart keeps them inspectable and resumable (Phase 5 resume) |
| Structured-output validation | `if (!obj.issues) ...` ad-hoc checks | zod schema + safeParse | Heterogeneous CLI output is the #1 runtime breakage source (CLAUDE.md); zod gives typed errors to feed the D-38 retry |
| Verdict modeling | enum + free-form fields | zod discriminated union on `verdict` | Enforces `reject-with-reason` carries a reason; mirrors existing `config.ts` union pattern |
| Per-agent format instruction delivery | Stuffing format into every prompt | Vendor instruction file in cwd (D-37) | Each vendor natively reads its file; keeps prompts thin and the contract single-sourced |
| Subprocess invocation, retry, logging, artifact write, manifest, gate | Anything new | Existing `withRetry`/`logInvocation`/`writeArtifact`/`addArtifact`/`requiredArtifactsExist` | Phase 3 already built and tested all of it; Phase 4 is content + control flow only |

**Key insight:** Phase 4 adds almost no infrastructure. The engine, gate, independence, retry, logging, manifest, and atomic writes exist and are tested (196 tests green). The genuinely new code is: schemas, the instruction-file template+renderer, the validation gate, the convergence sub-machine, and the decision-record writer. Everything else is reuse.

## Common Pitfalls

### Pitfall 1: Project-root instruction-file inheritance pollutes the seeded contract (HIGHEST RISK)
**What goes wrong:** All three CLIs walk from the **git project root down to cwd** discovering instruction files [VERIFIED: codex AGENTS.md guide, gemini GEMINI.md docs]. Runs live in `runs/<id>/work/<agent>/` INSIDE this repo, whose root has a `CLAUDE.md` containing GSD workflow-enforcement directives ("start work through a GSD command", "Do not make direct repo edits"). Codex reads `~/.codex/AGENTS.md` (global) + every `AGENTS.md` from git-root to cwd; Gemini concatenates `~/.gemini/GEMINI.md` + all `GEMINI.md` from root to cwd. The seeded per-agent file is therefore MERGED WITH (Gemini) or layered under (Codex/Claude) the project's own files — the format contract gets diluted or contradicted.
**Why it happens:** Phase 3 ran with placeholder prompts that needed no instruction file, so this never surfaced. Phase 4 is the first time the instruction file is load-bearing.
**How to avoid (pick one, verify empirically in a Wave-0 spike):**
  1. **Run agents with a cwd OUTSIDE the repo** (e.g., copy the scoped workdir to an OS temp dir) — cleanest isolation, but breaks the in-repo `runs/` convention.
  2. **Use each vendor's config-ignore / bare flag** (claude `--bare` is already recommended in CLAUDE.md; codex `--ignore-user-config` / `-c project_doc_fallback_filenames=[]`; gemini folder-trust off / `--include-directories` scoping) to suppress ancestor discovery — but `--bare`/`--ignore-user-config` suppress the GLOBAL files, NOT necessarily the in-tree ancestor walk. Verify per vendor.
  3. **Neutralize at the run root:** ensure no `AGENTS.md`/`GEMINI.md` exists at this repo's root (only `CLAUDE.md` does today — confirmed), and for Claude use `--bare`. Gemini/Codex would still walk to the seeded file as the nearest; confirm the nearest wins / how concatenation orders.
**Warning signs:** Agent output references "GSD workflow", refuses to write because of "GSD enforcement", or ignores the issue/severity format. **This must be settled in a Wave-0 spike BEFORE the live checkpoint** — it directly threatens success criterion #2.

### Pitfall 2: Manifest concurrent-write race (already hit in Phase 3)
**What goes wrong:** Concurrent `addArtifact` calls inside a fan-out corrupt `manifest.json` (shared `tmp-${pid}` temp file). Phase 3 fixed this by serializing manifest writes after `allSettled` (03-02 deviation #1).
**How to avoid:** Any new fan-out (convergence rounds, multi-review) MUST follow the same rule: agents write independent ARTIFACT files concurrently; manifest `addArtifact` runs SEQUENTIALLY after the settle. Do not regress this.
**Warning signs:** "Unexpected non-whitespace after JSON" in tests; lost artifacts.

### Pitfall 3: Seq collision in convergence rounds
**What goes wrong:** Convergence runs the SAME phase kind ("evaluation") multiple times. The Phase-3 `nextSeq` derivation (max seq on disk + 1) handles monotonicity, but each round's artifacts share `kind: "evaluation"` — naming `NNN-<agent>-evaluation.md` collides across rounds.
**How to avoid:** Disambiguate rounds in the artifact name or kind (e.g., `kind: "evaluation-r2"` or include the round in seq via `nextSeq`). The existing `nextSeq(base+index)` shared-phase logic gives distinct seqs per round automatically IF each round reads the manifest fresh; verify the round loop re-reads the manifest each iteration (it should, since `runPhase` reads the manifest at entry).
**Warning signs:** A later round overwrites an earlier round's evaluation artifact; lineage refs point to the wrong round.

### Pitfall 4: Integrator-only phase breaks the `expectedParticipantCount` gate
**What goes wrong:** Phase 3's gate asserts `writtenPaths.length === roster.length` for all-mode phases. Integration is `participants: "integrator"` — exactly ONE writer. The gate stub (gate.ts:53) already documents this as "the future branch point" but currently returns `roster.length` for both branches.
**How to avoid:** Implement the `participants: "integrator"` branch in `expectedParticipantCount` to return 1, and ensure `runPhase` fans out over ONLY the integrator (not the whole surviving roster) for that phase. This is the designed extension seam — wire it, don't bypass it.
**Warning signs:** Integration phase fails the gate with "wrote 1/3 required artifacts".

### Pitfall 5: Validation-retry conflated with transport-retry
**What goes wrong:** The existing `withRetry` (D-23, default 2) handles transient CLI failures. D-38's single validation-retry is semantically different (the CLI succeeded but produced malformed content). Wrapping validation inside `withRetry`'s classify path would either burn transport retries on content errors or apply the wrong count.
**How to avoid:** Keep them layered: `withRetry` for transport (returns a successful turn), THEN a separate single validation-retry on the turn's content. Pattern 2 shows the structure.

### Pitfall 6: Gemini auth blocks the true 3-vendor live run (D-48)
**What goes wrong:** Gemini CLI headless auth is the known churn risk (STATE.md blockers; D-32). The live checkpoint needs a real 3-vendor run; if gemini can't authenticate headlessly, the checkpoint degrades to 2-vendor.
**How to avoid:** Fix gemini auth FIRST (D-48): primary `settings.json` OAuth on the paid tier; fallback `GEMINI_API_KEY`. Hermetic fixtures prove all 3-agent dynamics regardless (D-49), so CI is never blocked — only the single human-verify checkpoint depends on live gemini.
**Warning signs:** gemini preflight fails auth; live run drops to claude+codex.

## Code Examples

### zod ReviewFrontmatter (REVW-01) — mirrors existing schema style
```typescript
// src/schema/review.ts — pattern from src/schema/config.ts
import { z } from "zod";
export const ReviewIssue = z.object({
  n: z.number().int().positive(),
  severity: z.enum(["P1", "P2", "P3"]),     // REVW-01
  question: z.string().min(1),              // exactly one concrete question per issue
});
export const ReviewFrontmatter = z.object({
  phase: z.literal("review"),
  author: z.string().min(1),
  targets: z.string().min(1),               // which draft this review critiques (Pattern 4)
  issues: z.array(ReviewIssue).min(1),
});
export type ReviewFrontmatter = z.infer<typeof ReviewFrontmatter>;
```

### zod ResponseFrontmatter (REVW-02) — discriminated union on verdict
```typescript
// src/schema/response.ts
import { z } from "zod";
const Verdict = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("accept"), issueRef: z.number().int().positive() }),
  z.object({ verdict: z.literal("reject-with-reason"), issueRef: z.number().int().positive(), reason: z.string().min(1) }),
  z.object({ verdict: z.literal("refine"), issueRef: z.number().int().positive(), refinement: z.string().min(1) }),
]);
export const ResponseFrontmatter = z.object({
  phase: z.literal("response"),
  author: z.string().min(1),
  reviewOf: z.string().min(1),              // which review artifact this answers
  responses: z.array(Verdict).min(1),
});
```

### Instruction-file rendering (D-37) — one template → three files
```typescript
// src/protocol/instructions.ts
const VENDOR_FILE = { claude: "CLAUDE.md", codex: "AGENTS.md", gemini: "GEMINI.md" } as const;
export async function seedInstructions(workdir: string, vendor: keyof typeof VENDOR_FILE) {
  const template = await readFile("src/templates/agent-instructions.md.tmpl", "utf8");
  // single source of truth; no per-vendor format divergence (D-37)
  await writeFile(join(workdir, VENDOR_FILE[vendor]), template, "utf8");
}
// Called inside the scopedWorkdir seam (scope.ts) alongside input.md copy.
```

## State of the Art

| Old Approach (Phase 3) | Current Approach (Phase 4) | When Changed | Impact |
|------------------------|----------------------------|--------------|--------|
| Placeholder prompt `phase: <name>\ninput: <path>` (engine.ts:110) | Real per-phase prompts + instruction-file contract | Phase 4 | Agents produce structured content |
| All phases `participants: "all"` | Integration is `participants: "integrator"` | Phase 4 (REVW-04) | Single-writer merge gate |
| No content validation | zod frontmatter validation + one-retry | Phase 4 (D-38) | Malformed output caught/retried |
| Linear 6-phase walk | Bounded convergence sub-loop in evaluation | Phase 4 (D-40) | Iterative base selection |
| No decision record | `decision-record.md` at run end | Phase 4 (RCRD-01) | Auditable resolved/open decisions |

**Deprecated/outdated:** none — Phase 4 is purely additive over Phase 3's tested foundation.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | gray-matter 4.0.3 is the right parser and slopcheck would rate it OK | Standard Stack / Audit | LOW — 6.6M weekly downloads, in project's own stack; gated by human-verify checkpoint regardless |
| A2 | Each vendor's nearest (seeded) instruction file is honored when ancestor files also exist, and ancestor inheritance can be suppressed per vendor | Pitfall 1 | HIGH — if not suppressible, the seeded format contract is unreliable; MUST be settled in a Wave-0 spike. This is the load-bearing assumption for REVW-01. |
| A3 | Agreement can be detected from an artifact field (`proposedBase` + empty `remainingDisagreements`) rather than model self-report | Pattern 5 | MEDIUM — if convergence signal is noisier, the cap (D-41c) backstops it; affects loop quality not correctness |
| A4 | `nextSeq` re-read per convergence round yields distinct seqs across rounds | Pitfall 3 | MEDIUM — round artifacts could collide; mitigated by kind/round disambiguation |
| A5 | Integrator = base author and integration runs that ONE agent only | Pattern, Pitfall 4 | LOW — directly stated in D-44; gate branch is pre-stubbed |

## Open Questions (RESOLVED)

1. **O-1 (D-39 RESOLVED): Do vendor skills beat instruction files?** → **No.** Codex skills (`~/.codex/skills/`, install via `gemini/codex skills install <git|path>`) and Gemini skills (`gemini skills install/link`, scoped) are **install-from-source package systems**, not per-run ephemeral contracts. Seeding a `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` into the scoped cwd (D-37) is lighter, single-sourced, requires no install step, and rides the existing scope.ts seam. **Recommendation: keep instruction files as the default (D-37 confirmed); do not use vendor skills.** Re-evaluate only if Pitfall 1's ancestor-inheritance problem proves unsolvable for instruction files but solvable via skills (unlikely — skills also load globally).

2. **O-2 (RESOLVED): On convergence escalation (D-41b/c), does the run still integrate with a fallback base, or terminate?** → **Reading (a): fallback-base integrate.** D-42 says escalation is logged as an open decision for post-run review (autonomous mode). Two readings: (a) pick the most-supported proposed base as a provisional base, integrate, and log the unresolved fork as an open decision (produces a usable artifact + record); (b) terminate as a distinct `escalated` status with no merged doc. **RESOLVED: (a)** — Phase 4's success bar requires producing a decision record AND the run should yield a best-effort artifact; the open decision flags it for the user. **Implemented in 04-04 Task 1** (`escalate` picks the most-supported proposedBase as a provisional fallback base, designates its author as integrator, resolves `status:"escalated"` + `openDecision`); the additive `escalated` manifest status is added in 04-03.

3. **O-3 (RESOLVED): Review fan-out shape — one review per peer-pair, or one review covering all peers?** → **One review per (reviewer → target) pair.** Case study did per-pair (Claude reviewed Codex, Codex reviewed Claude). With 3 agents that's 6 directed reviews. Alternative: each agent emits ONE review artifact with per-peer sections. **RESOLVED: one review artifact per (reviewer → target) pair** — matches the case study, keeps `targets` single-valued (simpler response routing, Pattern 4), and the fan-out count is deterministic for the gate. **Implemented via the single-valued `targets` field in `ReviewFrontmatter`** (04-01) and per-pair fan-out routing (04-03).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| claude CLI | live 3-vendor checkpoint (D-48) | ✓ | 2.1.163 | — (fixtures for CI, D-49) |
| codex CLI | live 3-vendor checkpoint | ✓ | 0.128.0 | — (fixtures) |
| gemini CLI | live 3-vendor checkpoint | ✓ (installed) | 0.45.0 | API key (D-48 fallback); fixtures for CI |
| gemini headless AUTH | true 3-vendor live run | ✗ unverified | — | `GEMINI_API_KEY` billing (D-48); else 2-vendor live + 3-vendor fixtures (D-49) |
| gray-matter (npm) | frontmatter parse | ✗ not installed | 4.0.3 avail | none — required; gate behind human-verify checkpoint |
| node | runtime | ✓ | ≥22 | — |

**Missing dependencies with no fallback:** gray-matter (must install — checkpoint-gated).
**Missing dependencies with fallback:** gemini headless auth (fallback: API key, then fixtures-only for the 3rd vendor — D-48/D-49 already plan for this).

## Validation Architecture

> nyquist_validation status not found in a `.planning/config.json` (file absent) — treating as ENABLED per the default rule.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4 [VERIFIED: package.json] |
| Config file | none standalone; `npm test` → `vitest run` |
| Quick run command | `npx vitest run test/<file>.test.ts` |
| Full suite command | `npx vitest run` (196 tests green at Phase 3 close) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REVW-01 | Review frontmatter validates; malformed → one retry → fail | unit | `npx vitest run test/review-schema.test.ts` | ❌ Wave 0 |
| REVW-01/02 | Validation-with-one-retry gate (D-38) | unit | `npx vitest run test/validation-retry.test.ts` | ❌ Wave 0 |
| REVW-02 | Response verdict discriminated union (reject requires reason) | unit | `npx vitest run test/response-schema.test.ts` | ❌ Wave 0 |
| REVW-03 | Convergence loop: agreement exit, cap exit, escalate exit | unit | `npx vitest run test/converge.test.ts` | ❌ Wave 0 |
| REVW-04 | Exactly one integrator; integration gate expects 1 writer | unit | `npx vitest run test/protocol-gate.test.ts` (extend) | ✅ extend |
| REVW-05 | Integrator per-addition verdict + reject-on-conflict | unit | `npx vitest run test/integration.test.ts` | ❌ Wave 0 |
| RSLV-01 | Each integrator/convergence resolution logged with rationale | unit | `npx vitest run test/decision-record.test.ts` | ❌ Wave 0 |
| RCRD-01 | Decision record: resolved + open + lineage, contested-only | unit | `npx vitest run test/decision-record.test.ts` | ❌ Wave 0 |
| D-37 | Instruction files seeded per vendor; ancestor inheritance neutralized | unit + spike | `npx vitest run test/instructions.test.ts` | ❌ Wave 0 |
| all | Full 3-agent run produces decision record (success #1) | e2e (fixtures) | `npx vitest run test/protocol-run.e2e.test.ts` (extend) | ✅ extend |

### Sampling Rate
- **Per task commit:** the task's own `npx vitest run test/<file>.test.ts`
- **Per wave merge:** `npx vitest run` (full suite) + `npx tsc --noEmit` + `npx biome check`
- **Phase gate:** full suite green + live 3-vendor human-verify checkpoint before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/review-schema.test.ts` — REVW-01
- [ ] `test/response-schema.test.ts` — REVW-02
- [ ] `test/validation-retry.test.ts` — D-38 one-retry gate
- [ ] `test/converge.test.ts` — REVW-03 loop exits (agreement/cap/escalate)
- [ ] `test/integration.test.ts` — REVW-04/05 integrator-only + addition verdicts
- [ ] `test/decision-record.test.ts` — RCRD-01/RSLV-01
- [ ] `test/instructions.test.ts` — D-37 seeding + **ancestor-inheritance neutralization spike** (Pitfall 1)
- [ ] Fixture extension: fake-CLI `--emit` modes for structured review/response/evaluation/integration content (extend the Phase-3 `--emit <kind>` fixtures so a hermetic run yields VALID structured artifacts)
- [ ] Install: `gray-matter@^4` (checkpoint-gated)

## Security Domain

> `security_enforcement` config not found (file absent) — including this section per the default (enabled). Phase 4 inputs in this phase are TEST documents (untrusted legal-document inputs are flagged for Phase 5 in STATE.md), so the surface is moderate.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Encoding/Injection (frontmatter) | yes | Existing injection-safe `toFrontmatter`/`yamlScalar` (artifacts.ts) strips control chars; gray-matter PARSE with `js-yaml` SAFE schema (no `!!js/function`) — verify gray-matter uses safe load (it does by default) |
| V5 Input Validation | yes | zod `safeParse` on all agent frontmatter (REVW-01/02); never trust CLI output shape |
| V5 Path traversal | yes | Existing `AGENT_NAME_RE` charset gate (scope.ts) + `RUN_ID_RE`; instruction-file seeding reuses the same `join(runDir, ...)` containment |
| V12 File handling | yes | Atomic temp-then-rename writes (artifacts.ts); input bounded to 10MB (engine path) |
| V6 Cryptography | no | No secrets handled in-protocol (gemini auth is vendor-managed) |

### Known Threat Patterns for multi-CLI orchestration
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| YAML deserialization RCE via crafted frontmatter | Elevation of Privilege | gray-matter defaults to js-yaml `safeLoad`; confirm no custom unsafe schema is passed |
| Malicious agent output escaping frontmatter delimiters | Tampering | zod validation rejects malformed; existing serializer escapes on write |
| Prompt-injection via the input document influencing review content | Tampering | Out of Phase 4 scope (TEST docs only); STATE.md flags it for Phase 5 (untrusted legal inputs) — note for the planner not to over-build here |
| Instruction-file inheritance overriding the format contract | Tampering / integrity | Pitfall 1 neutralization (the load-bearing control) |
| Agent name path traversal in seeded dirs | Tampering | Existing `assertSafeAgent` charset gate reused |

## Sources

### Primary (HIGH confidence)
- Codebase (verified directly): `src/protocol/{engine,phases,gate}.ts`, `src/workspace/{scope,artifacts,layout}.ts`, `src/schema/{config,manifest}.ts`, `package.json`, Phase 3 SUMMARYs, `docs-case-study.md` — the behavioral spec and existing seams.
- [developers.openai.com/codex/guides/agents-md](https://developers.openai.com/codex/guides/agents-md) — Codex AGENTS.md discovery walks git-root→cwd, global `~/.codex/AGENTS.md`, `--cd`, fallback filenames. HIGH.
- [geminicli.com/docs/cli/gemini-md](https://geminicli.com/docs/cli/gemini-md/) — Gemini GEMINI.md discovery (cwd + ancestors to `.git` root + global `~/.gemini/GEMINI.md`, concatenated; subdirectory scan). HIGH.
- npm registry (`npm view gray-matter`): 4.0.3, 6.65M weekly downloads, jonschlinkert/Atlassian maintainers, no postinstall. HIGH.
- Installed CLI probes: claude 2.1.163, codex-cli 0.128.0, gemini 0.45.0; `gemini skills` / `~/.codex/skills` subsystems confirmed present. HIGH.

### Secondary (MEDIUM confidence)
- [developers.openai.com/codex/cli/reference](https://developers.openai.com/codex/cli/reference), [shipyard.build/blog/codex-cli-cheat-sheet](https://shipyard.build/blog/codex-cli-cheat-sheet/) — codex `--ignore-user-config`, `project_doc_fallback_filenames`. MEDIUM.
- Project `CLAUDE.md` recommended stack — gray-matter, zod, xstate, execa pins; vendor flag reference. MEDIUM (project-internal, may drift with CLI versions).

### Tertiary (LOW confidence)
- D-48 gemini paid-tier OAuth surviving the June 18 2026 Antigravity transition — asserted in CONTEXT, not re-verified this session; the API-key fallback + fixtures (D-49) de-risk it.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all but gray-matter already installed/tested; gray-matter verified on npm + in project stack.
- Architecture / reuse map: HIGH — verified against actual engine/gate/scope source; every requirement maps to a named existing seam.
- Convergence-loop mechanics: MEDIUM — D-40/41 lock the shape; agreement-detection operationalization is Claude's discretion (A3, O-2/O-3).
- Pitfall 1 (instruction inheritance): MEDIUM on the FIX, HIGH on the RISK — discovery behavior is doc-verified; suppressibility per vendor needs a Wave-0 spike.
- Pitfalls (manifest race, seq, integrator gate): HIGH — derived from Phase 3's actual fixes/stubs.

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable libs) — but CLI flag surfaces (codex/gemini) drift between minor versions; re-verify instruction-discovery flags at planning time if a CLI updates.
