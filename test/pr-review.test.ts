import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetGhRunner, setGhRunner } from "../src/github/gh.js";
import { runPullRequestReview } from "../src/pr-review.js";
import { MarConfig } from "../src/schema/config.js";

vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");

let workdir: string;
let previousBase: string | undefined;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-pr-review-"));
  previousBase = process.env.MAR_EMIT_BASE;
  process.env.MAR_EMIT_BASE = "claude";
});

afterEach(() => {
  resetGhRunner();
  if (previousBase === undefined) delete process.env.MAR_EMIT_BASE;
  else process.env.MAR_EMIT_BASE = previousBase;
  rmSync(workdir, { recursive: true, force: true });
});

describe("runPullRequestReview", () => {
  it("runs a PR through the protocol and writes a unified local review", async () => {
    setGhRunner(async (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
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
            changedFiles: 1,
            commits: [{ oid: "abc123", messageHeadline: "feat: handle brackets" }],
            files: [{ path: "src/parser.ts", additions: 12, deletions: 3, changeType: "modified" }],
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "pr" && args[1] === "diff") {
        return {
          stdout: "diff --git a/src/parser.ts b/src/parser.ts\n+const ok = true;\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: `unexpected gh call: ${args.join(" ")}`, exitCode: 1 };
    });

    const config = MarConfig.parse({
      agents: [
        { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
        { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
      ],
    });

    const code = await runPullRequestReview("42", {
      config,
      gating: { mode: "autonomous", pauseAndExit: false },
      cwd: workdir,
      post: false,
    });

    expect(code).toBe(0);
    const runsDir = join(workdir, "runs");
    const runIds = readdirSync(runsDir);
    expect(runIds).toHaveLength(1);
    const runDir = join(runsDir, runIds[0]);
    const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
    expect(manifest.status).toBe("completed");
    expect(manifest.inputPath).toBe(join(runDir, "input", "pr-review.md"));
    expect(readFileSync(manifest.inputPath, "utf8")).toContain("Improve widget parser");
    expect(existsSync(join(runDir, "github-review.md"))).toBe(true);
    expect(readFileSync(join(runDir, "github-review.md"), "utf8")).toContain(
      "Merged the agreed addition",
    );
  });

  it("posts after completion when requested", async () => {
    const calls: string[][] = [];
    setGhRunner(async (args) => {
      calls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 42,
            url: "https://github.com/acme/widgets/pull/42",
            title: "Improve widget parser",
            author: { login: "octocat" },
            baseRefName: "main",
            headRefName: "parser-fix",
            state: "OPEN",
            isDraft: false,
            additions: 1,
            deletions: 0,
            changedFiles: 1,
            commits: [],
            files: [{ path: "src/parser.ts", additions: 1, deletions: 0, changeType: "modified" }],
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "pr" && args[1] === "diff") {
        return {
          stdout: "diff --git a/src/parser.ts b/src/parser.ts\n+ok\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "pr" && args[1] === "review") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: `unexpected gh call: ${args.join(" ")}`, exitCode: 1 };
    });

    const config = MarConfig.parse({
      agents: [
        { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
        { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
      ],
    });

    const code = await runPullRequestReview("42", {
      config,
      gating: { mode: "autonomous", pauseAndExit: false },
      cwd: workdir,
      post: true,
    });

    expect(code).toBe(0);
    expect(calls.some((args) => args[0] === "pr" && args[1] === "review")).toBe(true);
    const reviewCall = calls.find((args) => args[0] === "pr" && args[1] === "review");
    expect(reviewCall?.slice(0, 5)).toEqual(["pr", "review", "42", "--comment", "--body-file"]);
  });
});
