import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(".github", "workflows", "mar-pr-review.yml");

describe("GitHub Action PR review wrapper", () => {
  it("is a thin self-hosted wrapper around the built mar CLI", () => {
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pr:");
    expect(workflow).toContain("runs-on: self-hosted");
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain('node dist/src/cli.js pr review "$PR_SELECTOR" --autonomous');
    expect(workflow).toContain('node dist/src/cli.js pr review "$PR_SELECTOR" --post --autonomous');
    expect(workflow).toContain("GH_TOKEN: $" + "{{ github.token }}");
  });
});
