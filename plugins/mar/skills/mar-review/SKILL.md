---
name: mar-review
description: Use when the user wants an adversarial multi-model review of a document — runs the mar 6-phase protocol (independent drafts from Claude/Codex/Gemini CLIs, cross-review, responses, convergence, integration, validation), with Claude mediating each phase gate. Triggers on "multi-agent review", "adversarial review", "mar review", or "have the other models review this".
---

# mar-review: drive an adversarial multi-vendor document review

You are the **driver and gate reviewer** for a `mar` run. The protocol logic lives
entirely in the `mar` CLI — your job is to launch it, summarize what happened at each
pause, relay the user's decision, and deliver the final result. You never write review
artifacts yourself and you never paraphrase one agent's position to another outside
the recorded artifacts (independence is the product).

## 1. Resolve the CLI

Run `mar --version` (any exit-0 output means it resolves). If it does not resolve:

- If `MAR_HOME` is set, use `node "$MAR_HOME/dist/src/cli.js"` everywhere `mar`
  appears below (build first with `npm run build` in `$MAR_HOME` if `dist/` is missing).
- Otherwise tell the user how to install and stop:
  `git clone https://github.com/The-Agent-Corporation/multi-agent-review && cd multi-agent-review && npm install && npm run build && npm link`

## 2. Preflight

1. If the working directory has no `mar.config.json`, run `mar init`, show the user
   the detected roster, and ask them to confirm it before spending model invocations.
2. Run `mar preflight`. Show the status table. The protocol refuses to run with fewer
   than 2 distinct healthy vendors (same-vendor agents share blind spots — there is no
   override). If the roster is below the floor, report which agent failed and why
   (auth decay is the common cause, especially gemini) and stop.

## 3. Launch

Default (gated): run as a background task — phases take minutes each:

```
mar run <input-document> --gated --pause-and-exit
```

If the user asked for unattended mode, use `mar run <input> --autonomous` instead and
skip to step 5 when it exits.

Exit 0 with `paused-awaiting-approval` in `runs/<id>/manifest.json` means a phase
completed and the run is waiting at the gate. Non-zero exit: read the stderr tail and
the manifest's `status`/`failureReason`, report them, and offer `mar resume <id>`
(interrupted/failed runs are resumable; the engine re-validates the artifact trail).

## 4. Gate loop

At each pause:

1. Read `runs/<id>/manifest.json` for the run state, and read the artifacts the
   just-completed phase wrote (the `artifacts` array records path + kind + agent).
2. Digest for the user, briefly: what each agent produced; for review phases, the
   issues raised by severity; for evaluation, the convergence outcome (agreed base /
   majority / escalated) from the round artifacts.
3. Ask the user to choose: **approve**, **feedback** (with a note), or **abort**.
4. Relay:
   - approve → `mar resume <id> --step`
   - feedback → `mar resume <id> --step --feedback "<the user's note>"`
     (the note steers ONLY the next phase; it is recorded in `gate-feedback/`)
   - abort → `mar resume <id> --abort` (ends the run as `failed` with an attributed
     reason; nothing further runs)
5. Repeat until the manifest status is terminal: `completed`, `escalated`, `failed`,
   or `timeout`.

Notes on stepping granularity: one `--step` normally runs one phase, but the
evaluation step carries through integration in the same step (the convergence result
must reach the integrator in-process). So a typical gated run pauses after: draft,
review, response, integration. Phase order: draft → review → response → evaluation →
integration → validation.

## 5. Deliver

On `completed`: report the integrated document path (the final `integration` artifact
in the manifest), the validation outcomes, and the decision-record summary
(`runs/<id>/decision-record.md` — resolved decisions, unanimous tally, run chain).
Point the user at the run directory for the full artifact trail.

On `escalated`: the agents could not converge and no human ruling was collected
(non-interactive runs cannot prompt). The run still produced a merged fallback
artifact. Present each agent's final position from the decision record's open
decisions, then tell the user their options: accept the fallback integration as-is,
or re-run the review interactively (`mar run <input> --gated` in a terminal) to issue
a ruling at the arbitration prompt.

On `failed`/`timeout`: report `failureReason` and which agents (if any) were dropped
(`droppedAgents` in the manifest), and offer `mar resume <id>` — a failed-run resume
restores the full roster so dropped agents get another chance.

## Hard rules

- Never edit files under `runs/<id>/` — the artifact trail is the audit record.
- Never feed one agent's draft to another yourself; the protocol's workspace scoping
  exists precisely to prevent cross-contamination before the cross-review phase.
- Never start a review without a confirmed ≥2-vendor roster (the CLI enforces it; you
  surface it early).
- Gate feedback notes come from the user, not from you — relay them verbatim.
