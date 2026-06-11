# Claude Code Plugin for Multi-Agent Review — Design

**Date:** 2026-06-11
**Status:** Approved (user, this date) — pending implementation via GSD

## Goal

Make the `mar` orchestrator invocable from any Claude Code session as a plugin: a
`/mar-review <document>` command backed by a skill in which Claude acts as **driver +
gate reviewer** — launching gated runs, summarizing each phase's artifacts at every
gate, relaying the user's approve / feedback / abort decision, and delivering a final
digest. The plugin is a thin invocation layer; all protocol logic stays in `mar`
(coordination remains vendor-neutral — Claude Code here is just the user's terminal,
not the orchestrator runtime).

## Packaging (repo-as-marketplace, code-kg pattern)

New files in this repo, mirroring the layout of `Whaleylaw/code-kg`:

```
.claude-plugin/marketplace.json          # repo root — registers the repo as a marketplace
plugins/mar/
  .claude-plugin/plugin.json             # name: "mar", version synced with package.json
  commands/mar-review.md                 # /mar-review slash command
  skills/mar-review/SKILL.md             # the driver + gate-reviewer skill
```

- `marketplace.json`: `{ name: "multi-agent-review", owner: agent-corporation, plugins: [{ name: "mar", source: "./plugins/mar" }] }`
- **Distribution:** the repo is published as a **public GitHub repo under the
  `agent-corporation` org** and the marketplace is registered from GitHub:
  `claude plugin marketplace add agent-corporation/multi-agent-review`, then
  `claude plugin install mar@multi-agent-review`. (Same hosting pattern as code-kg.)
- `npm link` from a local clone puts `mar` on PATH (the plugin shells out to it; the
  marketplace distributes the skill/command, not the Node runtime).
- **Pre-publication audit:** before the first public push, verify no client/legal
  content is tracked — `runs/` (live review artifacts) must be gitignored or purged.

## Binary resolution

The skill resolves the CLI in order:

1. `mar` on PATH (normal case after `npm link` / `npm i -g`).
2. Fallback: `node "<this repo>/dist/src/cli.js"` — the skill documents the repo path;
   if `dist/` is missing or stale it tells the user to run `npm run build`.

## Skill behavior (`/mar-review <input> [--autonomous]`)

1. **Preflight.** Resolve the binary. If the working directory lacks `mar.config.json`,
   run `mar init`. Run `mar preflight`; refuse to start (and explain) if fewer than 2
   distinct vendors are healthy (the D-29 gate would reject the run anyway — surface it
   early with the preflight table).
2. **Launch.** `mar run <input> --gated --pause-and-exit` as a **background task**
   (runs span many minutes; Claude monitors instead of blocking). `--autonomous`
   switches to `mar run <input> --autonomous` and skips to step 5.
3. **Gate mediation loop.** When the process exits 0 with status
   `paused-awaiting-approval`, Claude reads the run's manifest and the just-completed
   phase's artifacts from `runs/<id>/`, then presents a digest: what each agent
   produced, notable cross-review findings by severity, convergence/escalation status.
   It asks the user (structured question): **approve** / **feedback <note>** / **abort**.
4. **Continue.** Relay the decision via the resume CLI (below) with the gated step
   flag, so the run pauses again at the next boundary. Loop until terminal status.
   If convergence escalates to arbitration, present each agent's final position and
   relay the user's ruling the same way.
5. **Deliver.** Final digest: integrated document path, decision record summary
   (accepted/rejected counts, any escalations), and pointers into `runs/<id>/`.

Failure handling: if the background process exits non-zero, Claude reports the stderr
tail and the manifest status, and offers `mar resume` (the engine's D-54/D-56 resume
path already handles interrupted/failed runs).

## Required `mar` CLI enhancement (the only code change)

Today a bare `mar resume` continues **autonomously to completion** — `runResume` calls
`resumeProtocol(runDir, config)` without gating, although the engine already accepts
and threads `GatingOptions` through resume (engine.ts ~1336). The gate-mediation loop
needs three thin flags on `resume`:

| Flag | Effect |
|------|--------|
| `--step` | Resume with `{ mode: "gated", pauseAndExit: true }` — run exactly one phase, then pause again. (Name avoids overloading `--gated`, which on `run` implies an interactive TTY prompt.) |
| `--feedback "<note>"` | Before resuming, persist the note via the existing `writeGateFeedback` path (`gate-feedback/<phase>.md`, D-51) and thread it into the resumed phase's prompt context. |
| `--abort` | Mark the paused run `aborted` (terminal) without running anything. Mutually exclusive with `--step`/`--feedback`. |
| `--ruling "<agent>"` | Resolve a run paused at an escalated arbitration: record the human ruling (choose that agent's position as base/integrator) through the existing `arbitrationLedgerEntry`/`writeHumanRuling` path, then continue. |

**Arbitration under pause-and-exit (correctness fix, found in design review):** in gated
mode the engine's arbitration boundary unconditionally calls the interactive `ask()`
seam when convergence escalates (engine.ts ~770) — `pauseAndExit` is not consulted
there, so a background `--pause-and-exit` run that escalates would block on stdin.
The enhancement must make the arbitration boundary pause-and-exit aware: when
`pauseAndExit` is set and convergence escalates, write `paused-awaiting-approval`
(manifest records the pending arbitration) and exit 0; Claude then presents each
agent's final position and relays the ruling via `mar resume --ruling`.

Implementation notes:

- `--step`/`--feedback` reuse existing engine seams; the main new work is making
  `resumeProtocol` accept an optional feedback note and thread it as the next phase's
  `feedback` context (the interactive path threads it in-memory today — resume must
  pass it explicitly or read it back from `gate-feedback/`).
- Feedback note sanitization already exists in `gating.ts` (control-char flattening,
  T-05-14/T-05-16) — the flag path MUST route through the same sanitizer.
- Tests: extend the existing CLI/engine test suites — `--step` pauses at the next
  boundary; `--feedback` lands in `gate-feedback/` and appears in the next phase's
  prompt; `--abort` writes terminal status; mutual-exclusion errors exit 2.

## Out of scope

- No MCP server, no hooks, no real-time integration — the plugin only shells out
  (consistent with PROJECT.md's turn-based, artifact-based design).
- No bundling of `mar` inside the plugin; it requires the repo's build on the machine.
- No changes to the protocol engine's phase logic or artifact formats.
- Publishing to a public marketplace (possible later; structure already supports it).

## Testing the plugin layer

The skill/command are markdown (no unit tests). Verification is a live smoke run:
`/mar-review` on a small fixture document from a scratch directory, exercising one
approve gate, one feedback gate, and an abort, confirming statuses in `runs/<id>/`.
