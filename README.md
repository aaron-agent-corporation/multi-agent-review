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
mar preflight   # check each roster agent is installed, authenticated, responsive
mar run document.md --gated      # run the protocol, pausing at each phase gate
mar run document.md --autonomous # run unattended end to end
```

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

### Install in another repository

Target repositories can use this repository as a reusable composite action. Add this
workflow to the target repo as `.github/workflows/mar-pr-review.yml`:

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
          github-token: ${{ github.token }}
```

The target workflow intentionally passes the PR URL rather than just the number, so
the action can run from the MAR checkout while reviewing the target repository.
The action posts a `MAR multi-agent review` commit status to the PR head commit:
`pending` while the review is running, then `success` or `failure` when the run
finishes. If the run fails, it also creates or updates a sticky PR comment with
the workflow link and operator next steps. `statuses: write` is required for the
PR UI status, and `issues: write` is required for the failure comment.

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
