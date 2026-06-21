import { afterEach, describe, expect, it } from "vitest";
import { resetGhRunner, setGhRunner } from "../src/github/gh.js";
import { fetchPullRequestContext, renderPullRequestBrief } from "../src/github/pr-context.js";

afterEach(() => {
  resetGhRunner();
});

const PR_JSON = {
  number: 42,
  url: "https://github.com/acme/widgets/pull/42",
  title: "Improve widget parser",
  body: "Adds bracket handling.",
  author: { login: "octocat" },
  baseRefName: "main",
  headRefName: "parser-fix",
  state: "OPEN",
  isDraft: false,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  commits: [
    {
      oid: "abc123456789",
      messageHeadline: "feat: handle brackets",
      committedDate: "2026-06-21T12:00:00Z",
    },
  ],
  files: [
    { path: "src/parser.ts", additions: 10, deletions: 2, changeType: "modified" },
    { path: "test/parser.test.ts", additions: 2, deletions: 1, changeType: "modified" },
  ],
};

describe("PR context", () => {
  it("fetches PR metadata and patch through gh", async () => {
    const calls: string[][] = [];
    setGhRunner(async (args) => {
      calls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return { stdout: JSON.stringify(PR_JSON), stderr: "", exitCode: 0 };
      }
      if (args[0] === "pr" && args[1] === "diff") {
        return {
          stdout: "diff --git a/src/parser.ts b/src/parser.ts\n+const ok = true;\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "unexpected call", exitCode: 1 };
    });

    const context = await fetchPullRequestContext("42");

    expect(context.pr.title).toBe("Improve widget parser");
    expect(context.diff).toContain("diff --git");
    expect(calls[0]).toEqual([
      "pr",
      "view",
      "42",
      "--json",
      "number,url,title,body,author,baseRefName,headRefName,state,isDraft,additions,deletions,changedFiles,commits,files",
    ]);
    expect(calls[1]).toEqual(["pr", "diff", "42", "--patch"]);
  });

  it("renders a self-contained PR review brief", () => {
    const brief = renderPullRequestBrief({
      selector: "42",
      pr: PR_JSON,
      diff: "diff --git a/src/parser.ts b/src/parser.ts\n+const ok = true;\n",
      diffTruncated: false,
    });

    expect(brief).toContain("# Pull Request Review Brief");
    expect(brief).toContain("Improve widget parser");
    expect(brief).toContain("octocat");
    expect(brief).toContain("src/parser.ts");
    expect(brief).toContain("GitHub-ready PR review");
    expect(brief).toContain("```diff");
    expect(brief).toContain("+const ok = true;");
  });

  it("marks the diff when the patch is truncated", () => {
    const brief = renderPullRequestBrief(
      {
        selector: "42",
        pr: PR_JSON,
        diff: "a".repeat(200),
        diffTruncated: false,
      },
      { maxDiffBytes: 20 },
    );

    expect(brief).toContain("Diff truncated");
    expect(brief).toContain("a".repeat(20));
  });
});
