# Repo-Aware Worktrees and Tmux Review Execution — Design

**Date:** 2026-06-25
**Status:** Draft for user review

## Goal

Make MAR repo-aware by default. When a review starts inside a git repository, each
reviewer should get its own disposable git worktree rooted at the reviewed commit so
it can inspect the full codebase, take notes, and even make accidental edits without
polluting the caller's checkout or another reviewer's view. Add an optional tmux
execution mode so external babysitter agents can observe and steer the reviewer
terminals without changing MAR's artifact-based protocol.

## Default Behavior

`mar run <input>` and `mar pr review <selector>` should automatically detect whether
the command is running inside a git repository. If so, the run is repo-aware by
default:

- MAR resolves the source repository root and the commit to review.
- MAR creates one linked git worktree per reviewer under
  `runs/<run-id>/worktrees/<agent>/`.
- Each reviewer's draft phase runs from its own worktree root, with the review input
  and vendor instruction file seeded into a MAR-owned subdirectory.
- Reviewers may read the whole repository from their worktree.
- Any file writes happen inside that reviewer worktree and are disposable.
- MAR harvests the required review artifact from each reviewer and promotes only that
  artifact into the shared protocol workspace.

When MAR is not launched inside a git repository, it falls back to the current
document-only isolated workspace behavior.

## Worktree Model

The worktree layer is an execution workspace, not a protocol workspace. The protocol
workspace remains `runs/<run-id>/` and continues to own the manifest, logs, shared
artifacts, resolved decisions, integration, validation, and final review output.

Recommended layout:

```text
runs/<run-id>/
  manifest.json
  input/
    review.md
  shared/
  work/
    <agent>/
      input.md
      AGENTS.md | CLAUDE.md | GEMINI.md
  worktrees/
    <agent>/
      <full checked-out repo>
      .mar/
        input.md
        AGENTS.md | CLAUDE.md | GEMINI.md
        output.md
```

The adapter `cwd` should be `runs/<run-id>/worktrees/<agent>/` for repo-aware draft
turns. The prompt should direct each reviewer to write its structured MAR artifact to
`.mar/output.md`. MAR then copies that output into the normal artifact path. Shared
phases can continue to run from `runs/<run-id>/` because they evaluate protocol
artifacts, not the source tree. If shared phases later need repo access, they should
receive read-only access to the agreed base reviewer's worktree instead of all
reviewer worktrees.

## PR Review Behavior

For `mar pr review`, MAR should use the PR head commit as the worktree source. The
generated PR brief still matters: it gives all reviewers the same bounded summary of
PR metadata, changed files, diff context, posting expectations, and review rubric.
The difference is that reviewers can now inspect the full checked-out PR tree when
the brief is insufficient.

The existing pending/success/failure GitHub status behavior remains unchanged. MAR
should still post only the final unified review, not each independent draft.

## Local Plan and Spec Review Behavior

For non-PR `mar run`, the input file is still the plan, spec, architecture note, or
proposal under review. Running inside a git repo now gives reviewers full repo
context by default, so a plan review can compare the proposal against real code. The
input document remains the review target and should still name the intended files,
risks, and questions when possible.

## Sandbox Boundary

Git worktrees protect the caller's checkout and preserve reviewer independence, but
they are not a security sandbox. MAR should treat sandboxing as a separate execution
layer:

- v1: worktree isolation, strict `cwd`, no shell interpolation, bounded timeouts, and
  vendor-specific read-only or low-permission CLI flags where available.
- v1 hardening: explicit `MAR_SANDBOX_MODE` / config support with `none`, `native`,
  and later `container` or OS-specific modes.
- Codex should continue to use its native sandbox flags.
- Grok should continue using bounded turns and deny-by-default permission mode unless
  a future vetted mode requires more.
- Claude and Gemini should rely on worktree isolation plus any available CLI
  permission flags until a real OS/container sandbox is added.

The operator-facing language should be precise: worktrees make accidental edits safe;
they do not by themselves prevent a local process from reading paths outside the
worktree if the process has normal filesystem permission.

## Repo-Local Environment

MAR should support a repo-local environment file:

```text
.mar/MAR.env
.mar/MAR.env.example
```

`mar auth init` should create `.mar/MAR.env.example`, create `.mar/MAR.env` if
missing, set restrictive permissions on `.mar/MAR.env`, and add `.mar/MAR.env` to
`.gitignore`. The file is loaded by `mar preflight`, `mar run`, and `mar pr review`
before vendor probes or reviewer invocations.

`MAR.env` may contain token-style credentials and MAR-specific auth pointers:

```sh
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
GOOGLE_CLOUD_PROJECT=
XAI_API_KEY=
GROK_API_KEY=    # accepted as an alias for XAI_API_KEY for Grok headless auth
MAR_CODEX_HOME=
MAR_GROK_HOME=   # optional persistent isolated Grok home; credentials live under $MAR_GROK_HOME/.grok/
MAR_CLAUDE_CONFIG_DIR=
MAR_GEMINI_CONFIG_DIR=
```

MAR should not print secret values. Logs may name which env keys were loaded but must
not include values. Browser or keychain based vendor logins should not be copied into
`MAR.env`; instead, `MAR.env` should point the CLI at the correct local auth profile
where the vendor supports that.

## Optional Tmux Mode

Add an execution backend option:

```sh
mar run docs/plan.md --tmux
mar pr review 7 --tmux --post
```

or config:

```json
{
  "defaults": {
    "terminalMode": "tmux"
  }
}
```

In tmux mode, MAR creates a session per run, such as `mar-<run-id>`, with one window
or pane per reviewer. Each pane starts in that reviewer's worktree. The visible
terminal command should run the same adapter invocation MAR would have run headlessly,
but through a small wrapper that writes machine-readable result files back into the
run directory.

The tmux mode is for observability and external control by a babysitter agent. It
must not change the protocol:

- Reviewers still begin independently.
- Drafts are not shared until the draft phase closes.
- Shared phases still run only after MAR promotes artifacts.
- The final output remains one unified MAR review.
- A babysitter may observe panes and send terminal input, but MAR's manifest and
  artifacts remain the source of truth.

If tmux is requested but unavailable, MAR should fail early with a clear message
rather than silently falling back to headless execution.

## Cleanup and Debugging

Default cleanup should keep enough evidence for debugging while avoiding permanent
worktree accumulation:

- Completed runs may remove linked worktrees after artifacts are harvested.
- Failed, timed-out, or interrupted runs should keep worktrees by default.
- `--keep-worktrees` keeps worktrees for any run.
- `mar cleanup <run-id>` should remove linked worktrees and stale tmux sessions for a
  run.

The manifest should record:

- whether repo-aware mode was active,
- source repo root,
- source commit,
- per-agent worktree path,
- terminal mode,
- tmux session name when used,
- whether each worktree was retained or cleaned.

## Testing

Tests should not require real vendor CLIs, real GitHub calls, or tmux unless the test
is explicitly marked integration. Unit coverage should include:

- repo detection outside a git repo,
- worktree path planning and safe agent-name validation,
- git worktree command argument shape,
- `.mar/MAR.env` loading and secret redaction,
- `.gitignore` update behavior,
- adapter `cwd` and env threading,
- fallback to document-only mode outside git,
- tmux command planning when enabled,
- clear failure when tmux is requested but missing.

An end-to-end fake-vendor test should create a temporary git repo, run MAR in
repo-aware mode, assert each fake reviewer saw a distinct worktree path, and verify
that an intentional edit in one reviewer worktree never appears in the caller's
checkout or another reviewer's worktree.

## Open Implementation Notes

This design should be implemented behind small seams:

- `src/repo/git.ts`: git repo detection, commit resolution, worktree create/remove.
- `src/env/mar-env.ts`: `.mar/MAR.env` parsing, loading, example generation,
  gitignore handling, and redacted reporting.
- `src/execution/workspaces.ts`: choose document-only vs repo-aware reviewer
  workspace for each phase.
- `src/execution/tmux.ts`: tmux session/window planning and wrapper invocation.
- Adapter request types should carry `cwd`, `env`, and optional output-file hints
  without making the protocol layer vendor-specific.

The first implementation should ship headless repo-aware worktrees and `MAR.env`
before tmux. Tmux should be the next slice, because it depends on the same worktree
and wrapper seams but adds lifecycle complexity.
