import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetGhRunner, setGhRunner } from "../src/github/gh.js";
import { postPullRequestReview, writeUnifiedReview } from "../src/github/publish.js";

let runDir: string;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "mar-publish-"));
});

afterEach(() => {
  resetGhRunner();
  rmSync(runDir, { recursive: true, force: true });
});

function writeSyntheticIntegration(): void {
  writeFileSync(
    join(runDir, "manifest.json"),
    `${JSON.stringify(
      {
        runId: "20260621-test",
        status: "completed",
        createdAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:00:00.000Z",
        cliVersions: {},
        droppedAgents: [],
        artifacts: [
          {
            path: "007-claude-integration.md",
            agent: "claude",
            seq: 7,
            kind: "integration",
            createdAt: "2026-06-21T00:00:00.000Z",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(runDir, "007-claude-integration.md"),
    `---
agent: "claude"
seq: 7
kind: "integration"
timestamp: "2026-06-21T00:00:00.000Z"
runId: "20260621-test"
phase: "integration"
---

---
phase: integration
author: claude
base: claude
additions:
  - verdict: merged
    additionRef: issue-1
---

# Unified PR Review

- Fix the parser edge case.
`,
  );
}

describe("GitHub review publishing", () => {
  it("writes the integrated review body to github-review.md", async () => {
    writeSyntheticIntegration();

    const result = await writeUnifiedReview(runDir);

    expect(result.path).toBe(join(runDir, "github-review.md"));
    expect(readFileSync(result.path, "utf8")).toBe(
      "# Unified PR Review\n\n- Fix the parser edge case.\n",
    );
    expect(result.body).toContain("Fix the parser edge case");
  });

  it("posts the unified review through gh pr review", async () => {
    const calls: string[][] = [];
    setGhRunner(async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await postPullRequestReview("42", join(runDir, "github-review.md"));

    expect(calls).toEqual([
      ["pr", "review", "42", "--comment", "--body-file", join(runDir, "github-review.md")],
    ]);
  });
});
