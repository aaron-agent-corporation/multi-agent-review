import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPrReviewWorkflow, prReviewWorkflowYaml } from "../src/github/install-workflow.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mar-install-workflow-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("installPrReviewWorkflow", () => {
  it("writes the automatic PR review workflow into a target repository", async () => {
    const result = await installPrReviewWorkflow({ repo });

    expect(result.overwritten).toBe(false);
    expect(result.workflowPath).toBe(join(repo, ".github", "workflows", "mar-pr-review.yml"));
    expect(existsSync(result.workflowPath)).toBe(true);

    const workflow = readFileSync(result.workflowPath, "utf8");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("types: [opened, reopened, synchronize, ready_for_review]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("statuses: write");
    expect(workflow).toContain("runs-on: self-hosted");
    expect(workflow).toContain("uses: aaron-agent-corporation/multi-agent-review@main");
    expect(workflow).toContain("MAR_POST_REVIEW=true");
    expect(workflow).toContain("notify-webhook-url: $" + "{{ secrets.MAR_NOTIFY_WEBHOOK_URL }}");
    expect(workflow).toContain(
      "notify-target: $" + "{{ secrets.MAR_NOTIFY_TARGET || vars.MAR_NOTIFY_TARGET || 'default' }}",
    );
    expect(workflow).toContain("github-token: $" + "{{ github.token }}");
  });

  it("refuses to overwrite an existing workflow unless force is set", async () => {
    const first = await installPrReviewWorkflow({ repo });
    await expect(installPrReviewWorkflow({ repo })).rejects.toThrow("pass --force");

    writeFileSync(first.workflowPath, "old workflow\n", "utf8");
    const second = await installPrReviewWorkflow({ repo, force: true });
    expect(second.overwritten).toBe(true);
    expect(readFileSync(second.workflowPath, "utf8")).toContain("MAR PR Review");
  });

  it("supports a pinned action ref and explicit runner labels", () => {
    const workflow = prReviewWorkflowYaml({
      actionRef: "The-Agent-Corporation/multi-agent-review@v1",
      runnerLabels: "self-hosted,macOS,ARM64,mar",
    });

    expect(workflow).toContain('runs-on: ["self-hosted", "macOS", "ARM64", "mar"]');
    expect(workflow).toContain("uses: The-Agent-Corporation/multi-agent-review@v1");
  });

  it("rejects unsafe scalar values", () => {
    expect(() => prReviewWorkflowYaml({ actionRef: "owner/repo@main\nbad: true" })).toThrow(
      "action ref cannot contain newlines",
    );
    expect(() => prReviewWorkflowYaml({ runnerLabels: " \n" })).toThrow(
      "runner labels cannot be empty",
    );
  });
});
