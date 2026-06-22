import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const actionPath = "action.yml";
const workflowPath = join(".github", "workflows", "mar-pr-review.yml");

describe("GitHub Action PR review wrapper", () => {
  it("exposes a composite action that target repositories can call", () => {
    expect(existsSync(actionPath)).toBe(true);
    const action = readFileSync(actionPath, "utf8");

    expect(action).toContain("using: composite");
    expect(action).toContain("pr:");
    expect(action).toContain("github-token:");
    expect(action).toContain("working-directory: $" + "{{ github.action_path }}");
    expect(action).toContain("npm ci");
    expect(action).toContain("npm run build");
    expect(action).toContain("node dist/src/cli.js preflight");
    expect(action).toContain('node dist/src/cli.js "$' + '{args[@]}"');
    expect(action).toContain("GH_TOKEN: $" + "{{ inputs.github-token }}");
  });

  it("is an automatic and manual self-hosted wrapper around the built mar CLI", () => {
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("types: [opened, reopened, synchronize, ready_for_review]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pr:");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("runs-on: self-hosted");
    expect(workflow).toContain("!github.event.pull_request.draft");
    expect(workflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(workflow).toContain("Resolve PR review mode");
    expect(workflow).toContain("MAR_POST_REVIEW=true");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain('node dist/src/cli.js pr review "$PR_SELECTOR" --autonomous');
    expect(workflow).toContain('node dist/src/cli.js pr review "$PR_SELECTOR" --post --autonomous');
    expect(workflow).toContain("GH_TOKEN: $" + "{{ github.token }}");
  });
});
