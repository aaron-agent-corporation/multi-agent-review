# Phase 1: Workspace + First Adapter - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

A user can run one installed vendor CLI (claude) headlessly through a common adapter call and see its output captured as a deterministically named, normalized artifact in a manifest-indexed `runs/<id>/` workspace. Every invocation is logged (command, prompt reference, exit code, duration, output location) and bounded by an external wall-clock timeout.

Covers requirements: ORCH-01 (claude only), ORCH-06, PROT-02, PROT-07. Multi-vendor adapters, roster config, and pre-flight checks are Phase 2. The protocol state machine is Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Stack (locked — user confirmed the research recommendation)
- **D-01:** TypeScript on Node 22 LTS, ESM modules. Per `.planning/research/STACK.md`.
- **D-02:** `execa` 9.x for subprocess control — separate stdout/stderr capture, timeout, graceful kill.
- **D-03:** `zod` for validating CLI JSON output and defining the normalized `TurnResult` schema.
- **D-04:** XState v5 is the chosen state-machine library for the protocol engine, but the protocol engine is Phase 3 — do NOT introduce XState in Phase 1 unless trivially needed. Phase 1 has no state machine to model.
- **D-05:** Supporting libs as recommended by research where needed: commander (CLI parsing), pino (NDJSON logging), fs-extra (atomic writes), nanoid (IDs). Don't add gray-matter or p-queue until an actual need appears (Phase 2+).

### CLI shape & invocation UX (Claude's discretion — recommended defaults below)
- **D-06:** Single CLI entry point named `mar` (multi-agent-review), built with commander. Phase 1 ships one subcommand: `mar invoke --agent claude --prompt <file-or-string> [--run <id>]` (exact flag names at planner's discretion).
- **D-07:** If no `--run` is given, a new run is created; if given, the invocation appends to the existing run. Creating a run and invoking into it are not separate required steps in Phase 1.
- **D-08:** Console output is human-readable progress (agent, elapsed time, exit status, artifact path); the structured record goes to the log file and manifest, not stdout.
- **D-09 (amended per Phase 1 research):** Use `claude -p` with `--output-format json` — WITHOUT `--bare`. Live testing (RESEARCH.md, claude 2.1.162) showed `--bare` only reads `ANTHROPIC_API_KEY`/apiKeyHelper and breaks subscription (OAuth/keychain) auth, which is what the user runs on. Config-isolation can be revisited in Phase 2 (e.g., `--settings`). Adapter must treat a turn as failed when `exitCode !== 0` OR `is_error === true` — exit code alone is unreliable.

### Artifact format & naming (Claude's discretion — recommended defaults below)
- **D-10:** Normalized artifact = markdown file containing the agent's text output, with a small YAML frontmatter header (agent, vendor, timestamp, run id, turn id, source invocation log reference). Raw CLI JSON response is preserved alongside as a sibling `.raw.json` file — never discard the raw output.
- **D-11:** Deterministic naming: `<seq>-<agent>-<kind>.md` within the run directory (e.g., `001-claude-output.md`), where `seq` is a zero-padded turn sequence number. Phase 3 will extend `kind` to protocol phases (draft/review/response/...); Phase 1 only needs a generic kind.
- **D-12:** "Normalized" means: the adapter maps the vendor-specific JSON shape to a single zod-validated `TurnResult` type (text, exit code, duration, session/usage metadata when available, error info). The protocol layer never sees vendor JSON.

### Run workspace & manifest design (Claude's discretion — recommended defaults below)
- **D-13:** Run directory: `runs/<run-id>/` relative to the project workspace. Run ID = timestamp prefix + short nanoid (e.g., `20260604-x7Kp2a`) — sortable and collision-safe.
- **D-14:** `runs/<id>/manifest.json` is the authoritative index: run id, status, created/updated timestamps, CLI versions detected, and an artifacts array (path, agent, seq, kind, created). State is always derivable from disk — no in-memory-only run state.
- **D-15:** Invocation log: append-only NDJSON at `runs/<id>/invocations.ndjson` (pino), one record per invocation with command argv, prompt reference, exit code, duration ms, timeout flag, output artifact path.
- **D-16:** Manifest writes are atomic (write-temp-then-rename via fs-extra) so a crash never leaves a corrupt manifest.

### Timeout behavior
- **D-17:** External wall-clock timeout on every invocation (execa `timeout`), default generous (e.g., 10 minutes) and configurable per invocation. On timeout: kill the process, log the invocation with timeout flag, write no normalized artifact (or a failure marker), set manifest status accordingly. No retry logic in Phase 1 — bounded retry is ORCH-02 (Phase 2).

### Claude's Discretion
User explicitly delegated CLI shape, artifact format/naming, and workspace/manifest design ("whatever you think"). D-06 through D-17 are recommended defaults — the planner may adjust details where research or implementation reality argues for it, as long as the Phase 1 success criteria hold.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (load-bearing)
- `.planning/research/STACK.md` — verified headless invocation flag reference per CLI (the Claude Code table is the one Phase 1 needs), library choices and rationale. The flag table should be pinned in adapter tests.
- `.planning/research/ARCHITECTURE.md` — component diagram, project structure, dependency-driven build order; filesystem-as-truth design.
- `.planning/research/PITFALLS.md` — headless silent hangs, CLI flag/output brittleness, auth/rate-limit failures; pitfall-to-phase map.
- `.planning/research/SUMMARY.md` — executive synthesis of all research.

### Source evidence
- `docs-case-study.md` — the manual Claude+Codex session that proved the 6-phase protocol; artifact-per-turn convention and anti-patterns originate here.

### Project planning
- `.planning/PROJECT.md` — requirements, constraints, key decisions table.
- `.planning/REQUIREMENTS.md` — ORCH-01, ORCH-06, PROT-02, PROT-07 definitions for this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

Greenfield — no source code exists yet. Repo contains only `CLAUDE.md`, `docs-case-study.md`, and `.planning/`. No codebase maps in `.planning/codebase/`.

### Established Patterns
- None to inherit. Phase 1 establishes the patterns (adapter interface, artifact naming, manifest schema) that all later phases build on — treat these contracts as the phase's real deliverable.

### Integration Points
- Phase 2 will add codex/gemini adapters behind the same `AgentAdapter` interface — keep the interface vendor-agnostic from day one (no claude-specific fields in `TurnRequest`/`TurnResult`).

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the research — user said "this is all pretty simple and laid out," confirmed the research stack, and delegated remaining choices.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

Note for Phase 2+ planning (from STACK.md): Claude `-p`/Agent SDK usage moves to a separate subscription credit pool starting June 15, 2026 — re-validate the "existing subscriptions cover usage" budget assumption before heavy multi-agent runs.

</deferred>

---

*Phase: 1-Workspace + First Adapter*
*Context gathered: 2026-06-04*
