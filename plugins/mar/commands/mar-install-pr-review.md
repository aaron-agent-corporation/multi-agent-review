---
description: Install the MAR automatic PR review GitHub Actions workflow into the current or specified repository
argument-hint: "[repo-path] [--force] [--action-ref <owner/repo@ref>] [--runner-labels <comma-labels>]"
---

Install MAR automatic PR reviews in the repository the user specified: $ARGUMENTS

Use the `mar-install-pr-review` skill from this plugin. Resolve the `mar` CLI, run
`mar pr install-workflow` with the supplied arguments, show the changed workflow path,
and verify the resulting diff. If no repository path was provided, default to the
current working directory.
