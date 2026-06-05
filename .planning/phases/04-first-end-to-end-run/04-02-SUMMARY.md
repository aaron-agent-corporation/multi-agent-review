---
phase: 04-first-end-to-end-run
plan: 02
subsystem: protocol / format-contract delivery
tags: [instructions, format-contract, scope, pitfall-1, D-36, D-37, REVW-01, REVW-02]
requires:
  - "src/workspace/scope.ts scopedWorkdir seam (Phase 3 / 03-01)"
  - "src/protocol/engine.ts draft-phase cwd call site (Phase 3 / 03-02)"
provides:
  - "src/templates/agent-instructions.md.tmpl — single source-of-truth format contract"
  - "src/protocol/instructions.ts — seedInstructions + VENDOR_FILE map"
  - "scopedWorkdir now seeds each agent's vendor-native instruction file into its scoped cwd"
  - "Pitfall 1 (ancestor instruction-file inheritance) neutralized + proven by a hermetic spike"
affects:
  - "src/workspace/scope.ts (signature: vendor param added)"
  - "src/protocol/engine.ts (threads entry.vendor)"
tech-stack:
  added: []
  patterns:
    - "import.meta.url module-relative resource resolution (cwd-independent template load)"
    - "identity render (verbatim template → vendor-native filename, no per-vendor divergence)"
    - "hermetic filesystem spike with explicit falsifiability test"
key-files:
  created:
    - src/templates/agent-instructions.md.tmpl
    - src/protocol/instructions.ts
    - test/instructions.test.ts
  modified:
    - src/workspace/scope.ts
    - src/protocol/engine.ts
    - test/scope-independence.test.ts
decisions:
  - "Neutralization mechanism = RESEARCH option 3: seeded file is the NEAREST instruction file (no ancestor AGENTS.md/GEMINI.md exists at repo root), plus claude --bare on the live path. Documented in code; proven by spike."
metrics:
  duration_min: 10
  completed: "2026-06-05"
  tasks: 2
  files: 6
---

# Phase 4 Plan 02: Format-Contract Delivery + Pitfall-1 Neutralization Summary

One source-of-truth instruction template rendered byte-identically into each vendor's native
instruction file (CLAUDE.md/AGENTS.md/GEMINI.md), seeded into every agent's scoped cwd by
`scopedWorkdir`, with the ancestor instruction-file inheritance risk (Pitfall 1) settled
empirically by a hermetic spike test before the live 3-vendor checkpoint.

## What Was Built

### Task 1 — Format-contract template + per-vendor renderer (D-36/D-37) — commit d060e62
- `src/templates/agent-instructions.md.tmpl` (118 lines): the SINGLE source of truth for the
  format contract. Specifies all four artifact shapes as markdown + YAML frontmatter (D-36):
  - REVIEW — `phase: review`, `author`, single-valued `targets`, numbered `issues` each with
    `n`, `severity` ∈ {P1, P2, P3}, and exactly one concrete `question`.
  - RESPONSE — `phase: response`, `author`, `reviewOf`, `responses` keyed by `issueRef` with
    `verdict` ∈ {`accept`, `reject-with-reason` (+`reason`), `refine` (+`refinement`)}.
  - EVALUATION — `round`, `proposedBase`, `remainingDisagreements`, `citations` to peer artifacts.
  - INTEGRATION — per-addition verdict + the merged document body.
  Prose body is human-readable; machine data lives in frontmatter. Wording/severity conventions
  sourced from `docs-case-study.md`.
- `src/protocol/instructions.ts`: `VENDOR_FILE` map (claude→CLAUDE.md, codex→AGENTS.md,
  gemini→GEMINI.md) and async `seedInstructions(workdir, vendor)`. The template path resolves
  via `new URL("../templates/...", import.meta.url)` (cwd-independent — runs execute from
  `runs/<id>/work/<agent>/`), and is written verbatim (identity render, D-37: no divergence).

### Task 2 — Wire seeding into scopedWorkdir + Pitfall-1 spike — commit 48fe68e
- `src/workspace/scope.ts`: `scopedWorkdir` gains a `vendor` parameter and calls
  `seedInstructions(dir, vendor)` immediately after the `input.md` copy. Reuses the existing
  `assertSafeAgent` charset gate (no re-implemented containment). A doc comment names the
  live-adapter suppression flags the downstream path must pass: claude `--bare`,
  codex `--ignore-user-config`, gemini config-trust scoping.
- `src/protocol/engine.ts`: threads `entry.vendor` into the `scopedWorkdir` draft-phase call.
- `test/instructions.test.ts`: (1) per-vendor seeding asserted by reading the seeded file back
  and matching the template byte-for-byte; (2) the SPIKE — plants a conflicting ancestor
  instruction file and asserts the seeded file is the effective NEAREST contract; (3) a
  falsifiability test showing an unseeded cwd would instead discover the planted ancestor poison
  (this is what makes the spike fail if neutralization is removed).

## Neutralization Decision (Pitfall 1 / T-04-03)

Settled empirically via RESEARCH option 3. Confirmed at the repo root: only `CLAUDE.md` exists
(no `AGENTS.md`/`GEMINI.md`). Therefore:
- For **codex/gemini**, the seeded file is the sole/nearest instruction file on the root→cwd
  walk — nothing ancestral to merge.
- For **claude**, the live adapter path must pass `--bare` to suppress root `CLAUDE.md`
  auto-discovery (already the recommended orchestrator flag in CLAUDE.md).
The hermetic spike proves the seeded contract is the effective nearest file despite a planted
ancestor, and is falsifiable (the unseeded-cwd test documents the real risk).

> Note on the plan's `autonomous: false`: the only "checkpoint" risk was this Wave-0 spike. The
> spike confirmed the preferred mechanism works, so no human decision was required and no
> `checkpoint:*` task exists in the plan. Execution proceeded to completion.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run test/instructions.test.ts` — 7/7 passed.
- `npx vitest run test/scope-independence.test.ts` — 8/8 passed (no PROT-04 regression).
- `npx vitest run` (full suite) — 25 files / 220 tests passed.

## Acceptance Criteria

- [x] Template contains literal tokens P1, P2, P3, accept, reject-with-reason, refine, proposedBase.
- [x] instructions.ts exports `seedInstructions` and maps claude→CLAUDE.md / codex→AGENTS.md / gemini→GEMINI.md.
- [x] instructions.ts resolves the template via `import.meta.url` (not cwd-relative).
- [x] scopedWorkdir seeds work/<agent>/<vendor-file> with template content (asserted by read-back).
- [x] Neutralization spike asserts the seeded contract is effective despite a planted ancestor and is falsifiable.
- [x] scope.ts reuses `assertSafeAgent`.
- [x] tsc clean; instructions + scope-independence + full suite green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated existing scopedWorkdir callers for the new signature**
- **Found during:** Task 2
- **Issue:** Adding the required `vendor` parameter to `scopedWorkdir` broke its existing callers
  (engine.ts and the four calls in test/scope-independence.test.ts), and the seeded file changed
  the scoped-dir listing from `["input.md"]` to include the vendor file.
- **Fix:** Threaded `entry.vendor` at the engine call site; updated the four test callers to pass
  a vendor; updated the "lists ONLY input.md" assertion to expect the seeded contract alongside
  input.md (PROT-04 cross-agent exclusion is unchanged — a peer's draft still never appears).
- **Files modified:** src/protocol/engine.ts, test/scope-independence.test.ts
- **Commit:** 48fe68e

**2. [Rule 1 - Bug] Spike assertion over-matched the template's own text**
- **Found during:** Task 2 verification
- **Issue:** The first spike used the literal "GSD" as the ancestor-poison marker, but the
  template legitimately mentions "GSD" (as an example of ancestor directives to ignore), so
  `not.toContain("GSD")` failed.
- **Fix:** Replaced the poison marker with a unique sentinel string so the assertion distinguishes
  the planted ancestor content from the legitimate template body.
- **Files modified:** test/instructions.test.ts (pre-commit fix; folded into commit 48fe68e)

## Known Stubs

None. The format contract is fully specified; the seeder is wired into the live draft-phase path.

## Self-Check: PASSED

- FOUND: src/templates/agent-instructions.md.tmpl
- FOUND: src/protocol/instructions.ts
- FOUND: test/instructions.test.ts
- FOUND commit d060e62 (Task 1)
- FOUND commit 48fe68e (Task 2)
