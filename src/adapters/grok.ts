import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { GrokJson, type TurnResult } from "../schema/turn.js";
import type { AgentAdapter, TurnRequest } from "./adapter.js";
import { redactArgvAt, safeJsonParse, splitBin } from "./common.js";

/**
 * Build the pinned Grok CLI argv for headless JSON invocation. Current xAI docs list:
 *   -p <prompt>             -> single headless prompt
 *   --output-format json    -> one JSON object at the end
 *   --no-auto-update        -> skip background update checks in scripts/CI
 *   --permission-mode dontAsk -> deny tool execution instead of prompting in CI
 *   --no-memory / --no-subagents / --disable-web-search -> keep review probes self-contained
 *   --max-turns 1           -> keep headless review calls from looping on discovered tools/MCP
 *   -m <model>              -> optional model selector, e.g. grok-build
 * We deliberately omit --always-approve: review turns should not auto-approve tool execution.
 */
function buildArgv(promptText: string, model?: string): string[] {
  const a = [
    "-p",
    promptText,
    "--output-format",
    "json",
    "--no-auto-update",
    "--permission-mode",
    "dontAsk",
    "--no-memory",
    "--no-subagents",
    "--disable-web-search",
    "--max-turns",
    "1",
  ];
  if (model) a.push("-m", model);
  return a;
}

const MAX_ERROR_LEN = 500;
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping control chars.
const ERROR_CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const ISOLATED_GROK_CONFIG = `[compat.cursor]
skills = false
rules = false
agents = false
mcps = false
hooks = false

[compat.claude]
skills = false
rules = false
agents = false
mcps = false
hooks = false

[plugins]
paths = []
disabled = []
`;

type GrokRuntime = {
  env: Record<string, string>;
  cleanup: () => Promise<void>;
};

async function copyIfPresent(source: string, destination: string): Promise<void> {
  try {
    await copyFile(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function prepareIsolatedGrokRuntime(
  env: Record<string, string> | undefined,
): Promise<GrokRuntime> {
  const sourceHome = env?.HOME ?? process.env.HOME;
  const sourceGrokHome = env?.GROK_HOME ?? (sourceHome ? join(sourceHome, ".grok") : undefined);
  const tempHome = await mkdtemp(join(tmpdir(), "mar-grok-home-"));
  const tempGrokHome = join(tempHome, ".grok");

  await mkdir(tempGrokHome, { recursive: true });
  if (sourceGrokHome) {
    await copyIfPresent(join(sourceGrokHome, "auth.json"), join(tempGrokHome, "auth.json"));
  }
  await writeFile(join(tempGrokHome, "config.toml"), ISOLATED_GROK_CONFIG, "utf8");

  return {
    env: {
      ...(env ?? {}),
      GROK_MEMORY: "0",
      GROK_SUBAGENTS: "0",
      GROK_WEB_FETCH: "0",
      GROK_CURSOR_SKILLS_ENABLED: "0",
      GROK_CURSOR_RULES_ENABLED: "0",
      GROK_CURSOR_AGENTS_ENABLED: "0",
      GROK_CURSOR_MCPS_ENABLED: "0",
      GROK_CURSOR_HOOKS_ENABLED: "0",
      GROK_CLAUDE_SKILLS_ENABLED: "0",
      GROK_CLAUDE_RULES_ENABLED: "0",
      GROK_CLAUDE_AGENTS_ENABLED: "0",
      GROK_CLAUDE_MCPS_ENABLED: "0",
      GROK_CLAUDE_HOOKS_ENABLED: "0",
      HOME: tempHome,
      GROK_HOME: tempGrokHome,
    },
    cleanup: () => rm(tempHome, { recursive: true, force: true }),
  };
}

function boundStderr(stderr: string): string {
  const flattened = stderr.replace(/\r?\n/g, " ").replace(ERROR_CONTROL_CHARS, "").trim();
  return flattened.length > MAX_ERROR_LEN ? `${flattened.slice(0, MAX_ERROR_LEN)}...` : flattened;
}

function errorMessage(error: GrokJson["error"]): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error.message === "string") return error.message;
  return undefined;
}

function responseText(j: GrokJson): string | undefined {
  return j.response ?? j.result ?? j.text;
}

function sanitizeGrokError(message: string | undefined, stderr: string): string {
  const bounded = boundStderr(stderr);
  return message?.trim() || bounded || "grok error";
}

export function makeGrokAdapter(bin = "grok", model?: string): AgentAdapter {
  return {
    name: "grok",
    async invoke(req: TurnRequest): Promise<TurnResult> {
      const { cmd, preArgs } = splitBin(bin);
      const argv = [...preArgs, ...buildArgv(req.promptText, model)];
      const redactedCommand = redactArgvAt(argv, preArgs.length + 1);
      const runtime = await prepareIsolatedGrokRuntime(req.env);
      let result: Awaited<ReturnType<typeof execa>>;
      try {
        result = await execa(cmd, argv, {
          timeout: req.timeoutMs,
          killSignal: "SIGTERM",
          forceKillAfterDelay: 5000,
          reject: false,
          cleanup: true,
          stdin: "ignore",
          env: runtime.env,
          ...(req.cwd ? { cwd: req.cwd } : {}),
        });
      } finally {
        await runtime.cleanup();
      }

      const durationMs = result.durationMs ?? 0;
      const stdout = typeof result.stdout === "string" ? result.stdout : "";
      const stderr = typeof result.stderr === "string" ? result.stderr : "";

      if (result.timedOut || result.isForcefullyTerminated) {
        return {
          ok: false,
          agent: this.name,
          text: "",
          exitCode: result.exitCode ?? -1,
          durationMs,
          timedOut: true,
          redactedCommand,
          error: "timeout",
        };
      }

      const parsed = GrokJson.safeParse(safeJsonParse(stdout) ?? safeJsonParse(stderr));
      if (!parsed.success) {
        return {
          ok: false,
          agent: this.name,
          text: "",
          exitCode: result.exitCode ?? -1,
          durationMs,
          timedOut: false,
          redactedCommand,
          error: `unparseable output: ${boundStderr(stderr) || "no json"}`,
        };
      }

      const j = parsed.data;
      const text = responseText(j);
      const ok = result.exitCode === 0 && j.error == null && typeof text === "string";

      return {
        ok,
        agent: this.name,
        text: ok ? (text ?? "") : "",
        exitCode: result.exitCode ?? 0,
        durationMs,
        timedOut: false,
        redactedCommand,
        sessionId: j.session_id ?? j.sessionId,
        error: ok ? undefined : sanitizeGrokError(errorMessage(j.error), stderr),
      };
    },
  };
}
