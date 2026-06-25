import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertTerminalModeSupported, type TerminalMode } from "./execution/tmux.js";
import { fetchPullRequestContext, renderPullRequestBrief } from "./github/pr-context.js";
import { postPullRequestReview, writeUnifiedReview } from "./github/publish.js";
import type { GatingOptions } from "./protocol/engine.js";
import { runProtocol } from "./protocol/engine.js";
import { detectGitRepo } from "./repo/git.js";
import type { MarConfig } from "./schema/config.js";
import { TERMINAL_DONE } from "./schema/manifest.js";
import { newRunId, runDir as runDirFor } from "./workspace/layout.js";
import { createRun, readManifest } from "./workspace/manifest.js";

export interface PullRequestReviewOptions {
  config: MarConfig;
  gating?: GatingOptions;
  post?: boolean;
  cwd?: string;
  maxDiffBytes?: number;
  env?: Record<string, string>;
  terminalMode?: TerminalMode;
}

const MAX_GENERATED_INPUT_BYTES = 10 * 1024 * 1024;

function assertGeneratedInputFits(text: string): void {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_GENERATED_INPUT_BYTES) {
    throw new Error(
      `generated PR review brief is ${bytes} bytes, exceeds the ${MAX_GENERATED_INPUT_BYTES}-byte cap`,
    );
  }
}

export async function runPullRequestReview(
  selector: string,
  opts: PullRequestReviewOptions,
): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const context = await fetchPullRequestContext(selector, {
    cwd,
    maxDiffBytes: opts.maxDiffBytes,
  });
  const brief = renderPullRequestBrief(context, { maxDiffBytes: opts.maxDiffBytes });
  assertGeneratedInputFits(brief);

  const runId = newRunId();
  const runDir = join(cwd, runDirFor(runId));
  const repo = await detectGitRepo(cwd);
  const terminalMode = opts.terminalMode ?? "headless";
  const tmux = await assertTerminalModeSupported(terminalMode, runId);
  const inputDir = join(runDir, "input");
  const inputPath = join(inputDir, "pr-review.md");
  await mkdir(inputDir, { recursive: true });
  await writeFile(inputPath, brief, "utf8");
  await createRun({
    runDir,
    runId,
    status: "running",
    inputPath,
    execution: {
      repoAware: repo !== undefined,
      ...(repo ? { sourceRepoRoot: repo.root, sourceCommit: repo.commit } : {}),
      terminalMode,
      ...tmux,
      worktrees: [],
    },
  });

  const code = await runProtocol(runDir, opts.config, inputPath, opts.gating, {
    env: opts.env ?? {},
    terminalMode,
    ...(repo ? { repoAware: { sourceRepoRoot: repo.root, sourceCommit: repo.commit } } : {}),
  });
  const manifest = await readManifest(runDir);
  if (code !== 0 || !(TERMINAL_DONE as readonly string[]).includes(manifest.status)) {
    return code;
  }

  const review = await writeUnifiedReview(runDir);
  process.stdout.write(`✓ unified PR review written to ${review.path}\n`);
  if (opts.post) {
    await postPullRequestReview(selector, review.path, { cwd });
    process.stdout.write(`✓ posted unified PR review to ${context.pr.url}\n`);
  }
  return code;
}
