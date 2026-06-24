import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installPrepareCommitMessageNotificationHook } from "../src/git/notify-hook.js";

let workdir = "";

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = "";
});

describe("MAR notification commit hook", () => {
  it("installs a prepare-commit-msg hook that appends a MAR-Notify trailer", () => {
    workdir = mkdtempSync(join(tmpdir(), "mar-notify-hook-"));
    const gitDir = join(workdir, ".git");
    const result = installPrepareCommitMessageNotificationHook({
      gitDir,
      kind: "claude-code-channel",
      target: "mar-relay:abc123",
    });

    expect(result.hookPath).toBe(join(gitDir, "hooks", "prepare-commit-msg"));
    expect(statSync(result.hookPath).mode & 0o111).not.toBe(0);

    const messagePath = join(workdir, "COMMIT_EDITMSG");
    writeFileSync(messagePath, "feat: add parser\n", "utf8");

    execFileSync(result.hookPath, [messagePath]);
    execFileSync(result.hookPath, [messagePath]);

    const message = readFileSync(messagePath, "utf8");
    expect(message).toContain("MAR-Notify: claude-code-channel mar-relay:abc123");
    expect(message.match(/^MAR-Notify:/gm)).toHaveLength(1);
  });

  it("resolves a gitfile to the real git directory before installing", () => {
    workdir = mkdtempSync(join(tmpdir(), "mar-notify-hook-worktree-"));
    const actualGitDir = join(workdir, "actual-git-dir");
    mkdirSync(actualGitDir, { recursive: true });
    const gitFile = join(workdir, ".git");
    writeFileSync(gitFile, `gitdir: ${actualGitDir}\n`, "utf8");

    const result = installPrepareCommitMessageNotificationHook({
      gitDir: gitFile,
      kind: "claude-code-channel",
      target: "mar-relay:worktree",
    });

    expect(result.hookPath).toBe(join(actualGitDir, "hooks", "prepare-commit-msg"));
    expect(readFileSync(result.hookPath, "utf8")).toContain("mar-relay:worktree");
  });
});
