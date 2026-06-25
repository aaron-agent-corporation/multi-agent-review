import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execa } from "execa";

const AGENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

export interface GitRepoInfo {
  root: string;
  commit: string;
}

export interface AgentWorktree {
  agent: string;
  path: string;
}

function assertSafeAgent(agent: string): void {
  if (!AGENT_NAME_RE.test(agent)) {
    throw new Error(`unsafe agent name "${agent}": must match ${AGENT_NAME_RE}`);
  }
}

export async function detectGitRepo(cwd = process.cwd()): Promise<GitRepoInfo | undefined> {
  const root = await execa("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    reject: false,
    stdin: "ignore",
  });
  if (root.exitCode !== 0 || root.stdout.trim().length === 0) return undefined;

  const commit = await execa("git", ["-C", root.stdout.trim(), "rev-parse", "HEAD"], {
    reject: false,
    stdin: "ignore",
  });
  if (commit.exitCode !== 0 || commit.stdout.trim().length === 0) return undefined;

  return { root: resolve(root.stdout.trim()), commit: commit.stdout.trim() };
}

export function agentWorktreePath(runDir: string, agent: string): string {
  assertSafeAgent(agent);
  return resolve(join(runDir, "worktrees", agent));
}

export async function createAgentWorktree(opts: {
  repoRoot: string;
  commit: string;
  runDir: string;
  agent: string;
}): Promise<AgentWorktree> {
  const path = agentWorktreePath(opts.runDir, opts.agent);
  await mkdir(dirname(path), { recursive: true });
  const result = await execa(
    "git",
    ["-C", opts.repoRoot, "worktree", "add", "--detach", path, opts.commit],
    {
      reject: false,
      stdin: "ignore",
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `git worktree add failed for ${opts.agent}: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
  return { agent: opts.agent, path };
}

export async function removeAgentWorktree(opts: { repoRoot: string; path: string }): Promise<void> {
  await execa("git", ["-C", opts.repoRoot, "worktree", "remove", "--force", opts.path], {
    reject: false,
    stdin: "ignore",
  });
}
