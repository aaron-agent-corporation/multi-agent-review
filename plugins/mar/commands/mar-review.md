---
description: Run an adversarial multi-vendor review of a document via the mar 6-phase protocol, with gate mediation
argument-hint: <document-path> [--autonomous]
---

Run a multi-agent adversarial review of the document the user specified: $ARGUMENTS

Use the `mar-review` skill (from this plugin) and follow it exactly: resolve the
`mar` CLI, preflight the roster, launch the run gated with `--pause-and-exit` as a
background task (or `--autonomous` if the arguments include it), mediate each phase
gate with the user, and deliver the final digest with the integrated document path
and decision record.

If no document path was provided, ask the user which document to review before
starting anything.
