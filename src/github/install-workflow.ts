import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface InstallPrReviewWorkflowOptions {
  repo?: string;
  force?: boolean;
  actionRef?: string;
  runnerLabels?: string;
}

export interface InstallPrReviewWorkflowResult {
  workflowPath: string;
  overwritten: boolean;
}

const DEFAULT_ACTION_REF = "aaron-agent-corporation/multi-agent-review@main";
const DEFAULT_RUNNER_LABELS = "self-hosted";

function cleanScalar(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${name} cannot be empty`);
  if (/[\r\n]/.test(trimmed)) throw new Error(`${name} cannot contain newlines`);
  return trimmed;
}

function parseRunnerLabels(value: string): string[] {
  return cleanScalar("runner labels", value)
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

function yamlRunsOn(labels: string[]): string {
  if (labels.length === 0) throw new Error("runner labels cannot be empty");
  if (labels.length === 1 && /^[A-Za-z0-9_-]+$/.test(labels[0])) return labels[0];
  return `[${labels.map((label) => JSON.stringify(label)).join(", ")}]`;
}

export function prReviewWorkflowYaml(opts: InstallPrReviewWorkflowOptions = {}): string {
  const actionRef = cleanScalar("action ref", opts.actionRef ?? DEFAULT_ACTION_REF);
  const labels = parseRunnerLabels(opts.runnerLabels ?? DEFAULT_RUNNER_LABELS);
  const runsOn = yamlRunsOn(labels);

  return `name: MAR PR Review

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
  group: mar-pr-review-\${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

jobs:
  review:
    name: Multi-agent PR review
    runs-on: ${runsOn}
    if: \${{ github.event_name != 'pull_request' || (!github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository) }}
    steps:
      - name: Resolve PR review mode
        shell: bash
        env:
          PR_URL: \${{ github.event.pull_request.html_url }}
          DISPATCH_PR_SELECTOR: \${{ inputs.pr }}
          DISPATCH_POST: \${{ inputs.post }}
        run: |
          if [[ "$GITHUB_EVENT_NAME" == "pull_request" ]]; then
            printf 'PR_SELECTOR=%s\\n' "$PR_URL" >> "$GITHUB_ENV"
            printf 'MAR_POST_REVIEW=true\\n' >> "$GITHUB_ENV"
          else
            printf 'PR_SELECTOR=%s\\n' "$DISPATCH_PR_SELECTOR" >> "$GITHUB_ENV"
            printf 'MAR_POST_REVIEW=%s\\n' "$DISPATCH_POST" >> "$GITHUB_ENV"
          fi

      - name: Run MAR review
        uses: ${actionRef}
        with:
          pr: \${{ env.PR_SELECTOR }}
          post: \${{ env.MAR_POST_REVIEW }}
          notify-webhook-url: \${{ secrets.MAR_NOTIFY_WEBHOOK_URL }}
          notify-webhook-token: \${{ secrets.MAR_NOTIFY_WEBHOOK_TOKEN }}
          github-token: \${{ github.token }}
`;
}

export async function installPrReviewWorkflow(
  opts: InstallPrReviewWorkflowOptions = {},
): Promise<InstallPrReviewWorkflowResult> {
  const repo = resolve(opts.repo ?? ".");
  if (!existsSync(repo) || !statSync(repo).isDirectory()) {
    throw new Error(`repository path does not exist or is not a directory: ${repo}`);
  }

  const workflowPath = join(repo, ".github", "workflows", "mar-pr-review.yml");
  const overwritten = existsSync(workflowPath);
  if (overwritten && !opts.force) {
    throw new Error(`workflow already exists: ${workflowPath} (pass --force to overwrite)`);
  }

  await mkdir(join(repo, ".github", "workflows"), { recursive: true });
  await writeFile(workflowPath, prReviewWorkflowYaml(opts), "utf8");
  return { workflowPath, overwritten };
}
