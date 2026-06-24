#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { makeAdapter } from "./adapters/registry.js";
import { loadConfig, resolveAgent } from "./config.js";
import { assertReviewable } from "./gates.js";
import { installPrepareCommitMessageNotificationHook } from "./git/notify-hook.js";
import { installPrReviewWorkflow } from "./github/install-workflow.js";
import { type NotificationStatus, notifyPullRequestCompletion } from "./github/notify.js";
import { detectVendors, writeStarterConfig } from "./init.js";
import { logInvocation } from "./log/invocation.js";
import { runPullRequestReview } from "./pr-review.js";
import { formatStatusLines, probeVersion, runPreflight } from "./preflight.js";
import type { Ask, GatingOptions } from "./protocol/engine.js";
import { resumeProtocol, runProtocol } from "./protocol/engine.js";
import { defaultAsk } from "./protocol/gating.js";
import {
  type Classify,
  classifyClaude,
  classifyCodex,
  classifyGemini,
  classifyGrok,
  withRetry,
} from "./retry.js";
import type { AgentEntry } from "./schema/config.js";
import { RESUMABLE_STATUSES, TERMINAL_DONE } from "./schema/manifest.js";
import { writeArtifact } from "./workspace/artifacts.js";
import { artifactPath, newRunId, nextSeq, runDir as runDirFor } from "./workspace/layout.js";
import { addArtifact, createRun, readManifest, setStatus } from "./workspace/manifest.js";

// WR-05: cap a prompt FILE read at 10 MB, matching claude's stdin cap (claude 2.1.128+). A
// value larger than this is treated as an error rather than silently streamed to the model.
const MAX_PROMPT_FILE_BYTES = 10 * 1024 * 1024;

// Run-id charset MUST match `newRunId` (timestamp + nanoid alphabet); no path separators or
// "..", so a supplied --run can never escape the runs/ tree (T-01-10 tampering mitigation).
const RUN_ID_RE = /^[A-Za-z0-9_-]+$/;

// The injectable prompt seam (D-53). Production uses `defaultAsk` (node:readline/promises, no new
// dependency); tests substitute a stub via {@link setAsk} so every gated/arbitration path is provable
// without a real TTY. Mirrors the numEnv test-seam spirit (test-only behavior injection). The seam is
// module-level so both the run-start mode prompt and the engine's gate prompts share ONE source.
let askImpl: Ask = defaultAsk;
/** Substitute the ask() seam (tests only). Returns the previous impl so a test can restore it. */
export function setAsk(fn: Ask): Ask {
  const prev = askImpl;
  askImpl = fn;
  return prev;
}
/** Restore the production ask() seam (tests only). */
export function resetAsk(): void {
  askImpl = defaultAsk;
}

/** Run-command flags resolved by commander for `mar run`. */
interface RunOptions {
  mode?: string;
  gated?: boolean;
  autonomous?: boolean;
  pauseAndExit?: boolean;
  config?: string;
}

interface PullRequestReviewOptions extends RunOptions {
  post?: boolean;
}

interface PullRequestNotifyOptions {
  status?: string;
  runUrl?: string;
  reviewUrl?: string;
  statusContext?: string;
  repository?: string;
  webhookUrl?: string;
  timeout?: string;
}

interface PullRequestNotifyHookInstallOptions {
  kind?: string;
  target?: string;
  gitDir?: string;
}

interface PullRequestInstallWorkflowOptions {
  repo?: string;
  force?: boolean;
  actionRef?: string;
  runnerLabels?: string;
}

interface PreflightOptions {
  config?: string;
}

/**
 * Resolve the effective per-run gating mode (PROT-05 / D-53 / Pitfall 5). Precedence:
 *   1. An explicit flag (`--mode`/`--gated`/`--autonomous`) WINS and skips the prompt — works in
 *      both TTY and non-TTY contexts.
 *   2. Else, if stdin IS a TTY, prompt once via the ask() seam to choose gated/autonomous.
 *   3. Else (non-TTY, no flag) DEFAULT to the config's `mode` (itself defaulting to autonomous) and
 *      NEVER prompt — a scripted/CI `mar run` must not hang (Pitfall 5 / T-05-15).
 * `--pause-and-exit` is only meaningful with gated; it is ignored in autonomous mode.
 * Returns the resolved {@link GatingOptions} carrying the ask() seam for the engine's gate prompts.
 */
async function resolveGating(
  opts: RunOptions,
  configMode: "autonomous" | "gated",
): Promise<GatingOptions> {
  let mode: "autonomous" | "gated" | undefined;
  // Explicit flags (most specific first); `--mode` accepts the two literals.
  if (opts.gated) mode = "gated";
  else if (opts.autonomous) mode = "autonomous";
  else if (opts.mode === "gated" || opts.mode === "autonomous") mode = opts.mode;

  if (mode === undefined) {
    if (process.stdin.isTTY) {
      // Interactive run-start prompt (D-53). The ONLY prompt issued when no flag is set and stdin is
      // a TTY; guarded so a non-TTY run never reaches here.
      const answer = (await askImpl("execution mode? [autonomous]/gated > ")).trim().toLowerCase();
      mode = answer === "gated" || answer === "g" ? "gated" : "autonomous";
    } else {
      // Non-TTY, no flag → the config default (autonomous unless the roster opted into gated). NEVER
      // prompt here (Pitfall 5): a bare scripted `mar run` must complete unattended.
      mode = configMode;
    }
  }

  const pauseAndExit = mode === "gated" && opts.pauseAndExit === true;
  // The ask() seam is threaded into gating ONLY for gated mode (autonomous never prompts).
  return mode === "gated" ? { mode, pauseAndExit, ask: askImpl } : { mode, pauseAndExit: false };
}

interface InvokeOptions {
  agent: string;
  prompt: string;
  run?: string;
  timeout?: string;
}

type ResolvedPrompt =
  | { ok: true; promptText: string; promptRef: string }
  | { ok: false; error: string };

/** Per-vendor transient-vs-fatal classifier for the withRetry wrapper (D-22/D-24). */
const CLASSIFY: Record<AgentEntry["vendor"], Classify> = {
  claude: classifyClaude,
  codex: classifyCodex,
  gemini: classifyGemini,
  grok: classifyGrok,
};

/**
 * Resolve --prompt: if the value names an existing REGULAR file, read its content (bounded to
 * {@link MAX_PROMPT_FILE_BYTES} — WR-05) and use the path as the (loggable) reference; otherwise
 * treat the value literally and reference it by a short label. We NEVER log the full prompt body
 * (D-15 / T-01-11).
 *
 * The file read is bounded so a literal value that happens to name a huge file can't silently
 * stream unbounded content to the model; an oversize file is a hard error. A value that names a
 * non-regular file (directory, socket, ...) falls through to literal-string handling.
 */
export function resolvePrompt(value: string): ResolvedPrompt {
  if (existsSync(value)) {
    const stat = statSync(value);
    if (stat.isFile()) {
      if (stat.size > MAX_PROMPT_FILE_BYTES) {
        return {
          ok: false,
          error: `prompt file "${value}" is ${stat.size} bytes, exceeds the ${MAX_PROMPT_FILE_BYTES}-byte cap`,
        };
      }
      return { ok: true, promptText: readFileSync(value, "utf8"), promptRef: value };
    }
  }
  const label = value.length <= 32 ? value : `${value.slice(0, 29)}...`;
  return { ok: true, promptText: value, promptRef: `inline:${label}` };
}

/**
 * Parse + validate a `--timeout` value into milliseconds (WR-02). Returns `undefined` when no
 * value is supplied (caller falls back to the roster's effective timeout), the validated integer
 * when valid, or `null` when the value is malformed (trailing garbage like "500abc", fractional
 * forms like "1.5", hex like "0x10", surrounding whitespace like "  500  ", non-positive, or
 * non-integer). A decimal-or-scientific-integer regex gates the WHOLE string BEFORE `Number`
 * coercion, so the contract is a genuinely clean integer ("1e3" → 1000 is still accepted).
 */
export function parseTimeout(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  // WR-04: `Number()` alone also coerces hex ("0x10" → 16) and surrounding-whitespace forms
  // ("  500  " → 500), neither of which is the documented "clean integer". Gate on a
  // decimal-or-scientific-integer shape FIRST (no leading/trailing whitespace, no 0x), then let
  // Number do the conversion. "1e3" stays accepted (it coerces to the integer 1000); "0x10",
  // "  500  ", "1.5", and "500abc" are now rejected.
  if (!/^\d+(e\d+)?$/i.test(value)) return null;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms <= 0) return null;
  return ms;
}

/**
 * Best-effort `<bin> --version` detection → extracted semver, "unknown" if the binary is
 * absent/errors. Delegates to the SHARED {@link probeVersion} helper (WR-05) so the invoke-path
 * version capture and the preflight install-check apply the SAME `--version` rule and can never
 * disagree on what "installed" means. extractVersion (via probeVersion) captures codex's two-token
 * `codex-cli 0.128.0` and gemini's bare `0.45.0` correctly (Pitfall 2 — never `split()[0]`).
 */
async function detectVersion(bin: string): Promise<string> {
  return (await probeVersion(bin)).version;
}

async function runInvoke(opts: InvokeOptions): Promise<number> {
  // 1. Load the roster and resolve the agent by NAME (D-20). Missing roster / unknown name are
  //    clear exit-2 errors. `mar invoke` is EXEMPT from the >=2-vendor gate and does NOT
  //    auto-preflight (D-27/D-29) — neither runPreflight nor assertReviewable is called here.
  let entry: AgentEntry;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig();
    entry = resolveAgent(config, opts.agent);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const bin = entry.bin ?? entry.vendor; // production default = bare vendor name
  // WR-02: validate the WHOLE string so trailing garbage ("500abc") and sub-millisecond forms
  // ("1e3" → 1) are rejected instead of silently truncated. No --timeout → the roster's effective
  // timeout (entry override ?? config default).
  const parsedTimeout = parseTimeout(opts.timeout);
  if (parsedTimeout === null) {
    process.stderr.write(`error: --timeout must be a positive integer (ms)\n`);
    return 2;
  }
  const timeoutMs = parsedTimeout ?? entry.timeoutMs ?? config.defaults.timeoutMs;
  const retries = config.defaults.retries;

  // 2. Resolve the prompt (file-or-string); keep a loggable reference, not the body. A prompt
  // file read is bounded (WR-05): an oversize file is a hard error, never silently sent.
  const resolved = resolvePrompt(opts.prompt);
  if (!resolved.ok) {
    process.stderr.write(`error: ${resolved.error}\n`);
    return 2;
  }
  const { promptText, promptRef } = resolved;

  // 3. Resolve the run: create a new one, or append to an existing --run.
  let runId: string;
  let runDir: string;
  let seq: number;
  if (opts.run) {
    if (!RUN_ID_RE.test(opts.run)) {
      process.stderr.write(`error: invalid --run id "${opts.run}"\n`);
      return 2;
    }
    runId = opts.run;
    runDir = runDirFor(runId);
    if (!existsSync(runDir)) {
      process.stderr.write(`error: run "${runId}" does not exist (no --run creates a new run)\n`);
      return 2;
    }
    const manifest = await readManifest(runDir); // re-derive state from disk (PROT-07)
    // WR-03: derive a MONOTONIC seq from the highest seq ever used — across both the manifest's
    // recorded artifacts AND any artifact files on disk — not the success count. Deriving from
    // `artifacts.length` would reuse a seq after a failed turn and silently overwrite a prior
    // artifact on a resumed run.
    const onDiskNames = existsSync(runDir) ? readdirSync(runDir) : [];
    seq = nextSeq(
      manifest.artifacts.map((a) => a.path),
      onDiskNames,
    );
    // WR-03: refuse to overwrite an existing artifact at the computed slot. nextSeq is monotonic
    // so this should never trigger, but the guard makes overwrite impossible rather than relying
    // on the atomic write to silently clobber.
    if (existsSync(artifactPath(runDir, seq, entry.name))) {
      process.stderr.write(`error: artifact slot ${seq} already exists in run "${runId}"\n`);
      return 2;
    }
  } else {
    runId = newRunId();
    runDir = runDirFor(runId);
    seq = 1;
    // Capture the per-vendor CLI version with the Pitfall-2-safe extractor (fixes the codex
    // "codex-cli" bug) keyed by VENDOR so the manifest reports e.g. cliVersions.codex.
    const version = await detectVersion(bin);
    await createRun({
      runDir,
      runId,
      cliVersions: { [entry.vendor]: version },
      status: "running",
    });
  }

  // 4. Drive the roster-resolved adapter, wrapped in the ONE vendor-agnostic retry seam (D-24).
  //    EVERY attempt — including failures — is logged with its 1-based attempt number (D-25) via
  //    the onAttempt callback. Persistence below branches ONLY on the FINAL turn.ok (T-01-13).
  const adapter = makeAdapter(entry.vendor, entry.bin, entry.model);
  const baseMs = numEnv("MAR_RETRY_BASE_MS");
  const maxMs = numEnv("MAR_RETRY_MAX_MS");
  const turn = await withRetry(
    () =>
      adapter.invoke({
        agent: entry.name,
        promptText,
        runDir,
        seq,
        timeoutMs,
      }),
    {
      retries,
      classify: CLASSIFY[entry.vendor],
      ...(baseMs !== undefined ? { baseMs } : {}),
      ...(maxMs !== undefined ? { maxMs } : {}),
      // Log EVERY attempt (incl. failures) — the command logged is the adapter's OWN redacted argv
      // (WR-04), the prompt body is never present, and promptRef carries the loggable reference
      // separately (D-15/D-25).
      onAttempt: (t, attempt) =>
        logInvocation(runDir, {
          command: t.redactedCommand,
          promptRef,
          exitCode: t.exitCode,
          durationMs: t.durationMs,
          timedOut: t.timedOut,
          attempt,
        }),
    },
  );

  let artifactRel: string | undefined;
  let exitCode: number;

  // 5. Persist outcome — branch ONLY on the FINAL turn.ok (T-01-13: CLI never re-derives success).
  if (turn.ok) {
    const written = await writeArtifact(runDir, seq, entry.name, {
      text: turn.text,
      raw: turn,
      frontmatter: {
        runId,
        ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
      },
    });
    // Manifest stores the artifact path RELATIVE to the run dir.
    const relPath = written.path.slice(runDir.length + 1);
    await addArtifact(runDir, {
      path: relPath,
      agent: entry.name,
      seq,
      kind: "output",
      createdAt: new Date().toISOString(),
    });
    await setStatus(runDir, "completed");
    artifactRel = relPath;
    exitCode = 0;
  } else if (turn.timedOut) {
    await setStatus(runDir, "timeout"); // no normalized artifact on timeout (D-17)
    exitCode = 1;
  } else {
    await setStatus(runDir, "failed");
    exitCode = 1;
  }

  // 6. Console: ONE human-readable progress line — never the raw JSON (D-08 / T-01-11).
  const secs = (turn.durationMs / 1000).toFixed(1);
  if (turn.ok) {
    process.stdout.write(
      `${entry.vendor} ✓  ${secs}s  exit ${turn.exitCode}  → ${runDir}/${artifactRel}\n`,
    );
  } else {
    const reason = turn.timedOut ? "timeout" : (turn.error ?? "failed");
    process.stdout.write(`${entry.vendor} ✗  ${secs}s  exit ${turn.exitCode}  (${reason})\n`);
  }

  return exitCode;
}

/** Read a non-negative integer env var for test-only backoff injection; undefined if unset/invalid. */
function numEnv(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** `mar init` — probe PATH, write a starter roster, print a one-line detected-vendor summary (D-21). */
async function runInit(): Promise<number> {
  const vendors = detectVendors();
  if (vendors.length === 0) {
    process.stderr.write(
      "error: no supported vendor CLI (claude/codex/gemini/grok) found on PATH — install one and re-run `mar init`\n",
    );
    return 1;
  }
  await writeStarterConfig("mar.config.json", vendors);
  process.stdout.write(`wrote mar.config.json — detected vendors: ${vendors.join(", ")}\n`);
  return 0;
}

/**
 * `mar preflight` — load the roster, run the tiered check, print the status table, and map
 * allPass → exit 0 / any-fail → exit 1 (D-28). `mar preflight` is the EXPLICIT preflight trigger
 * (run-start auto-preflight is Phase 3 — D-27). The business logic lives in preflight.ts; the CLI
 * stays thin.
 */
async function runPreflightCmd(opts: PreflightOptions = {}): Promise<number> {
  let agents: AgentEntry[];
  try {
    const config = await loadConfig(opts.config);
    agents = config.agents;
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const { results, allPass } = await runPreflight(agents);
  for (const line of formatStatusLines(results)) {
    process.stdout.write(`${line}\n`);
  }
  return allPass ? 0 : 1;
}

/**
 * `mar run <input>` — drive an input document through the full 6-phase review protocol. THIN
 * controller (02-05 thin-CLI rule): it loads the roster, enforces the run-start gates, validates
 * the input path, creates the run, then delegates ALL phase/business logic to runProtocol. The CLI
 * builds NO vendor argv and contains no phase logic.
 *
 * Unlike `mar invoke`, `mar run` is NOT gate-exempt: it MUST pass assertReviewable (>=2 distinct
 * vendors, D-29) — single-vendor review is out of scope. It does NOT auto-run preflight (D-27).
 */
async function runRun(input: string, opts: RunOptions = {}): Promise<number> {
  // 1. Load the roster (clear missing/invalid errors → exit 2).
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(opts.config);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  // 2. Run-start diversity gate (NOT exempt): refuse a <2-distinct-vendor roster BEFORE any run is
  //    created. The thrown message names the vendors found.
  try {
    assertReviewable(config.agents);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  // 3. Validate <input>: an existing REGULAR file bounded to MAX_PROMPT_FILE_BYTES (WR-05),
  //    reusing the resolvePrompt/statSync discipline. A missing/oversize/non-regular file → exit 2.
  if (!existsSync(input)) {
    process.stderr.write(`error: input "${input}" does not exist\n`);
    return 2;
  }
  const inputStat = statSync(input);
  if (!inputStat.isFile()) {
    process.stderr.write(`error: input "${input}" is not a regular file\n`);
    return 2;
  }
  if (inputStat.size > MAX_PROMPT_FILE_BYTES) {
    process.stderr.write(
      `error: input "${input}" is ${inputStat.size} bytes, exceeds the ${MAX_PROMPT_FILE_BYTES}-byte cap\n`,
    );
    return 2;
  }

  // 4. Resolve the per-run gating mode (PROT-05 / D-53): a flag wins; else a TTY prompt; else the
  //    config default — a non-TTY run NEVER prompts (Pitfall 5). The resolved mode carries the ask()
  //    seam for the engine's phase-boundary gate prompts.
  const gating = await resolveGating(opts, config.defaults.mode);

  // 5. Create the run (status "running"), then delegate the entire protocol to the engine.
  const runId = newRunId();
  const runDir = runDirFor(runId);
  // Record the input path so `mar resume` can re-derive the machine input from disk (D-54).
  await createRun({ runDir, runId, status: "running", inputPath: input });
  return await runProtocol(runDir, config, input, gating);
}

async function runPrReview(selector: string, opts: PullRequestReviewOptions = {}): Promise<number> {
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(opts.config);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  try {
    assertReviewable(config.agents);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  let gating: GatingOptions;
  try {
    gating = await resolveGating(opts, config.defaults.mode);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  try {
    return await runPullRequestReview(selector, { config, gating, post: opts.post === true });
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function runPrNotify(selector: string, opts: PullRequestNotifyOptions = {}): Promise<number> {
  if (opts.status !== "success" && opts.status !== "failure") {
    process.stderr.write("error: --status must be success or failure\n");
    return 2;
  }
  const runUrl = opts.runUrl ?? process.env.RUN_URL;
  if (!runUrl) {
    process.stderr.write("error: --run-url is required when RUN_URL is not set\n");
    return 2;
  }
  const timeoutMs = parseTimeout(opts.timeout);
  if (timeoutMs === null) {
    process.stderr.write("error: --timeout must be a positive integer (ms)\n");
    return 2;
  }

  try {
    const result = await notifyPullRequestCompletion(selector, {
      status: opts.status as NotificationStatus,
      runUrl,
      ...(opts.reviewUrl ? { reviewUrl: opts.reviewUrl } : {}),
      ...(opts.statusContext ? { statusContext: opts.statusContext } : {}),
      ...(opts.repository ? { repository: opts.repository } : {}),
      ...(opts.webhookUrl ? { webhookUrl: opts.webhookUrl } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    if (result.sent) {
      process.stdout.write(`✓ sent MAR completion notification to ${result.payload.target}\n`);
    } else {
      process.stdout.write(`MAR completion notification skipped: ${result.reason}\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function runPrNotifyHookInstall(opts: PullRequestNotifyHookInstallOptions = {}): number {
  if (!opts.target) {
    process.stderr.write("error: --target is required\n");
    return 2;
  }
  try {
    const result = installPrepareCommitMessageNotificationHook({
      gitDir: opts.gitDir ?? ".git",
      kind: opts.kind ?? "claude-code-channel",
      target: opts.target,
    });
    process.stdout.write(`✓ installed MAR notification commit hook at ${result.hookPath}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function runPrInstallWorkflow(opts: PullRequestInstallWorkflowOptions = {}): Promise<number> {
  try {
    const result = await installPrReviewWorkflow({
      repo: opts.repo,
      force: opts.force,
      actionRef: opts.actionRef,
      runnerLabels: opts.runnerLabels,
    });
    const verb = result.overwritten ? "updated" : "installed";
    process.stdout.write(`✓ ${verb} MAR PR review workflow at ${result.workflowPath}\n`);
    process.stdout.write(
      "Next: commit this workflow, confirm a self-hosted runner is online for the repo, then open or update a non-draft same-repo PR.\n",
    );
    return 0;
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

/**
 * `mar resume <run-id>` / `mar resume --last` — continue an interrupted/failed/paused run from its
 * last completed phase (PROT-06, D-55). THIN controller (02-05 thin-CLI rule): it loads the roster,
 * resolves the target run (explicit id or the most-recent resumable run), refuses a terminal-done
 * run, then delegates ALL phase derivation, D-56 re-validation, preflight, and the terminal status to
 * {@link resumeProtocol}. No phase/re-validation logic lives here.
 *
 * Exactly one of `<run-id>` / `--last` must be supplied (usage error otherwise). `<run-id>` is
 * validated against RUN_ID_RE (the path-traversal guard, T-05-10) and the run dir must exist.
 */
async function runResume(opts: {
  runId?: string;
  last?: boolean;
  step?: boolean;
  feedback?: string;
  abort?: boolean;
  config?: string;
}): Promise<number> {
  // 0. Non-interactive gate-decision flags (D-50/D-51 relay surface for drivers like the Claude
  //    Code plugin): `--abort` ends the paused run and runs nothing, so it cannot be combined with
  //    flags that continue it.
  if (opts.abort && (opts.step || opts.feedback !== undefined)) {
    process.stderr.write("error: --abort cannot be combined with --step or --feedback\n");
    return 2;
  }
  if (opts.feedback !== undefined && opts.feedback.trim().length === 0) {
    process.stderr.write("error: --feedback requires a non-empty note\n");
    return 2;
  }

  // 1. Load the roster (clear missing/invalid errors → exit 2).
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(opts.config);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  // 2. Require EXACTLY one selector.
  if (opts.last && opts.runId) {
    process.stderr.write("error: pass either <run-id> or --last, not both\n");
    return 2;
  }
  if (!opts.last && !opts.runId) {
    process.stderr.write("error: specify a <run-id> or --last\n");
    return 2;
  }

  // 3. Resolve the target run dir.
  let runDir: string;
  if (opts.last) {
    // Enumerate runs/, readManifest each, filter to RESUMABLE_STATUSES, pick most-recent by updatedAt.
    const runsRoot = "runs";
    if (!existsSync(runsRoot)) {
      process.stderr.write("error: no runs/ directory — nothing to resume\n");
      return 2;
    }
    let best: { dir: string; updatedAt: string } | undefined;
    for (const id of readdirSync(runsRoot)) {
      if (!RUN_ID_RE.test(id)) continue;
      const dir = runDirFor(id);
      try {
        const m = await readManifest(dir);
        if (!(RESUMABLE_STATUSES as readonly string[]).includes(m.status)) continue;
        if (!best || m.updatedAt > best.updatedAt) best = { dir, updatedAt: m.updatedAt };
      } catch {
        // A run dir without a parseable manifest is skipped (not resumable).
      }
    }
    if (!best) {
      process.stderr.write("error: no resumable run found (--last)\n");
      return 2;
    }
    runDir = best.dir;
  } else {
    const runId = opts.runId as string;
    if (!RUN_ID_RE.test(runId)) {
      process.stderr.write(`error: invalid run id "${runId}"\n`);
      return 2;
    }
    runDir = runDirFor(runId);
    if (!existsSync(runDir)) {
      process.stderr.write(`error: run "${runId}" does not exist\n`);
      return 2;
    }
  }

  // 4. Refuse a terminal-done run up front with a clear message (resumeProtocol also fails closed).
  const manifest = await readManifest(runDir);
  if ((TERMINAL_DONE as readonly string[]).includes(manifest.status)) {
    process.stderr.write(`error: run already ${manifest.status}; nothing to resume\n`);
    return 2;
  }

  // 4b. `--abort`: end a PAUSED run without running anything. Mirrors the interactive abort path
  //     (engine gate → `failed` with a human-attributed cause; there is no separate `aborted`
  //     status). Only a gate pause is abortable here — an interrupted/failed run has nothing
  //     pending a human decision.
  if (opts.abort) {
    if (manifest.status !== "paused-awaiting-approval") {
      process.stderr.write(
        `error: --abort requires a run paused at a gate (status "paused-awaiting-approval"); found "${manifest.status}"\n`,
      );
      return 2;
    }
    await setStatus(runDir, "failed", "run aborted by human at a gate (mar resume --abort)");
    process.stdout.write(`✗ run ${manifest.runId} aborted at the gate\n`);
    return 0;
  }

  // 5. Delegate the entire resume (phase derivation + D-56 re-validation + preflight + terminal
  //    status) to the engine and return its exit code. `--step` resumes gated with pause-and-exit
  //    (run exactly one phase, then pause again — the non-interactive per-gate stepping surface);
  //    `--feedback` threads a D-51 steering note into the resumed phase's prompt.
  const gating: GatingOptions | undefined = opts.step
    ? { mode: "gated", pauseAndExit: true }
    : undefined;
  return await resumeProtocol(runDir, config, gating, opts.feedback?.trim());
}

export function buildProgram(): Command {
  const program = new Command();
  program.name("mar").description("Multi-Agent Review orchestrator");

  program
    .command("invoke")
    .description("Invoke an agent CLI and capture its output as a normalized run artifact")
    .requiredOption(
      "--agent <name>",
      "roster agent name to invoke (resolved against mar.config.json)",
    )
    .requiredOption("--prompt <value>", "prompt file path OR literal prompt string")
    .option("--run <id>", "append to an existing run instead of creating a new one")
    .option(
      "--timeout <ms>",
      "wall-clock timeout in milliseconds (default: roster effective timeout)",
    )
    .action(async (opts: InvokeOptions) => {
      process.exitCode = await runInvoke(opts);
    });

  program
    .command("init")
    .description("Detect installed vendor CLIs and write a starter mar.config.json roster")
    .action(async () => {
      process.exitCode = await runInit();
    });

  program
    .command("preflight")
    .description("Check each roster agent (installed/responsive) and print a status table")
    .option("--config <path>", "path to mar.config.json")
    .action(async (opts: PreflightOptions) => {
      process.exitCode = await runPreflightCmd(opts);
    });

  program
    .command("run")
    .description("Run the 6-phase review protocol on an input document")
    .argument("<input>", "path to the input document")
    .option(
      "--mode <gated|autonomous>",
      "execution mode (overrides the config + the run-start prompt)",
    )
    .option("--gated", "gated mode: pause at each phase boundary for approval (PROT-05)")
    .option("--autonomous", "autonomous mode: run unattended with no pauses")
    .option(
      "--pause-and-exit",
      "gated only: pause at the first boundary, exit 0, resume with `mar resume`",
    )
    .option("--config <path>", "path to mar.config.json")
    .action(async (input: string, opts: RunOptions) => {
      process.exitCode = await runRun(input, opts);
    });

  const pr = program.command("pr").description("GitHub pull request workflows");

  pr.command("review")
    .description("Run the multi-agent protocol on a GitHub pull request")
    .argument("<pr>", "pull request number, URL, or gh selector")
    .option("--post", "post the unified review back to GitHub with gh pr review --comment")
    .option(
      "--mode <gated|autonomous>",
      "execution mode (overrides the config + the run-start prompt)",
    )
    .option("--gated", "gated mode: pause at each phase boundary for approval")
    .option("--autonomous", "autonomous mode: run unattended with no pauses")
    .option(
      "--pause-and-exit",
      "gated only: pause at the first boundary, exit 0, resume with `mar resume`",
    )
    .option("--config <path>", "path to mar.config.json")
    .action(async (selector: string, opts: PullRequestReviewOptions) => {
      process.exitCode = await runPrReview(selector, opts);
    });

  pr.command("notify")
    .description("Send a completion notification for an opted-in pull request")
    .argument("<pr>", "pull request number, URL, or gh selector")
    .requiredOption("--status <success|failure>", "MAR review terminal status")
    .option("--run-url <url>", "GitHub Actions run URL (defaults to RUN_URL)")
    .option("--review-url <url>", "URL where the posted MAR review can be read")
    .option("--status-context <name>", "GitHub status context name")
    .option("--repository <owner/repo>", "repository name (defaults to GITHUB_REPOSITORY)")
    .option("--webhook-url <url>", "notification relay URL (defaults to MAR_NOTIFY_WEBHOOK_URL)")
    .option("--timeout <ms>", "notification HTTP timeout in milliseconds")
    .action(async (selector: string, opts: PullRequestNotifyOptions) => {
      process.exitCode = await runPrNotify(selector, opts);
    });

  const notifyHook = pr
    .command("notify-hook")
    .description("Install local hooks that add MAR notification metadata to commits");

  notifyHook
    .command("install")
    .description("Install a prepare-commit-msg hook that appends a MAR-Notify trailer")
    .option("--kind <kind>", "notification marker kind", "claude-code-channel")
    .requiredOption("--target <target>", "logical notification target, e.g. mar-relay:abc123")
    .option("--git-dir <path>", "path to the repository .git directory", ".git")
    .action((opts: PullRequestNotifyHookInstallOptions) => {
      process.exitCode = runPrNotifyHookInstall(opts);
    });

  pr.command("install-workflow")
    .description("Install the reusable MAR automatic PR review workflow into a target repository")
    .option("--repo <path>", "target repository path", ".")
    .option("--force", "overwrite an existing .github/workflows/mar-pr-review.yml")
    .option(
      "--action-ref <ref>",
      "reusable action ref",
      "aaron-agent-corporation/multi-agent-review@main",
    )
    .option(
      "--runner-labels <labels>",
      "comma-separated runs-on labels for the self-hosted runner",
      "self-hosted",
    )
    .action(async (opts: PullRequestInstallWorkflowOptions) => {
      process.exitCode = await runPrInstallWorkflow(opts);
    });

  program
    .command("resume")
    .description("Resume an interrupted/failed/paused run from its last completed phase")
    .argument("[run-id]", "the run id to resume (omit when using --last)")
    .option("--last", "resume the most-recent resumable run")
    .option("--step", "resume gated: run exactly one phase, then pause again at the next boundary")
    .option(
      "--feedback <note>",
      "steer the resumed phase with a human feedback note (D-51; recorded in gate-feedback/)",
    )
    .option(
      "--abort",
      "end a gate-paused run without running anything (cannot combine with --step/--feedback)",
    )
    .option("--config <path>", "path to mar.config.json")
    .action(
      async (
        runId: string | undefined,
        opts: {
          last?: boolean;
          step?: boolean;
          feedback?: string;
          abort?: boolean;
          config?: string;
        },
      ) => {
        process.exitCode = await runResume({
          runId,
          last: opts.last,
          step: opts.step,
          feedback: opts.feedback,
          abort: opts.abort,
          config: opts.config,
        });
      },
    );

  return program;
}

// Run only when executed as the bin entry — importing this module in tests must not auto-run.
// Compare the resolved module path against the script path Node/tsx was launched with.
const entry = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
if (entry && import.meta.url === entry) {
  buildProgram().parseAsync(process.argv);
}
