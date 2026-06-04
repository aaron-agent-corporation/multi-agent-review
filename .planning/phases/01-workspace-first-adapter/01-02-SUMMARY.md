---
phase: 01-workspace-first-adapter
plan: 02
subsystem: adapter
tags: [adapter, execa, claude, normalization, pino, ndjson, logging, orch-01, orch-06]
requires:
  - "TurnResult zod schema (from Plan 01-01, src/schema/turn.ts)"
  - "ClaudeJson zod schema with .passthrough() (from Plan 01-01)"
  - "test/fixtures/fake-claude.mjs (from Plan 01-01)"
provides:
  - "adapters/adapter: vendor-agnostic AgentAdapter interface + TurnRequest type (D-12)"
  - "adapters/claude: makeClaudeAdapter(bin) — execa invocation + ClaudeJson->TurnResult normalization (ORCH-01)"
  - "log/invocation: logInvocation(runDir, record) pino NDJSON appender to invocations.ndjson (ORCH-06)"
affects:
  - "Plan 03 (CLI wiring) consumes makeClaudeAdapter + logInvocation to turn test/e2e-invoke.test.ts green"
  - "Phase 2 adds codex/gemini adapters behind the same AgentAdapter interface"
tech-stack:
  added:
    - "execa 9.6.1 (subprocess: timeout, forceKillAfterDelay, reject:false, no shell)"
    - "pino 10.3.1 (NDJSON invocation log, sync destination append)"
  patterns:
    - "injectable bin: makeClaudeAdapter(bin='claude') so tests spawn the fixture, not real claude"
    - "verified ok-rule: success = exitCode===0 AND is_error===false (BOTH); result.type/subtype never read"
    - "graceful failure: unparseable stdout -> ok:false TurnResult, never a crash (T-01-06)"
    - "wall-clock timeout kills hung invocation -> timedOut:true (D-17 / T-01-07)"
    - "flag-pinning test (execa mock) guards argv against drift and the forbidden config-isolation flag"
    - "log prompt *reference* not body; never log API key (D-15 / V7 / T-01-08)"
key-files:
  created:
    - src/adapters/adapter.ts
    - src/adapters/claude.ts
    - src/log/invocation.ts
    - test/claude-adapter.test.ts
    - test/invocation.test.ts
  modified: []
decisions:
  - "Spawn the executable fixture directly as `bin` in fixture tests; mode flags ride in promptText (the fixture matches argv via args.includes), so the real argv shape is exercised end-to-end."
  - "Use default `import pino from 'pino'` (not named) — pino 10 attaches `destination` to the default export type; the named import typechecks as missing the static (Pitfall 4 drift)."
  - "Sync pino destination + flushSync per call: append-only audit trail, throughput irrelevant, line guaranteed flushed before return."
  - "duration_ms preferred from claude JSON when present, else execa result.durationMs."
metrics:
  duration_minutes: 8
  tasks_completed: 2
  files_created: 5
  completed_date: 2026-06-04
---

# Phase 1 Plan 02: Claude Adapter + Invocation Logger Summary

The subprocess slice of the walking skeleton (ORCH-01, ORCH-06): a vendor-agnostic `AgentAdapter` interface, a `makeClaudeAdapter(bin)` that drives `claude -p --output-format json` (without the config-isolation flag) through execa with a wall-clock timeout and graceful kill, normalizes the verified claude JSON through the zod `TurnResult` using the exitCode-AND-is_error ok-rule, and a pino NDJSON invocation logger that appends one audit record per invocation. All green against the fake fixture — zero real claude credits spent.

## What Was Built

- **Task 1 (adapter + claude):** `src/adapters/adapter.ts` defines `TurnRequest` and `AgentAdapter` with no claude-specific fields (D-12). `src/adapters/claude.ts` exports `makeClaudeAdapter(bin = "claude")`; `invoke` builds argv `["-p", promptText, "--output-format", "json"]` (no config-isolation flag — D-09 amended / Pitfall 1), calls `execa(bin, argv, { timeout, killSignal:"SIGTERM", forceKillAfterDelay:5000, reject:false, cleanup:true })`, and normalizes: `timedOut`/forced-kill → `{ok:false, timedOut:true, error:"timeout"}`; unparseable stdout → `{ok:false, error:"unparseable output: …"}`; else `ok = exitCode===0 && is_error===false` mapped to `TurnResult` (text/costUsd/sessionId/structuredOutput/error). The misleading `result.type`/subtype is never read.
- **Task 2 (invocation logger):** `src/log/invocation.ts` exports `logInvocation(runDir, record)` appending exactly one NDJSON line to `runs/<id>/invocations.ndjson` via a synchronous pino destination. The record carries `command` (argv), `promptRef` (a reference, not the prompt body — D-15 / V7), `exitCode`, `durationMs`, `timedOut`, and `artifactPath`. Base fields (pid/hostname) disabled; an explicit ISO `ts` added for ordering.

## Verification

- `npx vitest run test/claude-adapter.test.ts test/invocation.test.ts` → **9 passed** (5 adapter + 4 logger).
  - Adapter: happy (`ok:true, text:"pong", costUsd≈0.19`), `--fail-auth` (`ok:false` despite the misleading subtype, exit 1 AND is_error), `--bad-json` (graceful `ok:false`, "unparseable", no throw), `--hang` @ `timeoutMs:200` (`timedOut:true`, process killed), flag-pinning (execa mock asserts exact argv, no forbidden flag, `reject:false`, `timeout` set).
  - Logger: one parseable NDJSON line per call (count===calls), all six fields present, prompt-reference-only (no multi-line body, no newline in `promptRef`), file named `invocations.ndjson`.
- `npx tsc --noEmit` → clean (exit 0).
- `npx biome check src/adapters src/log test/claude-adapter.test.ts test/invocation.test.ts` → clean.
- Guards: no `--bare` (`grep` clean), no `subtype` branching (`grep` clean), no `shell:true` (only an explanatory comment references the word "shell"; `grep -E 'shell\s*:\s*true'` is empty).
- Full suite note: `npx vitest run` reports `26 passed | 1 failed`; the single failure is `test/e2e-invoke.test.ts`, the intentional RED MVP skeleton anchor that Plan 03 turns green (documented in 01-01-SUMMARY). It is out of this plan's scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pino 10 `destination` static not on the named import type**
- **Found during:** Task 2 (`tsc --noEmit`)
- **Issue:** `import { pino } from "pino"` typed `pino.destination` as nonexistent (TS2339) under pino 10.3.1 — the `destination` static lives on the default export type, not the named one (Pitfall 4 major-version drift).
- **Fix:** Switched to `import pino from "pino"` (default import). Runtime behavior identical; typecheck now clean.
- **Files modified:** src/log/invocation.ts
- **Commit:** 7922fd0

No Rule 1, 2, or 4 deviations. The dropped config-isolation flag and the exitCode-AND-is_error ok-rule were pre-resolved in CONTEXT/RESEARCH, not runtime deviations.

## Known Stubs

None. The only failing test in the repo is the planned RED anchor `test/e2e-invoke.test.ts` (turned green by Plan 03) — not a stub introduced here.

## Threat Surface Notes

No new surface beyond the plan's threat model. Mitigations applied as planned:
- T-01-05 (tampering via argv): execa passes argv as an array, no `shell:true`, no string concatenation.
- T-01-06 (unparseable stdout): `ClaudeJson.safeParse` over a non-throwing JSON parse → graceful `ok:false`.
- T-01-07 (hung invocation): execa `timeout` + `forceKillAfterDelay:5000` → reported `timedOut`; verified by `--hang` test.
- T-01-08 (log disclosure): `promptRef` is a reference, not the body; API key never logged.
- T-01-09 (spoofed success): success requires exitCode===0 AND is_error===false; `subtype` never read.

## For Plan 03

- Wire `src/cli.ts` `mar invoke`: `createRun` (or load `--run`) → `makeClaudeAdapter(process.env.MAR_CLAUDE_BIN ?? "claude")` → `invoke(TurnRequest)` → on `ok`, `writeArtifact` + `addArtifact`; always `logInvocation(runDir, record)` and `setStatus` (completed/failed/timeout). That turns `test/e2e-invoke.test.ts` green.
- The adapter binary is injectable; the e2e test passes `MAR_CLAUDE_BIN` — read it in the CLI, do not hardcode `"claude"`.
- `logInvocation`'s `command` should be the same argv the adapter spawned, and `promptRef` a path/label (e.g., the prompt file or a short hash) — never the full prompt text.

## Commits

- 193fc3a feat(01-02): AgentAdapter interface + claude adapter with execa + normalization
- 7922fd0 feat(01-02): pino NDJSON invocation logger (ORCH-06)

## Self-Check: PASSED

All 5 created files verified on disk; both per-task commits (193fc3a, 7922fd0) verified in git log.
