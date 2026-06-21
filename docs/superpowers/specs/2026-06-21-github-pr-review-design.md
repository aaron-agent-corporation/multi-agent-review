# GitHub PR Review Integration — Design

**Date:** 2026-06-21
**Status:** Approved by user in-chat — implement CLI core first, GitHub Action wrapper later

## Goal

Add a PR-review mode that sends a GitHub pull request through the existing multi-agent
adversarial protocol and produces one unified, GitHub-ready review. The first version
is a local CLI command backed by the authenticated `gh` CLI; a GitHub Action wrapper
should call the same command later instead of reimplementing the workflow.

## Product Shape

The command is:

```sh
mar pr review <pr-url-or-number> [--post] [--gated|--autonomous|--pause-and-exit]
```

It fetches PR metadata, changed files, commits, and patch text through `gh`, renders a
self-contained markdown review brief, and runs the normal six-phase protocol against
that generated document. Each agent independently drafts a PR review, critiques peers'
reviews, responds, converges, integrates, and validates. The integration artifact is
then extracted into `runs/<id>/github-review.md`.

By default the command is dry-run/local: it prints the run output and leaves the final
review body on disk. With `--post`, it submits the unified result to GitHub as a PR
review comment through `gh pr review --comment --body-file`.

## Architecture

This is an input/output adapter around the existing protocol, not a new phase machine.
The protocol invariants stay intact: independent draft workdirs, filesystem artifacts,
phase gates, convergence, integration, validation, and resumability remain owned by
`runProtocol`.

New modules:

- `src/github/gh.ts`: small, injectable wrapper around `gh` subprocess calls.
- `src/github/pr-context.ts`: fetches PR JSON/diff and renders the review brief.
- `src/github/publish.ts`: extracts the integration body and optionally posts it.
- `src/pr-review.ts`: creates the generated input, starts the protocol run, and handles
  final review output.

`src/cli.ts` remains the thin command router. It reuses the same roster diversity gate
and gated/autonomous option resolution as `mar run`.

## PR Brief Contract

The generated input must contain enough context for agents to review without reaching
back to GitHub:

- PR URL, number, title, author, state, draft status, base/head refs.
- Additions, deletions, changed file count.
- Commit headlines and changed-file summary.
- Full patch text up to a bounded byte cap, with an explicit truncation warning when
  capped.
- Instructions that the desired final artifact is a GitHub-ready PR review body with
  blocking findings, non-blocking recommendations, tests/verification notes, and open
  questions.

Large diffs are bounded before the brief enters the protocol so generated inputs stay
under the existing 10 MB input limit.

## Posting Behavior

`--post` posts only after the protocol reaches a terminal completed/escalated state and
an integration artifact exists. Paused, failed, and timeout runs do not publish. This
prevents half-reviewed output from appearing on GitHub.

Publishing uses `gh pr review <selector> --comment --body-file <file>`. The command
does not request changes or approve in v1 because the merged review body is free-form;
classification into approval/request-changes can be added later once the integration
schema carries that decision explicitly.

## GitHub Action Later

The Action should run the same CLI command in CI:

```sh
npm ci
npm run build
node dist/src/cli.js pr review "$PR_URL" --post --autonomous
```

It needs `GITHUB_TOKEN`/`gh auth` setup and should not contain protocol logic. It is a
thin runner around the CLI core.

## Testing

All tests fake GitHub and vendor CLIs:

- Unit tests for `gh` command argument shape and error reporting.
- Unit tests for PR JSON parsing and review-brief rendering, including diff truncation.
- Integration test for `runPullRequestReview` with fake `gh` output plus existing fake
  agents, asserting `github-review.md` is produced without network/API calls.
- Publishing test that verifies `--post` calls `gh pr review --comment --body-file`
  with the generated review body.

No test should call real GitHub or spend model credits.

