# multi-agent-review (`mar`)

Vendor-neutral orchestration of frontier-model CLIs through a structured adversarial
review protocol. Differently-trained models catch each other's blind spots — `mar`
runs Claude Code, Codex CLI, Gemini CLI, and xAI Grok Build (extensible to more)
through a 6-phase review of any document, preserving genuine independence between
agents while eliminating the human copy-paste relay.

## The protocol

```
draft → cross-review → response → evaluation (convergence) → integration → validation
```

1. **Draft** — every agent drafts independently in a scoped workspace. No agent can
   see a peer's draft before the boundary (enforced on disk, not by convention).
2. **Cross-review** — drafts are promoted; each agent reviews its peers' work and
   raises numbered, severity-tagged issues.
3. **Response** — authors answer the issues raised against their drafts: accept,
   rebut, or concede.
4. **Evaluation** — a bounded convergence loop where agents propose which draft
   should be the base. Unanimity or a clear majority resolves it; a deadlock
   escalates (in interactive gated mode, to a human ruling).
5. **Integration** — the designated integrator merges the accepted material into one
   document.
6. **Validation** — every agent verifies the integrated result.

Every run produces an auditable artifact trail in `runs/<id>/` — per-phase markdown
artifacts with structured frontmatter, a manifest, a re-litigation-guarded decision
ledger, and a final decision record (resolved decisions, open decisions, run chain).

Design invariants worth knowing:

- **≥2 distinct vendors, no override.** A model reviewing itself shares its own
  blind spots, so single-vendor runs are refused.
- **Filesystem as the message bus.** Turn-based and artifact-based by design — no
  real-time agent chat, no message broker, no MCP coordination.
- **Coordination lives outside every vendor's runtime.** `mar` drives the CLIs you
  already have installed and authenticated (`claude`, `codex`, `gemini`, `grok`);
  it never calls vendor APIs.
- **Resumable by re-derivation.** Interrupted, failed, and gate-paused runs resume
  from the on-disk trail (never a serialized state snapshot), with integrity
  re-validation before continuing.

## Install

Requires Node 22+ and at least two authenticated vendor CLIs on your PATH.

```sh
git clone https://github.com/The-Agent-Corporation/multi-agent-review
cd multi-agent-review
npm install
npm run build
npm link        # puts `mar` on your PATH
```

## Quickstart

```sh
mar init        # detect installed vendor CLIs, write a starter mar.config.json
mar auth init   # create .mar/MAR.env for repo-local MAR credentials/config
mar preflight   # check each roster agent is installed, authenticated, responsive
mar run document.md --gated      # run the protocol, pausing at each phase gate
mar run document.md --autonomous # run unattended end to end
```

When `mar run` starts inside a git repository, repo-aware review is enabled by
default. Each reviewer gets its own linked git worktree under
`runs/<id>/worktrees/<agent>/`, rooted at the commit being reviewed. Draft turns run
from those worktrees, so reviewers can inspect the full codebase while accidental
edits stay isolated from the caller checkout and from other reviewers. Outside a git
repository, MAR falls back to the document-only scoped workspace behavior.

`mar auth init` creates `.mar/MAR.env`, `.mar/MAR.env.example`, and adds
`.mar/MAR.env` to `.gitignore`. `mar preflight`, `mar run`, and `mar pr review` load
that file before probing or invoking vendor CLIs. Secret values are never printed;
status output names only loaded keys.

For Grok, MAR defaults to a persistent isolated runtime home at
`~/.grok/mar-runtime`: it keeps refreshed Grok auth while hiding unrelated
Claude/Cursor MCP and plugin config from headless review turns. Set
`MAR_GROK_HOME` in `.mar/MAR.env` only if you want that persistent Grok runtime
somewhere else.

In gated mode each phase boundary prompts: `approve` to continue, `feedback <note>`
to steer the next phase (recorded with attribution in `gate-feedback/`), or `abort`.

### Non-interactive gating (for scripts and agent drivers)

```sh
mar run document.md --gated --pause-and-exit  # run to the first gate, then exit 0
mar resume --last --step                      # approve: run one more phase, pause again
mar resume --last --step --feedback "tighten section 3"  # approve with steering
mar resume --last --abort                     # end the paused run
mar resume <run-id>                           # resume to completion (no more pauses)
```

One `--step` normally runs one phase; the evaluation step carries through
integration in the same step (the convergence result must reach the integrator
in-process). A run whose convergence deadlocks ends with terminal status
`escalated` — it still produces a merged fallback document plus the open decision
in the decision record for a human to settle.

## GitHub PR review

`mar` can turn a GitHub pull request into a protocol input, run the full multi-agent
review loop, and write one unified review body:

```sh
mar pr review 42 --autonomous          # dry run: writes runs/<id>/github-review.md
mar pr review 42 --gated               # pause at phase gates before continuing
mar pr review https://github.com/org/repo/pull/42 --post --autonomous
```

The command uses the authenticated `gh` CLI to fetch PR metadata, changed files,
commits, and patch text. Without `--post`, nothing is sent to GitHub. With `--post`,
the final integration artifact is submitted with `gh pr review --comment --body-file`
after the run reaches a completed or escalated terminal state.

PR reviews are also repo-aware by default when the command runs from a checked-out
repository. The generated PR brief remains the shared review target, but draft
reviewers can inspect the full PR head tree from their own disposable worktrees.

The repository also includes a self-hosted GitHub Action,
`.github/workflows/mar-pr-review.yml`, that builds the CLI and runs the same command.
It runs automatically on same-repository pull requests when they are opened,
updated, reopened, or marked ready for review, and posts the unified review back to
the PR. Draft PRs are skipped until ready-for-review. The manual dispatch path stays
available for ad-hoc dry runs or explicit posts.

Use a self-hosted runner that already has authenticated vendor CLIs available on PATH;
GitHub-hosted runners do not satisfy the CLI-subscription constraint. The automatic
workflow intentionally uses `pull_request`, not `pull_request_target`, and ignores
forked PRs because it runs install/build scripts and local vendor CLIs on the runner.

### Tmux mode

MAR accepts a terminal backend setting:

```sh
mar run document.md --terminal-mode headless
mar run document.md --tmux
mar pr review 42 --tmux
```

`headless` is the default and fully implemented. `tmux` is currently a guarded
execution seam: MAR validates that tmux exists and then fails clearly because the
pane-backed reviewer runner is not implemented in this build. This keeps babysitter
agent integration explicit instead of silently running headless while claiming to use
tmux.

### Install in another repository

Target repositories can use this repository as a reusable composite action. The
easiest path is to run the installer from the target repo:

```sh
mar pr install-workflow
```

Useful variants:

```sh
mar pr install-workflow --repo /path/to/repo
mar pr install-workflow --runner-labels self-hosted,macOS,ARM64,mar
mar pr install-workflow --action-ref aaron-agent-corporation/multi-agent-review@main
mar pr install-workflow --force
```

The installer writes `.github/workflows/mar-pr-review.yml` and refuses to overwrite
an existing workflow unless `--force` is supplied.

The generated workflow is:

```yaml
name: MAR PR Review

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]
  workflow_dispatch:
    inputs:
      pr:
        description: Pull request number or URL to review
        required: true
        type: string
      post:
        description: Post the unified review back to GitHub
        required: true
        default: true
        type: boolean

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: mar-pr-review-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

jobs:
  review:
    name: Multi-agent PR review
    runs-on: self-hosted
    if: ${{ github.event_name != 'pull_request' || (!github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository) }}
    steps:
      - name: Resolve PR review mode
        shell: bash
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          DISPATCH_PR_SELECTOR: ${{ inputs.pr }}
          DISPATCH_POST: ${{ inputs.post }}
        run: |
          if [[ "$GITHUB_EVENT_NAME" == "pull_request" ]]; then
            printf 'PR_SELECTOR=%s\n' "$PR_URL" >> "$GITHUB_ENV"
            printf 'MAR_POST_REVIEW=true\n' >> "$GITHUB_ENV"
          else
            printf 'PR_SELECTOR=%s\n' "$DISPATCH_PR_SELECTOR" >> "$GITHUB_ENV"
            printf 'MAR_POST_REVIEW=%s\n' "$DISPATCH_POST" >> "$GITHUB_ENV"
          fi

      - name: Run MAR review
        uses: aaron-agent-corporation/multi-agent-review@main
        with:
          pr: ${{ env.PR_SELECTOR }}
          post: ${{ env.MAR_POST_REVIEW }}
          notify-webhook-url: ${{ secrets.MAR_NOTIFY_WEBHOOK_URL }}
          notify-webhook-token: ${{ secrets.MAR_NOTIFY_WEBHOOK_TOKEN }}
          github-token: ${{ github.token }}
```

The target workflow intentionally passes the PR URL rather than just the number.
The reusable action checks out the target repository, runs the MAR CLI from that
repository workspace, and loads the MAR action's bundled roster config. The action
posts a `MAR multi-agent review` commit status to the PR head commit: `pending`
while the review is running, then `success` or `failure` when the run finishes. If
the run fails, it also creates or updates a sticky PR comment with the workflow
link and operator next steps. `statuses: write` is required for the PR UI status,
and `issues: write` is required for the failure comment.

### PR completion notifications

The reusable action can notify an external relay after a MAR review completes. To
make the loop automatic for every PR review, configure the trusted workflow with a
relay URL/token. The target defaults to `default`; set `MAR_NOTIFY_TARGET` only when
your relay needs to route to a specific agent or channel:

```yaml
with:
  notify-webhook-url: ${{ secrets.MAR_NOTIFY_WEBHOOK_URL }}
  notify-webhook-token: ${{ secrets.MAR_NOTIFY_WEBHOOK_TOKEN }}
  notify-kind: ${{ vars.MAR_NOTIFY_KIND || 'claude-code-channel' }}
  notify-target: ${{ secrets.MAR_NOTIFY_TARGET || vars.MAR_NOTIFY_TARGET || 'default' }}
```

With a webhook URL and target available, MAR sends the completion payload for every
review. The PR body can still override the trusted default target for a specific PR:

```md
<!-- mar-notify-v1
kind: claude-code-channel
target: mar-relay:abc123
-->
```

For local coding agents, you can install a commit hook so new commits automatically
carry the same target even if the agent never edits the PR body:

```sh
mar pr notify-hook install --target mar-relay:abc123
```

The hook writes a `MAR-Notify` trailer to future commit messages:

```text
MAR-Notify: claude-code-channel mar-relay:abc123
```

On completion, MAR reads the PR body marker first. If that marker is absent, it reads
the PR head commit and uses the `MAR-Notify` trailer. If neither exists, it falls
back to the trusted `notify-kind`/`notify-target` values from workflow configuration.
Existing commits are not rewritten; after installing the hook, amend the latest
commit or add the PR body marker manually if the PR already exists and needs a
non-default target.

When `notify-webhook-url` and a target are set, MAR posts a compact JSON payload
containing the status, repository, PR URL, head SHA, run URL, status context,
notification `kind`, and notification `target`. Missing target or missing webhook
configuration are clean no-ops. Webhook delivery failures are warnings and do not
change the MAR review result.

For Claude Code running locally, point `MAR_NOTIFY_WEBHOOK_URL` at a relay that
forwards the payload into a Claude Code Channel. The channel receiver can either
listen on localhost behind a tunnel or poll a hosted relay. During the Claude Code
Channels research preview, a custom development channel is started with a command
like:

```sh
claude --dangerously-load-development-channels server:mar-webhook
```

A production relay should keep an allowlist of valid targets and should accept
events only from GitHub Actions using `MAR_NOTIFY_WEBHOOK_TOKEN`. If no channel is
running, MAR records only a warning and the PR review result is unchanged.

## The input document

The input is a single self-contained markdown file — the document you want
stress-tested. Each agent receives an isolated working folder containing exactly two
things: `input.md` (a copy of your document) and the seeded format-contract
instruction file. That is their entire universe — no repo context, no conversation
history, no global config. Each agent independently drafts its own treatment of
whatever `input.md` asks for, and those competing drafts are what enter cross-review.

Two ways to shape it, both supported (the protocol is generic over document type):

1. **A draft you already have** — a proposal, spec, architecture doc, or plan. The
   agents each produce their own improved version, and the adversarial loop surfaces
   what your draft missed. This is the common case.
2. **A brief / problem statement** — "Design X under these constraints…". The agents
   each draft a solution from scratch. This maximizes independence, since no one
   anchors on an existing draft.

Because agents see *only* this file, anything not in it does not exist for them.
Include the goal, the constraints that bound acceptable answers (budget, stack,
compliance — whatever applies), the content itself, and any facts they would
otherwise have to invent. Vague inputs produce confident-but-divergent drafts that
burn convergence rounds arguing about assumptions you could have pinned down in one
paragraph.

A workable shape, at whatever length the subject needs:

```markdown
# Proposal: <what this is>

## Summary        — what you're building / deciding and why
## Goals          — measurable outcomes that define success
## Proposed approach — the substance under review
## Constraints    — budget, timeline, stack, compliance, jurisdiction
## Risks / open questions — what you already suspect is weak
```

## Claude Code plugin

This repo is also a Claude Code plugin marketplace. Install:

```
claude plugin marketplace add The-Agent-Corporation/multi-agent-review
claude plugin install mar@multi-agent-review
```

Then, in any project, `/mar-review <document>` has Claude drive the whole loop:
preflight the roster, launch a gated run in the background, summarize each phase's
artifacts at every gate, relay your approve/feedback/abort decision, and deliver the
integrated document and decision-record digest at the end. The plugin is a thin
driver — all protocol logic stays in the `mar` CLI, so the coordination layer remains
vendor-neutral.

For GitHub automation setup, `/mar-install-pr-review [repo-path]` installs the
automatic PR review workflow into the current or specified repository and verifies
the resulting diff.

## Development

```sh
npm test        # vitest — hermetic; vendor CLIs are faked via fixtures
npm run dev     # run the CLI from source (tsx)
npm run lint    # biome
```

The protocol engine is an XState v5 statechart (`src/protocol/engine.ts`); per-vendor
adapters live in `src/adapters/`; artifact schemas (zod) in `src/schema/`. Vendor CLI
flag surfaces drift between minor versions — the adapter behavior is pinned by tests.

## License

MIT
