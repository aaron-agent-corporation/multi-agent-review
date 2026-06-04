#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { execa } from "execa";
import { makeClaudeAdapter, splitBin } from "./adapters/claude.js";
import { logInvocation } from "./log/invocation.js";
import { writeArtifact } from "./workspace/artifacts.js";
import { artifactPath, newRunId, nextSeq, runDir as runDirFor } from "./workspace/layout.js";
import { addArtifact, createRun, readManifest, setStatus } from "./workspace/manifest.js";

const DEFAULT_TIMEOUT_MS = 600_000; // 10 min (D-17)

// Run-id charset MUST match `newRunId` (timestamp + nanoid alphabet); no path separators or
// "..", so a supplied --run can never escape the runs/ tree (T-01-10 tampering mitigation).
const RUN_ID_RE = /^[A-Za-z0-9_-]+$/;

interface InvokeOptions {
  agent: string;
  prompt: string;
  run?: string;
  timeout?: string;
}

/**
 * Resolve --prompt: if the value is an existing file path, read its content and use the path as
 * the (loggable) reference; otherwise treat the value literally and reference it by a short label
 * — we NEVER log the full prompt body (D-15 / T-01-11).
 */
function resolvePrompt(value: string): { promptText: string; promptRef: string } {
  if (existsSync(value)) {
    return { promptText: readFileSync(value, "utf8"), promptRef: value };
  }
  const label = value.length <= 32 ? value : `${value.slice(0, 29)}...`;
  return { promptText: value, promptRef: `inline:${label}` };
}

/**
 * Parse + validate a `--timeout` value into milliseconds (WR-02). Returns the default when no
 * value is supplied, the validated integer when valid, or `null` when the value is malformed
 * (trailing garbage like "500abc", exponential/fractional forms like "1e3", non-positive, or
 * non-integer). Uses `Number` (not `parseInt`) so the WHOLE string must be a clean integer.
 */
export function parseTimeout(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms <= 0) return null;
  return ms;
}

/** Best-effort `claude --version` detection; "unknown" if the binary is absent/errors. */
async function detectClaudeVersion(bin: string): Promise<string> {
  try {
    // Reuse the adapter's single-split strategy (WR-01): splitting on every whitespace run
    // would break an injected bin whose path contains spaces (e.g. "Active Projects/…").
    const { cmd, preArgs } = splitBin(bin);
    const r = await execa(cmd, [...preArgs, "--version"], {
      reject: false,
      timeout: 10_000,
    });
    const out = (r.stdout ?? "").trim();
    return out.length > 0 ? out.split(/\s+/)[0] : "unknown";
  } catch {
    return "unknown";
  }
}

async function runInvoke(opts: InvokeOptions): Promise<number> {
  // 1. Validate --agent. Multi-vendor (codex/gemini) is Phase 2.
  if (opts.agent !== "claude") {
    process.stderr.write(
      `error: unsupported --agent "${opts.agent}" — only "claude" is supported in this phase\n`,
    );
    return 2;
  }

  const bin = process.env.MAR_CLAUDE_BIN ?? "claude";
  // WR-02: validate the WHOLE string so trailing garbage ("500abc") and sub-millisecond forms
  // ("1e3" → 1) are rejected instead of silently truncated.
  const timeoutMs = parseTimeout(opts.timeout);
  if (timeoutMs === null) {
    process.stderr.write(`error: --timeout must be a positive integer (ms)\n`);
    return 2;
  }

  // 2. Resolve the prompt (file-or-string); keep a loggable reference, not the body.
  const { promptText, promptRef } = resolvePrompt(opts.prompt);

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
    if (existsSync(artifactPath(runDir, seq, "claude"))) {
      process.stderr.write(`error: artifact slot ${seq} already exists in run "${runId}"\n`);
      return 2;
    }
  } else {
    runId = newRunId();
    runDir = runDirFor(runId);
    seq = 1;
    const claudeVersion = await detectClaudeVersion(bin);
    await createRun({
      runDir,
      runId,
      cliVersions: { claude: claudeVersion },
      status: "running",
    });
  }

  // 4. Drive the claude adapter with a wall-clock timeout (D-17 / T-01-12).
  const adapter = makeClaudeAdapter(bin);
  const turn = await adapter.invoke({
    agent: "claude",
    promptText,
    runDir,
    seq,
    timeoutMs,
  });

  let artifactRel: string | undefined;
  let exitCode: number;

  // 5. Persist outcome — branch ONLY on turn.ok (T-01-13: CLI never re-derives success).
  if (turn.ok) {
    const written = await writeArtifact(runDir, seq, "claude", {
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
      agent: "claude",
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

  // 6. ALWAYS log the invocation — even on failure (ORCH-06). The command logged is the adapter's
  // OWN redacted argv (WR-04): one source of truth shared with the spawn, never a hand-rebuilt
  // literal that can drift from the real flags. The prompt body is already redacted by the
  // adapter; promptRef carries the loggable reference separately (D-15).
  logInvocation(runDir, {
    command: turn.redactedCommand,
    promptRef,
    exitCode: turn.exitCode,
    durationMs: turn.durationMs,
    timedOut: turn.timedOut,
    artifactPath: artifactRel,
  });

  // 7. Console: ONE human-readable progress line — never the raw JSON (D-08 / T-01-11).
  const secs = (turn.durationMs / 1000).toFixed(1);
  if (turn.ok) {
    process.stdout.write(`claude ✓  ${secs}s  exit ${turn.exitCode}  → ${runDir}/${artifactRel}\n`);
  } else {
    const reason = turn.timedOut ? "timeout" : (turn.error ?? "failed");
    process.stdout.write(`claude ✗  ${secs}s  exit ${turn.exitCode}  (${reason})\n`);
  }

  return exitCode;
}

export function buildProgram(): Command {
  const program = new Command();
  program.name("mar").description("Multi-Agent Review orchestrator");

  program
    .command("invoke")
    .description("Invoke an agent CLI and capture its output as a normalized run artifact")
    .requiredOption("--agent <name>", 'agent to invoke (only "claude" this phase)')
    .requiredOption("--prompt <value>", "prompt file path OR literal prompt string")
    .option("--run <id>", "append to an existing run instead of creating a new one")
    .option("--timeout <ms>", "wall-clock timeout in milliseconds (default 600000)")
    .action(async (opts: InvokeOptions) => {
      const code = await runInvoke(opts);
      process.exitCode = code;
    });

  return program;
}

// Run only when executed as the bin entry — importing this module in tests must not auto-run.
// Compare the resolved module path against the script path Node/tsx was launched with.
const entry = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
if (entry && import.meta.url === entry) {
  buildProgram().parseAsync(process.argv);
}
