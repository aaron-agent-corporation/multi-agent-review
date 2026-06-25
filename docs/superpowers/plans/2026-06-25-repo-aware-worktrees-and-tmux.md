# Repo-Aware Worktrees and Tmux Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MAR repo-aware by default inside git repositories, load repo-local MAR credentials, and add a tmux execution planning seam.

**Architecture:** Add focused modules for repo detection/worktree lifecycle, MAR.env loading, and tmux session planning. Thread execution context through the existing protocol/adapters so the draft phase can run from per-agent worktrees while the protocol workspace remains the source of truth.

**Tech Stack:** TypeScript, Node 22, execa, zod, vitest, git CLI, optional tmux CLI.

---

### Task 1: Repo And MAR.env Foundations

**Files:**
- Create: `src/env/mar-env.ts`
- Create: `src/repo/git.ts`
- Modify: `src/schema/manifest.ts`
- Modify: `src/workspace/manifest.ts`
- Test: `test/mar-env.test.ts`
- Test: `test/repo-git.test.ts`

- [ ] **Step 1: Add failing tests for MAR.env parsing and gitignore behavior**

Create tests that write `.mar/MAR.env`, assert key/value parsing without logging values, assert comments and blank lines are ignored, assert malformed lines fail, and assert `.mar/MAR.env` is appended to `.gitignore`.

- [ ] **Step 2: Implement `src/env/mar-env.ts`**

Implement `parseMarEnv`, `loadMarEnv`, `mergeEnv`, `ensureMarEnv`, and `redactedEnvReport`. Use plain `KEY=value` parsing, reject invalid names, never echo values, create `.mar/MAR.env.example`, create `.mar/MAR.env` with mode `0600`, and update `.gitignore`.

- [ ] **Step 3: Add failing tests for git repo detection and worktree command planning**

Create temporary git repositories, commit a file, assert detection returns root and head SHA, assert non-git directories return document-only mode, and assert generated worktree paths are under `runs/<run-id>/worktrees/<agent>`.

- [ ] **Step 4: Implement `src/repo/git.ts`**

Implement `detectGitRepo`, `resolveHeadCommit`, `createAgentWorktree`, `removeAgentWorktree`, and agent path validation. Use `execa` with argv arrays only.

- [ ] **Step 5: Extend manifest metadata**

Add optional `execution` metadata with repo-aware state, source repo root, source commit, terminal mode, tmux session, and per-agent worktree paths. Preserve compatibility with existing manifests.

### Task 2: Protocol And Adapter Plumbing

**Files:**
- Modify: `src/adapters/adapter.ts`
- Modify: `src/adapters/claude.ts`
- Modify: `src/adapters/codex.ts`
- Modify: `src/adapters/gemini.ts`
- Modify: `src/adapters/grok.ts`
- Modify: `src/protocol/engine.ts`
- Modify: `src/workspace/scope.ts`
- Test: `test/adapter-env.test.ts`
- Test: `test/protocol-repo-aware.test.ts`

- [ ] **Step 1: Add failing adapter env tests**

Mock execa and assert every adapter merges `req.env` into its subprocess environment while preserving existing adapter-specific env such as `CODEX_HOME`.

- [ ] **Step 2: Thread env through adapters**

Extend `TurnRequest` with `env?: Record<string, string>`. Pass it to execa in all adapters without using a shell.

- [ ] **Step 3: Add failing repo-aware protocol test**

Run the protocol with fake agents inside a temporary git repo. Assert each draft invocation receives a distinct worktree cwd and shared phases still run from the MAR run directory.

- [ ] **Step 4: Implement repo-aware draft workspaces**

Extend the engine input with execution context. In draft phase, create per-agent worktrees by default when git repo metadata exists; seed `.mar/input.md` and vendor instructions; pass the worktree root as adapter cwd; write captured artifacts into the protocol `work/<agent>` directory.

### Task 3: CLI Auth Init And Default Loading

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/preflight.ts`
- Modify: `src/pr-review.ts`
- Modify: `README.md`
- Test: `test/cli-auth.test.ts`
- Test: `test/pr-review.test.ts`

- [ ] **Step 1: Add `mar auth init` tests**

Assert the command creates `.mar/MAR.env`, `.mar/MAR.env.example`, updates `.gitignore`, and prints only file paths/key names.

- [ ] **Step 2: Implement `mar auth init`**

Add an `auth init` command to `src/cli.ts` that calls `ensureMarEnv`.

- [ ] **Step 3: Load MAR.env before preflight/run/pr-review**

Merge repo-local MAR.env values into invocation env for preflight and protocol runs. Do not mutate `process.env` except where unavoidable for existing call paths.

- [ ] **Step 4: Document usage**

Update README with default repo-aware behavior, `mar auth init`, `.mar/MAR.env`, and worktree cleanup expectations.

### Task 4: Tmux Planning Seam

**Files:**
- Create: `src/execution/tmux.ts`
- Modify: `src/schema/config.ts`
- Modify: `src/cli.ts`
- Test: `test/tmux.test.ts`

- [ ] **Step 1: Add tmux planning tests**

Assert session names are safe, unavailable tmux fails clearly when requested, and config accepts `terminalMode: "headless" | "tmux"`.

- [ ] **Step 2: Implement tmux planner**

Add tmux availability checks and command planning. Keep actual adapter execution headless in this slice unless `--tmux` is requested, in which case fail early with a clear currently unsupported message after proving tmux exists.

- [ ] **Step 3: Add CLI/config flags**

Add `--tmux`, `--terminal-mode`, and config default parsing. Headless remains the runtime backend; tmux is exposed as a validated execution mode seam for the next slice.

### Task 5: Verification

**Files:**
- All changed files

- [ ] **Step 1: Run focused tests**

Run `npm test -- --run test/mar-env.test.ts test/repo-git.test.ts test/adapter-env.test.ts test/protocol-repo-aware.test.ts test/cli-auth.test.ts test/tmux.test.ts`.

- [ ] **Step 2: Run existing affected tests**

Run `npm test -- --run test/adapter-cwd.test.ts test/protocol-engine.test.ts test/pr-review.test.ts test/config.test.ts`.

- [ ] **Step 3: Run build and lint**

Run `npm run build` and `npm run lint`.

- [ ] **Step 4: Commit**

Commit the implementation with a message describing repo-aware MAR execution.
