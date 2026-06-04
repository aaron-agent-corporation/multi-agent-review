---
phase: 01-workspace-first-adapter
plan: 03
subsystem: cli
tags: [cli, commander, invoke, walking-skeleton, orch-01, orch-06, prot-02, prot-07]
requires:
  - phase: 01-01
    provides: "workspace layout/manifest/artifacts (newRunId, runDir, createRun, readManifest, addArtifact, setStatus, writeArtifact) + RED e2e anchor"
  - phase: 01-02
    provides: "makeClaudeAdapter(bin).invoke + logInvocation NDJSON appender"
provides:
  - "cli/invoke: `mar invoke --agent claude --prompt <file|string> [--run <id>] [--timeout <ms>]` — the complete walking-skeleton slice wiring adapter → workspace → log → console"
  - "create-or-append run UX (no --run creates; --run appends next seq) (D-07)"
  - "human-readable single-line console progress; structured detail to manifest + log only (D-08)"
affects:
  - "Phase 2 (multi-vendor): the `--agent` switch + run lifecycle is the seam codex/gemini adapters plug into behind the same AgentAdapter interface"
  - "Phase 3 (protocol/runner): consumes `mar invoke` as the per-turn primitive"
tech-stack:
  added:
    - "commander 12.x (mar entry + invoke subcommand, required/optional flags)"
  patterns:
    - "branch ONLY on turn.ok — CLI never re-derives success from exit code or subtype (T-01-13)"
    - "--run id charset-validated against newRunId alphabet before any fs touch — no path escape (T-01-10)"
    - "prompt resolved file-or-string; loggable promptRef (path or inline:<label>), never the body (D-15 / T-01-11)"
    - "manifest stores artifact path RELATIVE to run dir; full run state re-derivable from disk (PROT-07)"
    - "injectable bin via MAR_CLAUDE_BIN so the e2e test hits the fixture, real claude otherwise"
    - "bin-entry guard (import.meta.url vs realpath argv[1]) so importing cli.ts in tests does not auto-run"
key-files:
  created:
    - src/cli.ts
  modified:
    - src/adapters/claude.ts
    - test/e2e-invoke.test.ts
key-decisions:
  - "Console success line: `claude ✓  <s>s  exit 0  → <runDir>/<artifact>`; failure line carries reason (timeout/error) — never raw JSON (D-08)."
  - "On timeout: status `timeout`, no normalized artifact written; on other failure: status `failed`; invocation logged in all cases (ORCH-06)."
  - "claude version detected best-effort via `claude --version` at run-create time; `unknown` if absent — recorded in manifest cliVersions."
patterns-established:
  - "Walking-skeleton CLI: one command threads the whole bottom-up spine (workspace + adapter + log) into a user-observable capability."
  - "Success authority lives in the adapter (turn.ok); the CLI is a pure persistence/printing layer over it."
requirements-completed: [ORCH-01, ORCH-06, PROT-02, PROT-07]

duration: 6min
completed: 2026-06-04
---

# Phase 1 Plan 03: `mar invoke` End-to-End Slice Summary

**`mar invoke --agent claude --prompt <file|string> [--run <id>]` — a single commander CLI that drives the real claude CLI headlessly, writes a deterministically-named normalized artifact + raw sibling into a manifest-indexed run workspace, appends an NDJSON invocation record, and prints one human-readable progress line; the previously-RED e2e anchor is now GREEN and a live real-claude smoke was human-verified.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-04T16:14:33Z
- **Completed:** 2026-06-04
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- `src/cli.ts`: `mar` program + `invoke` subcommand wiring the full Phase-1 data flow — validate `--agent` (claude only; codex/gemini rejected, exit 2), resolve prompt (file-or-string with a loggable `promptRef`), create-or-append the run, drive `makeClaudeAdapter(MAR_CLAUDE_BIN ?? "claude")` with a wall-clock timeout, persist artifact/manifest/log, print one progress line.
- Turned the intentional RED MVP anchor `test/e2e-invoke.test.ts` GREEN (full suite green).
- All four phase requirements satisfied end-to-end: ORCH-01 (headless adapter invocation), ORCH-06 (every invocation logged), PROT-02 (deterministic normalized artifact + raw sibling), PROT-07 (manifest-indexed, disk-re-derivable run state).
- Live real-claude smoke human-verified (checkpoint approved).

## Task Commits

1. **Task 1: Wire `mar invoke` end-to-end and turn the e2e test green** — `25f7d10` (feat)
2. **Task 2: Live real-claude smoke (checkpoint:human-verify)** — no commit; verification gate (see below)

**Plan metadata:** committed separately with this SUMMARY + STATE/ROADMAP updates.

## Files Created/Modified

- `src/cli.ts` (created) — commander `mar invoke` entry: agent validation, prompt resolution, run create/append, adapter invocation, artifact/manifest/log persistence, console progress, bin-entry guard.
- `src/adapters/claude.ts` (modified) — injectable-bin split so `MAR_CLAUDE_BIN` can point at `test/fixtures/fake-claude.mjs` (fixture) while defaulting to real `claude`.
- `test/e2e-invoke.test.ts` (modified) — flipped from RED skeleton anchor to GREEN: spawns `mar invoke` against the fake fixture and asserts run dir, `001-claude-output.md` (non-empty) + `.raw.json` sibling, `manifest.json` (status `completed`, 1 artifact), and `invocations.ndjson` (1 record).

## Checkpoint Resolution (Task 2 — human-verify)

**Status:** APPROVED ("approved"). Live smoke run by the orchestrator on the user's machine against the REAL claude CLI (CI cannot do this — it burns subscription credits and needs interactive auth).

**Evidence captured:**

- `claude --version` → 2.1.162
- `npx tsx src/cli.ts invoke --agent claude --prompt "Reply with exactly the word: pong"` (no `MAR_CLAUDE_BIN`, so it hit real claude) →
  console: `claude ✓  3.0s  exit 0  → runs/20260604-S1Q-4G/001-claude-output.md` (single human-readable progress line, no raw JSON — D-08 confirmed).
- `runs/20260604-S1Q-4G/` contained the expected four files:
  - `001-claude-output.md` — YAML frontmatter (agent/seq/kind/timestamp/runId/sessionId) + body `pong`.
  - `001-claude-output.raw.json` — raw sibling.
  - `manifest.json` — status `completed`, `cliVersions.claude` `2.1.162`, 1 artifact entry (PROT-07).
  - `invocations.ndjson` — one record: argv, `promptRef` `inline:Reply with exactly the word: ...` (reference, not body — D-15 confirmed), `exitCode 0`, `durationMs 3045`, `timedOut false`, artifact path (ORCH-06).
- **Append check:** re-run with `--run 20260604-S1Q-4G` → `002-claude-output.md` created, manifest `artifacts: 2`, status `completed` (D-07 create-or-append confirmed).

Run state was fully re-derivable from `runs/<id>/` on disk in every case (no in-memory-only state).

## Decisions Made

None beyond the plan — the console format, timeout/failure status mapping, and best-effort version detection were all specified in PLAN/CONTEXT (D-06/D-07/D-08/D-17) and implemented as written.

## Deviations from Plan

None — plan executed exactly as written. (The injectable-bin split in `src/adapters/claude.ts` was the planned mechanism for the e2e test to target the fixture, not an unplanned deviation.)

## Threat Surface Notes

No new surface beyond the plan's threat model. Mitigations applied as planned:
- T-01-10 (tampering via `--run`): `RUN_ID_RE = /^[A-Za-z0-9_-]+$/` validated before any fs touch; `--run` requires an existing manifest. No `..`/`/`.
- T-01-11 (console + log disclosure): one progress line only; `promptRef` is a reference (`inline:<label>` or file path), never the prompt body.
- T-01-12 (hung real claude): `timeoutMs` default 600000 passed to the adapter; adapter kills + reports `timedOut`.
- T-01-13 (spoofed success): CLI branches solely on `turn.ok`; exit code / subtype never re-derived at the CLI layer.

## Known Stubs

None. The repo's previously-failing test (the RED e2e anchor) is now green; no stubs introduced.

## Issues Encountered

None.

## User Setup Required

None for the automated suite. The optional live smoke requires `claude` 2.1.x installed and logged in (subscription/OAuth; no `ANTHROPIC_API_KEY` since `--bare` is not used) — satisfied and verified during the checkpoint.

## Next Phase Readiness

- Phase 1 (Workspace + First Adapter) is **complete**: the walking skeleton runs end-to-end with one real installed CLI.
- The `--agent` switch + run lifecycle is the clean seam for Phase 2's codex/gemini adapters behind the same `AgentAdapter` interface.
- Carry-forward concerns (unchanged): Phase 2 cross-vendor JSON-Schema parity spike; Gemini→Antigravity CLI cutoff (2026-06-18); claude `-p` billing change.

## Commits

- 25f7d10 feat(01-03): wire mar invoke end-to-end; e2e anchor green

## Self-Check: PASSED

`src/cli.ts` verified on disk; task commit `25f7d10` verified in git log.

---
*Phase: 01-workspace-first-adapter*
*Completed: 2026-06-04*
