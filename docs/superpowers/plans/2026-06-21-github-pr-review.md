# GitHub PR Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI-first GitHub PR review mode that runs the existing multi-agent protocol on PR context and optionally posts the unified review back to GitHub.

**Architecture:** Add a GitHub input/output layer around the existing protocol engine. `gh` supplies PR context, the existing six-phase engine performs adversarial convergence, and a publisher extracts the integration artifact into a GitHub review body.

**Tech Stack:** TypeScript, Node 22, execa, zod, commander, vitest, existing fake vendor CLI fixtures.

---

### Task 1: GitHub Subprocess Seam

**Files:**
- Create: `src/github/gh.ts`
- Test: `test/github-gh.test.ts`

- [ ] **Step 1: Write tests for injectable `gh` execution**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { ghJson, ghText, resetGhRunner, setGhRunner } from "../src/github/gh.js";

afterEach(() => resetGhRunner());

describe("gh wrapper", () => {
  it("parses JSON output from the injected gh runner", async () => {
    const calls: string[][] = [];
    setGhRunner(async (args) => {
      calls.push(args);
      return { stdout: "{\"ok\":true}", stderr: "", exitCode: 0 };
    });

    await expect(ghJson(["pr", "view", "7"])).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["pr", "view", "7"]]);
  });

  it("throws a useful error when gh exits non-zero", async () => {
    setGhRunner(async () => ({ stdout: "", stderr: "not authenticated", exitCode: 1 }));

    await expect(ghText(["pr", "diff", "7"])).rejects.toThrow("gh pr diff 7 failed");
    await expect(ghText(["pr", "diff", "7"])).rejects.toThrow("not authenticated");
  });
});
```

- [ ] **Step 2: Implement `src/github/gh.ts`**

Implement `GhRunner`, `setGhRunner`, `resetGhRunner`, `ghText`, and `ghJson`. The default runner should spawn `process.env.MAR_GH_BIN ?? "gh"` with `execa`, `reject:false`, `stdin:"ignore"`, and argv arrays only.

- [ ] **Step 3: Run the focused test**

Run: `npm test -- test/github-gh.test.ts`

Expected: PASS.

### Task 2: PR Context Brief

**Files:**
- Create: `src/github/pr-context.ts`
- Test: `test/pr-context.test.ts`

- [ ] **Step 1: Write tests for fetching and rendering a PR brief**

Cover: expected `gh pr view` fields, `gh pr diff --patch`, metadata rendering, changed-file rendering, and bounded diff truncation.

- [ ] **Step 2: Implement `fetchPullRequestContext` and `renderPullRequestBrief`**

Use zod to validate the subset of `gh pr view --json` fields consumed by the brief. Render a markdown document that instructs agents to produce a GitHub-ready PR review.

- [ ] **Step 3: Run the focused test**

Run: `npm test -- test/pr-context.test.ts`

Expected: PASS.

### Task 3: Unified Review Extraction and Posting

**Files:**
- Create: `src/github/publish.ts`
- Test: `test/github-publish.test.ts`

- [ ] **Step 1: Write tests for integration-body extraction**

Create a synthetic run manifest and wrapped integration artifact, then assert `writeUnifiedReview` writes `runs/<id>/github-review.md` containing only the integrated review body.

- [ ] **Step 2: Write a post test**

Inject a fake `gh` runner and assert `postPullRequestReview` calls `["pr","review",selector,"--comment","--body-file",path]`.

- [ ] **Step 3: Implement extraction and posting**

Read the manifest, select the newest integration artifact, strip the engine wrapper plus agent frontmatter, write `github-review.md`, and optionally submit it with `gh pr review`.

### Task 4: PR Review Orchestrator and CLI

**Files:**
- Create: `src/pr-review.ts`
- Modify: `src/cli.ts`
- Test: `test/pr-review.test.ts`

- [ ] **Step 1: Write an end-to-end local PR review test**

Use fake `gh` output and existing fake agents. Assert the command creates one run, stores the generated PR brief as the manifest input, completes the protocol, and writes `github-review.md`.

- [ ] **Step 2: Implement `runPullRequestReview`**

Fetch PR context, create `runs/<id>/input/pr-review.md`, create the manifest with that input path, call `runProtocol`, and write/post the unified review only for terminal completed/escalated runs.

- [ ] **Step 3: Add `mar pr review` to `src/cli.ts`**

Add a nested `pr review` command with `--post`, `--mode`, `--gated`, `--autonomous`, and `--pause-and-exit`. Reuse config loading, `assertReviewable`, and `resolveGating`.

### Task 5: Docs and Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the command**

Add a short GitHub PR Review section with dry-run and post examples.

- [ ] **Step 2: Run verification**

Run:

```sh
npm test -- test/github-gh.test.ts test/pr-context.test.ts test/github-publish.test.ts test/pr-review.test.ts
npm run build
npm run lint
```

Expected: all commands pass.

