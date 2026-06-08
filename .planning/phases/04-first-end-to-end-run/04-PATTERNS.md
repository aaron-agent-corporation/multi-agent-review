# Phase 4: First End-to-End Run - Pattern Map

**Mapped:** 2026-06-05
**Files analyzed:** 14 (8 new source, 3 modified source, 1 template, plus 7 new test files + 2 test extensions)
**Analogs found:** 14 / 14 (every new file has an in-repo analog — Phase 4 is additive over Phase 3)

> Phase 4 adds almost NO infrastructure. The engine, gate, independence seam, retry, logging,
> manifest, and atomic writes already exist and are tested (196 green). New code is: zod schemas,
> the instruction-file template+renderer, the validation-with-one-retry gate, the convergence
> sub-machine, the decision-record writer, and fixture extensions. Everything else is reuse.
> Every analog below is a REAL existing file in this repo — copy its structure exactly.

## File Classification

### New source files

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/schema/review.ts` | schema (model) | transform/validate | `src/schema/config.ts` | exact (zod schema module) |
| `src/schema/response.ts` | schema (model) | transform/validate | `src/schema/config.ts` (discriminated union) | exact |
| `src/schema/evaluation.ts` | schema (model) | transform/validate | `src/schema/manifest.ts` | exact |
| `src/schema/decision-record.ts` | schema (model) | transform/validate | `src/schema/manifest.ts` | exact |
| `src/protocol/converge.ts` | service (control) | event-driven (bounded loop) | `src/protocol/engine.ts` (XState machine) | role-match |
| `src/protocol/instructions.ts` | utility | file-I/O (render + seed) | `src/workspace/scope.ts` (`scopedWorkdir`) | role-match |
| `src/protocol/decision-record.ts` | service (writer) | file-I/O / transform | `src/workspace/manifest.ts` + `src/workspace/artifacts.ts` | role-match |
| `src/templates/agent-instructions.md.tmpl` | config (template) | static asset | none (new artifact kind) — see No Analog Found | n/a |

### Modified source files

| Modified File | Role | Data Flow | What Changes | Analog for the change |
|---------------|------|-----------|--------------|-----------------------|
| `src/protocol/phases.ts` | config (descriptor) | transform | Add `prompt` + `validate` fields to `Phase`; flip integration to `participants:"integrator"` | `src/adapters/registry.ts` descriptor idiom (referenced in phases.ts header) |
| `src/protocol/engine.ts` | service (control) | event-driven | Real prompts via instruction files; validation gate; integrator branch; convergence sub-machine wiring | self (extend `runPhase`/`runPhaseGated`/`buildMachine`) |
| `src/protocol/gate.ts` | utility (gate) | transform | Implement `participants:"integrator"` branch in `expectedParticipantCount` (return 1) | self (gate.ts:53 documented stub) |
| `src/schema/manifest.ts` | schema (model) | transform | Add `evaluation`/`decision-record` artifact kinds; optional `escalated` status (O-2) | self (`droppedAgents` additive precedent, manifest.ts:43) |
| `src/workspace/scope.ts` | utility | file-I/O | Call `seedInstructions` alongside `input.md` copy in `scopedWorkdir` (scope.ts:47) | self |

### New / extended test files

| Test File | Targets | Analog | Match |
|-----------|---------|--------|-------|
| `test/review-schema.test.ts` | REVW-01 | `test/config.test.ts` | exact |
| `test/response-schema.test.ts` | REVW-02 | `test/config.test.ts` | exact |
| `test/validation-retry.test.ts` | D-38 | `test/retry.test.ts` | role-match |
| `test/converge.test.ts` | REVW-03 | `test/protocol-engine.test.ts` | role-match |
| `test/integration.test.ts` | REVW-04/05 | `test/protocol-gate.test.ts` | role-match |
| `test/decision-record.test.ts` | RCRD-01/RSLV-01 | `test/manifest.test.ts` | role-match |
| `test/instructions.test.ts` | D-37 + Pitfall 1 spike | `test/scope-independence.test.ts` | role-match |
| `test/protocol-run.e2e.test.ts` (extend) | full run | self | self |
| `test/protocol-gate.test.ts` (extend) | REVW-04 gate | self | self |
| `test/fixtures/fake-*.mjs` (extend) | structured `--emit` | `test/fixtures/fake-claude.mjs` | self |

## Pattern Assignments

### `src/schema/review.ts` (schema, REVW-01)

**Analog:** `src/schema/config.ts`

**Module shape to copy** — single `import { z } from "zod"`, named exported schema consts, `export type X = z.infer<typeof X>` per schema (config.ts lines 1, 40-67). Build small sub-schemas (`ReviewIssue`) then compose. RESEARCH Code Examples gives the exact target shape:

```typescript
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

**Cross-field invariants** → copy `.superRefine` pattern from config.ts lines 50-64 (duplicate-name check) if issue `n`s must be unique.

**Note (zod v4):** if any object needs nested defaults, use `.prefault({})` NOT `.default({})` — config.ts lines 40-48 documents exactly why (v4 `.default()` skips re-parse).

---

### `src/schema/response.ts` (schema, REVW-02)

**Analog:** `src/schema/config.ts` (the `discriminatedUnion` at lines 21-25 is the direct model)

**Discriminated-union pattern** (config.ts `discriminatedUnion("vendor", [...])`, lines 21-25) → discriminate on `verdict` so `reject-with-reason` structurally requires `reason`:

```typescript
import { z } from "zod";
const Verdict = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("accept"), issueRef: z.number().int().positive() }),
  z.object({ verdict: z.literal("reject-with-reason"), issueRef: z.number().int().positive(), reason: z.string().min(1) }),
  z.object({ verdict: z.literal("refine"), issueRef: z.number().int().positive(), refinement: z.string().min(1) }),
]);
export const ResponseFrontmatter = z.object({
  phase: z.literal("response"),
  author: z.string().min(1),
  reviewOf: z.string().min(1),
  responses: z.array(Verdict).min(1),
});
export type ResponseFrontmatter = z.infer<typeof ResponseFrontmatter>;
```

---

### `src/schema/evaluation.ts` (schema, REVW-03 convergence signal)

**Analog:** `src/schema/manifest.ts`

**Pattern:** object schema with explicit operational fields the convergence guard reads from disk (filesystem-as-truth, NOT model self-report — Pattern 5 / Anti-Pattern). Mirror manifest.ts's per-entry sub-schema style (manifest.ts lines 6-30). Required fields per A3: `round: z.number().int().positive()`, `proposedBase: z.string().min(1)`, `remainingDisagreements: z.array(...)`, citations. Agreement = all survivors share `proposedBase` AND `remainingDisagreements` empty/conceded.

---

### `src/schema/decision-record.ts` (schema, RCRD-01)

**Analog:** `src/schema/manifest.ts` (lines 6-54: nested entry schema + top-level container + `z.infer` exports)

**Pattern:** `resolvedDecisions[]` (contested-then-settled only, D-46), `openDecisions[]` (escalations, D-42), per-decision `lineage` (artifact refs, D-47), and a scalar `unanimousTally` for the non-contested count (D-46). Copy the optional/`.default([])` additive style from `droppedAgents` (manifest.ts line 45) so the record schema stays forward-compatible.

---

### `src/protocol/converge.ts` (service, REVW-03 — the product, D-40)

**Analog:** `src/protocol/engine.ts` (the `buildMachine` / `setup().createMachine` / `fromPromise` actor pattern, engine.ts lines 325-416)

**XState v5 machine construction to copy** (engine.ts lines 407-415):
```typescript
return setup({
  types: {} as { context: ProtocolContext; input: ProtocolInput },
  actors: { phaseActor, promoteActor },
}).createMachine({ id: "protocol", initial: PHASES[0].name, context: ({ input }) => (...), states });
```

**Bounded-loop with guarded transitions** — adapt the `onDone` guard-array pattern (engine.ts lines 354-371) into the round-loop sketch from RESEARCH Pattern 5:
```typescript
states: {
  round: {
    invoke: { src: "evaluationRound",   // reuse runPhase over surviving roster
      onDone: [
        { guard: "agreed",       target: "designate" },
        { guard: "capReached",   target: "escalate" },   // round === convergenceCap (D-41c)
        { guard: "unresolvable", target: "escalate" },    // explicit deadlock (D-41b)
        { target: "round", actions: "incrementRound" },   // else loop (D-43)
      ] } },
  designate: { /* base = proposedBase; integrator = base author (D-44) */ },
  escalate:  { /* push OPEN DECISION (D-42); pick fallback base per O-2(a) */ },
}
```

**Reuse, do not rebuild:** each round is a `runPhase` fan-out (engine.ts lines 60-193) over the surviving roster. Guards read the round's evaluation artifacts from disk via `readManifest` + the evaluation schema (A3). `convergenceCap` comes from config (default 10, D-41) — add it under `defaults` in config.ts mirroring `retries` (config.ts lines 44-47).

**Pitfall 3 (seq collision across rounds):** rounds repeat `kind:"evaluation"`. Disambiguate via kind/round (`evaluation-r2`) OR rely on `nextSeq` re-reading the manifest each round (layout.ts lines 74-85 — already monotonic over manifest + on-disk). Verify the round loop re-reads the manifest each iteration (it does, since `runPhase` reads at entry, engine.ts line 72).

---

### `src/protocol/instructions.ts` (utility, D-37)

**Analog:** `src/workspace/scope.ts` (`scopedWorkdir`, scope.ts lines 39-49 — seeds files into a per-agent dir)

**Seam to copy:** `scopedWorkdir` already does `ensureDir(dir)` + `copy(inputPath, join(dir, "input.md"))` (scope.ts lines 45-47). `seedInstructions` writes the rendered per-vendor file into the SAME dir, called right after the input copy:
```typescript
const VENDOR_FILE = { claude: "CLAUDE.md", codex: "AGENTS.md", gemini: "GEMINI.md" } as const;
export async function seedInstructions(workdir: string, vendor: keyof typeof VENDOR_FILE) {
  const template = await readFile("src/templates/agent-instructions.md.tmpl", "utf8");
  await writeFile(join(workdir, VENDOR_FILE[vendor]), template, "utf8");  // single source of truth
}
```

**Safety reuse:** route every path through `join(workdir, ...)` and reuse scope.ts's `assertSafeAgent` charset gate (scope.ts lines 11-19) for any agent-named path — do not re-implement containment.

**Pitfall 1 (HIGHEST RISK):** all three CLIs walk git-root→cwd discovering instruction files, so this repo's own root `CLAUDE.md` (GSD enforcement) would leak in. Instructions.ts must neutralize ancestor inheritance (out-of-repo cwd, vendor ignore-config/`--bare` flags per `CLAUDE.md` STACK table, or a stop-marker) — settle empirically in the Wave-0 `test/instructions.test.ts` spike BEFORE the live checkpoint.

---

### `src/protocol/decision-record.ts` (service, RCRD-01 / RSLV-01)

**Analog:** `src/workspace/manifest.ts` (terminal writer pattern) + `src/workspace/artifacts.ts` (frontmatter serialization)

**Terminal-write pattern** (manifest.ts `setStatus`, lines 119-135): assemble once at run end, write atomically temp-then-rename. Reuse the existing injection-safe `toFrontmatter`/`yamlScalar` serializer for WRITING (artifacts.ts lines 31-41) — Pattern 3 says keep the battle-tested serializer for writes, add gray-matter ONLY for reads/validation.

**Atomic write** (artifacts.ts `writeArtifact`, lines 60-102 — stage temp, then `rename`): the decision record is a single `decision-record.md` in `runs/<id>/`; follow the same temp-then-rename discipline (manifest.ts lines 88-95 is the minimal form).

**Source the contested items from the artifact trail** (D-46): response `reject-with-reason`/`refine` verdicts + convergence concessions + integrator `refine`/`reject` judgments. Read the manifest (`readManifest`, manifest.ts lines 79-82) to enumerate artifacts, then parse each with gray-matter (Pattern 3) + the relevant zod schema.

---

### `src/protocol/phases.ts` (modified — descriptor extension, Pattern 1)

**Analog:** self + `src/adapters/registry.ts` idiom (cited in phases.ts header lines 2-3)

**Extend the `Phase` interface** (phases.ts lines 12-17) with two typed-data fields, keeping the `as const` frozen-table idiom:
```typescript
export interface Phase {
  readonly name: "draft" | "review" | "response" | "evaluation" | "integration" | "validation";
  readonly kind: string;
  readonly scoped: boolean;
  readonly participants: "all" | "integrator";   // flip integration → "integrator" (REVW-04)
  readonly prompt: (ctx: PhasePromptCtx) => string;        // thin, per D-37
  readonly validate?: (frontmatter: unknown) => ValidationResult;  // zod gate (REVW-01/02)
}
```
The engine reads these instead of the hardcoded placeholder at engine.ts line 110. Keep prompts THIN (Anti-Pattern: no format-stuffing — the contract lives in the instruction file).

---

### `src/protocol/engine.ts` (modified — prompts, validation gate, integrator branch)

**Analog:** self

**Replace placeholder prompt** at engine.ts line 110 (`phase: ${phase.name}\ninput: ${inputPath}`) with `phase.prompt(ctx)` (thin, references the seeded instruction file).

**Validation-with-one-retry gate (D-38)** — wrap the turn result AFTER `withRetry` (engine.ts lines 119-142), NOT inside it (Pitfall 5: transport-retry and validation-retry are distinct). Pattern 2 structure:
```typescript
let turn = await invoke(prompt);
let parsed = validate(turn);                 // gray-matter parse → zod safeParse
if (parsed.ok) return { ...turn, ok: true };
turn = await invoke(`${prompt}\n\n## Validation errors to fix\n${parsed.errors}`);  // ONE retry
parsed = validate(turn);
return parsed.ok ? { ...turn, ok: true } : { ...turn, ok: false, error: "validation-failed" };
```
A second failure becomes a failed turn → the existing `applySkipFailed` path (engine.ts lines 241-269) drops it. Never auto-normalize.

**Integrator-only fan-out:** for `participants:"integrator"`, fan out over ONLY the integrator, not the whole roster (engine.ts line 105 `roster.map`). Pairs with the gate change below (Pitfall 4).

**Manifest concurrency (Pitfall 2):** any new fan-out (convergence rounds) MUST keep writing ARTIFACT files concurrently but call `addArtifact` SEQUENTIALLY after the settle — exactly as engine.ts lines 164-191 already does. Do not regress.

---

### `src/protocol/gate.ts` (modified — integrator branch, Pitfall 4)

**Analog:** self (the documented stub at gate.ts lines 53-57)

Implement the `participants:"integrator"` branch in `expectedParticipantCount`:
```typescript
export function expectedParticipantCount(phase: Phase, roster: AgentEntry[]): number {
  if (phase.participants === "all") return roster.length;
  if (phase.participants === "integrator") return 1;   // exactly one writer (REVW-04)
  return roster.length;
}
```
`requiredArtifactsExist` (gate.ts lines 22-25) is unchanged — it already judges the exact written-path list.

---

## Shared Patterns

### Frontmatter validation (read-side) — gray-matter + zod
**Source:** new dependency `gray-matter@^4` (checkpoint-gated) + `src/schema/*` safeParse style
**Apply to:** every structured phase (review, response, evaluation, integration) and the decision-record reader
```typescript
import matter from "gray-matter";
const { data, content } = matter(fs.readFileSync(artifactPath, "utf8"));
const result = ReviewFrontmatter.safeParse(data);   // typed errors feed the D-38 retry
```
**Rule (Pattern 3):** gray-matter READS only; the existing `toFrontmatter`/`yamlScalar` (artifacts.ts lines 31-41) still WRITES. js-yaml safe-load is gray-matter's default — confirm no unsafe schema is passed (Security V1).

### Error/validation formatting — zod issues to actionable lines
**Source:** `src/config.ts` `formatIssues` (config.ts lines 39-46)
**Apply to:** the D-38 retry prompt (`parsed.errors`) and any schema-load error
```typescript
err.issues.map((i) => `  ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`).join("\n")
```

### Atomic temp-then-rename writes
**Source:** `src/workspace/artifacts.ts` `writeArtifact` (lines 60-102); `src/workspace/manifest.ts` `writeManifestAtomic` (lines 88-95)
**Apply to:** decision-record writer and any new artifact write — stage `.tmp-${pid}`, then `rename`. Never write a live file in place.

### Deterministic artifact naming + monotonic seq
**Source:** `src/workspace/layout.ts` `artifactName`/`nextSeq` (lines 31-33, 74-85)
**Apply to:** evaluation rounds, integration, decision record. `nextSeq` over manifest + on-disk names guarantees no overwrite across convergence rounds (Pitfall 3).

### Config defaults (zod prefault)
**Source:** `src/schema/config.ts` `defaults` block (lines 40-48)
**Apply to:** the new `convergenceCap` (default 10, D-41) — add under `defaults` using the same `.prefault({})` discipline so the nested default fires.

### Progress lines
**Source:** `src/protocol/engine.ts` `process.stdout.write` per-phase/per-agent lines (engine.ts lines 88, 147, 159, 261)
**Apply to:** per-round convergence progress (Claude's discretion — keep consistent with the `▶ phase ... — fanning out N agent(s)` / `  agent ✓/✗` format).

### Test structure — schema and engine
**Source:** `test/config.test.ts` (schema parse/reject cases), `test/protocol-engine.test.ts` / `test/protocol-gate.test.ts` (engine/gate units), `test/protocol-run.e2e.test.ts` (hermetic full run via fake-CLI fixtures)
**Apply to:** all Wave-0 test files. The e2e harness (protocol-run.e2e.test.ts lines 44-89) seeds a 2-vendor `mar.config.json` with `bin: node <fake-*.mjs>`, runs `mar run`, asserts manifest status + per-phase artifact counts — extend it for the decision record (success criterion #1). D-49: all 3-agent dynamics prove on fixtures, zero credits.

### Fixture extension — structured `--emit`
**Source:** `test/fixtures/fake-claude.mjs` `--emit <kind>` mode (lines 28-32, 60-74) + `MAR_PLANTED_MODE` env-activated filesystem-aware body (lines 24, 55-59, via `planted-shared.mjs`)
**Apply to:** extend each fake-CLI to emit VALID structured review/response/evaluation/integration frontmatter so a hermetic run yields schema-passing artifacts (and a variant that emits malformed frontmatter to exercise the D-38 retry).

## No Analog Found

| File | Role | Data Flow | Reason | Planner guidance |
|------|------|-----------|--------|------------------|
| `src/templates/agent-instructions.md.tmpl` | template/config | static asset | No template/asset file exists in the repo yet (first `.tmpl`) | Author from D-36/D-37 format contract + `docs-case-study.md` behavioral spec. Single source of truth rendered identically to all three vendor files (D-37). Store under `src/templates/`; render via `instructions.ts` `readFile`. |

Everything else maps to a concrete in-repo analog. The convergence loop (`converge.ts`) reuses the
`engine.ts` XState idiom but its agreement-detection mechanics are Claude's discretion (D-40, A3,
O-2/O-3) — RESEARCH Pattern 5 is the design spec; there is no prior loop to copy mechanics from.

## Metadata

**Analog search scope:** `src/` (all 23 TS modules), `test/` (28 files), `src/templates/` (absent)
**Files scanned (read in full):** `src/schema/config.ts`, `src/schema/manifest.ts`, `src/protocol/{phases,gate,engine}.ts`, `src/workspace/{scope,artifacts,layout,manifest}.ts`, `src/config.ts`, `test/protocol-run.e2e.test.ts`, `test/fixtures/fake-claude.mjs`
**Pattern extraction date:** 2026-06-05
**Key risk flagged for planner:** Pitfall 1 (instruction-file ancestor inheritance) — load-bearing for REVW-01, must be settled in a Wave-0 spike before the live 3-vendor checkpoint.
