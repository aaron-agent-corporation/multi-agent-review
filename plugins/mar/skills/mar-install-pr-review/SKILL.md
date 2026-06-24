---
name: mar-install-pr-review
description: Use when the user wants to add MAR automatic GitHub pull request reviews to a repository. Installs the reusable GitHub Actions workflow that calls aaron-agent-corporation/multi-agent-review.
---

# mar-install-pr-review: add automatic MAR PR reviews to a repo

You are installing the MAR GitHub Actions workflow into a target repository. The
workflow uses the reusable `multi-agent-review` composite action; do not hand-write
or improvise the YAML unless the CLI installer is unavailable.

## 1. Resolve the target repo

- If the user gave a path, use it as `--repo <path>`.
- If no path was given, use the current working directory.
- Confirm the directory is the intended GitHub repository before changing files when
  there is any ambiguity.

## 2. Resolve the CLI

Run `mar --help`. If it does not resolve:

- If `MAR_HOME` is set, use `node "$MAR_HOME/dist/src/cli.js"` everywhere `mar`
  appears below; build first with `npm run build` in `$MAR_HOME` if `dist/` is
  missing.
- Otherwise tell the user how to install and stop:
  `git clone https://github.com/The-Agent-Corporation/multi-agent-review && cd multi-agent-review && npm install && npm run build && npm link`

## 3. Install the workflow

Default command:

```sh
mar pr install-workflow --repo <target-repo>
```

Useful options:

```sh
mar pr install-workflow --repo <target-repo> --runner-labels self-hosted,macOS,ARM64,mar
mar pr install-workflow --repo <target-repo> --action-ref aaron-agent-corporation/multi-agent-review@main
mar pr install-workflow --repo <target-repo> --force
```

Only pass `--force` if the user explicitly asked to replace an existing
`.github/workflows/mar-pr-review.yml` or after showing them that the file already
exists.

## 4. Verify and report

After installation:

1. Run `git diff -- .github/workflows/mar-pr-review.yml` in the target repo.
2. Confirm the workflow includes:
   - `pull_request` for opened, reopened, synchronize, and ready-for-review;
   - `permissions` for `contents: read`, `issues: write`, `pull-requests: write`,
     and `statuses: write`;
   - `runs-on` matching the intended self-hosted runner labels;
   - `uses: aaron-agent-corporation/multi-agent-review@main` unless the user pinned
     another ref.
3. Tell the user the follow-up operational checks:
   - self-hosted runner is online for that repo;
   - vendor CLIs are authenticated on that runner;
   - optional `MAR_NOTIFY_WEBHOOK_URL` and `MAR_NOTIFY_WEBHOOK_TOKEN` secrets are set
     if they want completion notifications.

## Hard rules

- Do not use `pull_request_target`; MAR runs local vendor CLIs and project scripts.
- Do not add repository secrets yourself unless the user separately asks and approves
  the exact secret setup.
- Do not overwrite an existing workflow without explicit user approval.
