---
phase: 02-adapter-layer-roster-pre-flight
plan: 01
subsystem: adapter-layer
tags: [adapters, codex, gemini, registry, orch-03, tdd]
requires:
  - "src/adapters/adapter.ts (AgentAdapter/TurnRequest — unchanged Phase-1 contract)"
  - "src/schema/turn.ts (TurnResult — unchanged normalization target)"
  - "src/adapters/claude.ts (reference adapter skeleton + splitBin)"
provides:
  - "makeCodexAdapter(bin?, model?) — codex exec --json NDJSON terminal-event adapter"
  - "makeGeminiAdapter(bin?, model?) — gemini stdout-or-stderr JSON adapter (fixture-built, D-32)"
  - "makeAdapter(vendor, bin?, model?) — vendor->adapter registry (the ORCH-03 seam)"
  - "FACTORIES map {claude,codex,gemini} — adding a vendor is one entry"
  - "src/adapters/common.ts — shared splitBin/safeJsonParse/redactArgv/PROMPT_PLACEHOLDER"
  - "CodexEvent + GeminiJson zod schemas (passthrough, drift-safe)"
affects:
  - "src/adapters/claude.ts (refactored to import shared helpers; +--model flag)"
  - "Plan 03 (roster supplies entry.model), Plan 05 (CLI threads makeAdapter(vendor,bin,model))"
tech-stack:
  added: []
  patterns:
    - "NDJSON terminal-event parse (codex): ok = exit0 && turn.completed && !turn.failed"
    - "stdout-OR-stderr JSON parse (gemini): error JSON routes to stderr on auth-failure (Pitfall 3)"
    - "per-vendor model flag via factory-closure model? param (codex/gemini -m, claude --model)"
    - "vendor->factory map keyed on literal; keyof typeof rejects invalid vendor at type boundary"
key-files:
  created:
    - src/adapters/common.ts
    - src/adapters/codex.ts
    - src/adapters/gemini.ts
    - src/adapters/registry.ts
    - test/fixtures/fake-codex.mjs
    - test/fixtures/fake-gemini.mjs
    - test/codex-adapter.test.ts
    - test/gemini-adapter.test.ts
    - test/registry.test.ts
  modified:
    - src/adapters/claude.ts
    - src/schema/turn.ts
decisions:
  - "Extracted vendor-agnostic helpers to common.ts; claude.ts re-exports splitBin for back-compat (existing import path unchanged)"
  - "Gemini built/tested ENTIRELY against fake-gemini.mjs (D-32 — real headless auth broken); CI does not gate on a live gemini success"
  - "No exit-code allowlist for gemini (undocumented 41/55); ok keyed off error/response/exit-0"
  - "claude buildArgv also gained --model <model> to honor the PINNED model-param contract uniformly across all three vendors"
metrics:
  duration: "~5 min"
  completed: "2026-06-04"
  tasks: 3
  files: 11
---

# Phase 2 Plan 01: Adapter Layer (codex + gemini + registry) Summary

The codex and gemini vendor adapters plus the `makeAdapter(vendor, bin?, model?)` registry make ORCH-03 true: all three vendors invoke through the same unchanged `AgentAdapter` contract with zero protocol-layer branching, and adding a vendor is one `FACTORIES` map entry.

## What Was Built

- **`src/adapters/common.ts`** — `splitBin`, `safeJsonParse`, `redactArgv`, `PROMPT_PLACEHOLDER` extracted verbatim from claude.ts so codex/gemini import rather than copy-paste. `claude.ts` now imports these and re-exports `splitBin` for back-compat (existing `../adapters/claude.js` import path and `claude-adapter.test.ts` unchanged).
- **`src/schema/turn.ts`** — added `CodexEvent` and `GeminiJson` zod schemas (`.passthrough()`, drift-safe, consumed-fields-only) alongside the unchanged `ClaudeJson`/`TurnResult`.
- **`src/adapters/codex.ts`** — `makeCodexAdapter(bin = "codex", model?)`. Pinned argv `exec --json --skip-git-repo-check --ephemeral -s read-only [-m model] <prompt>`. Parses stdout NDJSON line-by-line with `CodexEvent.safeParse`; ok-rule = `exit0 && turn.completed && !turn.failed`; text from the last `agent_message` `item.completed`; no terminal event → graceful `unparseable output`.
- **`src/adapters/gemini.ts`** — `makeGeminiAdapter(bin = "gemini", model?)`. Pinned argv `-p <prompt> --output-format json --skip-trust [-m model]`; never `--yolo`. Parses `safeJsonParse(stdout) ?? safeJsonParse(stderr)` (the JSON-on-stderr gotcha, D-32/Pitfall 3); ok-rule = `exit0 && !error && typeof response === "string"`; no exit-code allowlist.
- **`src/adapters/registry.ts`** — `FACTORIES = {claude, codex, gemini}` and `makeAdapter(vendor, bin?, model?)` threading bin+model into each factory closure. The ORCH-03 seam.
- **Fixtures** — `fake-codex.mjs` (NDJSON happy/--fail-auth/--rate-limit/--bad-json/--hang) and `fake-gemini.mjs` (JSON happy/--fail-auth on stderr exit41/--untrusted exit55/--rate-limit/--bad-json/--hang), both chmod +x.
- **Tests** — `codex-adapter.test.ts`, `gemini-adapter.test.ts`, `registry.test.ts`: happy + every failure mode + flag-pinning (exact argv incl. the model flag) + schema acceptance.

## Verification Results

- `npx vitest run` — full suite **73 passed (11 files)**; Phase-1 claude tests still green (claude refactor behavior-preserving).
- `npx tsc --noEmit` — clean.
- `npx biome check src/adapters src/schema test/{codex,gemini}-adapter.test.ts test/registry.test.ts` — clean.
- `grep -REn 'turn\.completed|item\.completed|is_error|"response"' src/adapters/registry.ts` — empty (no vendor field names leak past the adapter tier, D-12).
- Both fixtures executable; gemini fixture writes failure JSON to stderr.
- `grep -c passthrough src/schema/turn.ts` = 6 (ClaudeJson + CodexEvent + GeminiJson).

## TDD Gate Compliance

RED → GREEN → REFACTOR/style cycle honored with distinct commits:
1. `test(02-01)` 3a33ad6 — schemas + fixtures + RED adapter/registry tests (modules absent → vitest non-zero).
2. `feat(02-01)` c6aaaa0 — codex + gemini adapters (GREEN, 19 adapter tests pass).
3. `feat(02-01)` 24faef9 — registry seam (GREEN, full 32 adapter+registry tests pass).
4. `style(02-01)` 2cc78eb — biome line-wrapping format on Task-1/2 files.

No RED test passed unexpectedly before its implementation existed.

## Deviations from Plan

### Auto-fixed / additions

**1. [Rule 2 — Missing critical functionality] claude.ts `--model` flag**
- **Found during:** Task 3 (registry wiring).
- **Issue:** The registry calls `FACTORIES.claude(bin, model)`, and the plan's `must_haves.truths` requires each factory to append the vendor model flag (claude `--model <model>`). claude's `buildArgv`/factory accepted only `bin`, so a model passed via the registry would have been silently dropped.
- **Fix:** `makeClaudeAdapter(bin = "claude", model?)` and `buildArgv(promptText, model?)` now append `--model <model>` when set — matching the PINNED model-param contract uniformly across all three vendors.
- **Files modified:** `src/adapters/claude.ts`. **Commit:** 24faef9.
- The existing claude flag-pinning test (no-model path) still asserts the exact 4-element argv and passes unchanged — behavior is additive only.

## Known Stubs

None. Gemini is intentionally fixture-built (D-32, documented above and in PLAN/RESEARCH); the adapter is fully wired against `fake-gemini.mjs`. Real-gemini liveness is a preflight concern for a later plan, not a stub in this one.

## Threat Flags

None. All threat-model dispositions for this plan were implemented: execa array args / no shell (T-02-01), zod `.safeParse` with graceful `ok:false` on unparseable output (T-02-02), `redactArgv` placeholder swap (T-02-03), codex `-s read-only` pinned (T-02-04), gemini `--skip-trust` pinned with exit-55 surfaced as a distinct error (T-02-05). No new packages added (T-02-SC; D-35).

## Self-Check: PASSED

Created files verified present on disk:
- src/adapters/common.ts, codex.ts, gemini.ts, registry.ts — FOUND
- test/fixtures/fake-codex.mjs, fake-gemini.mjs — FOUND (executable)
- test/codex-adapter.test.ts, gemini-adapter.test.ts, registry.test.ts — FOUND

Commits verified in git log:
- 3a33ad6, c6aaaa0, 24faef9, 2cc78eb — FOUND
