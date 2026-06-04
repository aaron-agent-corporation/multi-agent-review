# Walking Skeleton — Multi-Agent Review

**Phase:** 1
**Generated:** 2026-06-04

## Capability Proven End-to-End

A user runs `mar invoke --agent claude --prompt "<text-or-file>"` and sees the real claude CLI driven headlessly, its output captured as a deterministically named, normalized markdown artifact (with a raw JSON sibling) inside a manifest-indexed `runs/<id>/` workspace, with the invocation logged and bounded by a wall-clock timeout.

This exercises the full stack of this filesystem-first CLI tool: command dispatch (commander) → subprocess invocation (execa adapter) → normalization (zod) → filesystem read/write (workspace layout + atomic manifest + artifact writer) → audit log (pino) → human-readable console output.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime / language | Node 22 LTS (machine runs 24; `engines: >=22`), TypeScript 6, ESM (`"type":"module"`, `module: nodenext`) | Locked D-01. I/O-bound orchestrator; native ESM; execa/zod are ESM-first. |
| Subprocess control | execa 9 (`timeout`, `forceKillAfterDelay`, `reject:false`, separate stdout/stderr, no-shell) | Locked D-02. Owns process lifecycle, kill escalation, injection-safe argv. Protocol never spawns directly. |
| Schema / validation | zod 4 — `ClaudeJson` (`.passthrough()`) + vendor-agnostic `TurnResult` | Locked D-03. Single source of truth for the normalized contract; tolerates vendor key drift. |
| "Routing" (CLI dispatch) | commander 15 — `mar` entry, `invoke` subcommand | D-06. Thin dispatch only; no business logic in the CLI layer. |
| "DB" (state store) | The filesystem. `runs/<id>/manifest.json` is authoritative; state is always re-derivable from disk | D-14, ARCHITECTURE filesystem-as-truth. No in-memory-only run state, no daemon, no message bus. |
| Atomic writes | fs-extra temp-file + rename for manifest AND artifacts | D-16. A crash leaves a complete prior file, never a corrupt/half-written one. "Done" = exists AND non-empty. |
| Audit log | pino 10 NDJSON → `runs/<id>/invocations.ndjson` (one record per invocation) | D-15. Correct NDJSON, no partial-line interleave; prompt *reference* not content. |
| Run IDs | nanoid 5 + `YYYYMMDD` timestamp prefix (e.g. `20260604-x7Kp2a`) | D-13. Sortable and collision-safe; charset has no path separators. |
| Adapter boundary | `AgentAdapter` interface; all claude specifics behind `makeClaudeAdapter(bin)`; `TurnRequest`/`TurnResult` are vendor-agnostic | D-12, ARCHITECTURE Anti-Pattern 3. Adding codex/gemini (Phase 2) is a one-file addition; protocol never branches on vendor. |
| claude invocation | `claude -p --output-format json` **WITHOUT `--bare`** | D-09 amended (RESEARCH Pitfall 1): `--bare` reads only `ANTHROPIC_API_KEY`/apiKeyHelper and breaks the subscription/OAuth auth the user runs on. Success = `exitCode===0 AND is_error===false`; never trust `subtype`. |
| Timeout | execa wall-clock `timeout`, default 600000ms (10 min), configurable per invocation | D-17. On timeout: kill, log with timeout flag, write no normalized artifact, set manifest status `timeout`. No retry in Phase 1 (that is ORCH-02 / Phase 2). |
| Test runner / tooling | vitest 4, tsx 4 (dev run), biome 2 (lint+format) | RESEARCH Standard Stack. Adapter tested entirely against a fake-CLI fixture — zero real claude credits in CI. |
| Directory layout | `src/{cli.ts, adapters/, schema/, workspace/, log/}` + `test/{fixtures/, *.test.ts}` + gitignored `runs/` | ARCHITECTURE recommended structure (Phase 1 subset); `workspace/` owns all path/naming logic. |

## Stack Touched in Phase 1

- [x] Project scaffold (ESM/TS/Node 22, vitest, biome, tsconfig) — Plan 01 Task 1
- [x] "Routing" — `mar invoke` command dispatch via commander — Plan 03 Task 1
- [x] "DB" read AND write — atomic `manifest.json` + artifact write, re-derived from disk — Plan 01 Task 3, Plan 03 Task 1
- [x] "UI interaction" — invoking `mar invoke` and seeing a human-readable progress line — Plan 03 Task 1
- [x] "Deployment" — runnable locally via `npx tsx src/cli.ts invoke ...` (and `mar` bin after build) — Plan 03 (live human-verified smoke)

## Out of Scope (Deferred to Later Slices)

Explicitly NOT in the skeleton — later phases must not re-litigate Phase 1's minimalism:

- Multi-vendor adapters (codex, gemini) and the adapter registry — **Phase 2**
- Agent roster config, ≥2-distinct-vendor refusal, pre-flight install/auth/responsiveness checks — **Phase 2**
- Bounded retry + configurable retry policy (only the timeout exists in Phase 1) — **Phase 2 (ORCH-02)**
- The 6-phase protocol state machine, XState, turn-taking, phase gates — **Phase 3**
- Independence enforcement / workspace-scoping / draft promotion — **Phase 3**
- Cross-review, structured responses, evaluation, integrator designation, decision record — **Phase 4**
- Resume, human gating at phase boundaries, majority signal, re-litigation guards — **Phase 5**
- Prompt-injection / least-privilege defenses for untrusted document inputs — **Phase 5**
- JSON-schema-constrained output (`--json-schema`) — adapter leaves room (`structuredOutput?`) but does not use it in Phase 1
- `--bare` / config-isolation / API-key reproducibility path — revisit in Phase 2 (e.g. `--settings`)
- Cost/token dashboards, run comparison views — v2

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions (filesystem-as-truth, vendor-agnostic adapter boundary, atomic writes, deterministic naming):

- **Phase 2:** A user configures a multi-vendor roster; all three CLIs invoke through the same `AgentAdapter`; the system refuses unsafe rosters and pre-flights each CLI before a run.
- **Phase 3:** A user starts a run on a document and watches it advance through all 6 phases with enforced turn-taking and structural draft independence.
- **Phase 4:** One complete 3-agent run through all 6 phases produces a decision record (the v1 success bar).
- **Phase 5:** Resumable, human-gateable runs with majority signal, escalation, and re-litigation guards.
