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
  ];
  if (model) a.push("-m", model);
  return a;
}

const MAX_ERROR_LEN = 500;
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping control chars.
const ERROR_CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

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
      const result = await execa(cmd, argv, {
        timeout: req.timeoutMs,
        killSignal: "SIGTERM",
        forceKillAfterDelay: 5000,
        reject: false,
        cleanup: true,
        stdin: "ignore",
        ...(req.cwd ? { cwd: req.cwd } : {}),
      });

      const durationMs = result.durationMs ?? 0;

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

      const parsed = GrokJson.safeParse(
        safeJsonParse(result.stdout) ?? safeJsonParse(result.stderr),
      );
      if (!parsed.success) {
        return {
          ok: false,
          agent: this.name,
          text: "",
          exitCode: result.exitCode ?? -1,
          durationMs,
          timedOut: false,
          redactedCommand,
          error: `unparseable output: ${boundStderr(result.stderr) || "no json"}`,
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
        error: ok ? undefined : sanitizeGrokError(errorMessage(j.error), result.stderr),
      };
    },
  };
}
