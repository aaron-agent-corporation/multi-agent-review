import { execa } from "execa";
import { GeminiJson, type TurnResult } from "../schema/turn.js";
import type { AgentAdapter, TurnRequest } from "./adapter.js";
import { redactArgv, safeJsonParse, splitBin } from "./common.js";

/**
 * Build the exact, pinned gemini argv for headless JSON invocation (gemini 0.45.0, LIVE-VERIFIED
 * flags in RESEARCH.md). Pinned flags:
 *   -p <prompt>             → non-interactive (headless); prompt is the value after -p
 *   --output-format json    → {response, stats, error?}
 *   --skip-trust            → REQUIRED: without it many dirs fail with exit 55 "not running in a
 *                             trusted directory" (T-02-05). NEVER --yolo / -y (read-only drafting).
 * `model` (factory-closure param) appends `-m <model>` (alias of --model). The flag-pinning test
 * asserts this exact array and that --yolo is absent so any drift fails loudly (Pitfall 6/7).
 */
function buildArgv(promptText: string, model?: string): string[] {
  const a = ["-p", promptText, "--output-format", "json", "--skip-trust"];
  if (model) a.push("-m", model);
  return a;
}

/**
 * Create a gemini {@link AgentAdapter}. Gemini is FIXTURE-BUILT (D-32): real gemini headless auth
 * is broken on this machine, so this adapter is built/tested ENTIRELY against fake-gemini.mjs and
 * CI must NOT gate on a live gemini success. `bin` is injectable; `model` is captured in closure
 * and threaded as `-m <model>` (PINNED model-param contract).
 *
 * Normalization follows the gemini ok-rule (RESEARCH):
 *   success = exitCode === 0 AND no `error` key AND `response` is a string.
 * CRITICAL (Pitfall 3): the error JSON routes to STDERR on the auth-failure path, so the adapter
 * parses stdout-OR-stderr before declaring "unparseable." Exit codes are NOT allowlisted — the
 * undocumented 41/55 are observed live; success is keyed off error/response/exit-0, not a magic
 * set. Gemini quirks MUST NOT leak past this adapter (D-12). Unparseable output → graceful
 * `ok:false`; a hung process is bounded by execa's `timeout` + `forceKillAfterDelay`.
 */
export function makeGeminiAdapter(bin = "gemini", model?: string): AgentAdapter {
  return {
    name: "gemini",
    async invoke(req: TurnRequest): Promise<TurnResult> {
      const { cmd, preArgs } = splitBin(bin);
      const argv = [...preArgs, ...buildArgv(req.promptText, model)];
      // WR-04: the redacted argv (prompt body → placeholder) is the SAME array we spawn.
      const redactedCommand = redactArgv(argv, req.promptText);
      const result = await execa(cmd, argv, {
        timeout: req.timeoutMs, // wall-clock ms; subprocess terminated on overrun (D-17)
        killSignal: "SIGTERM",
        forceKillAfterDelay: 5000, // SIGKILL escalation if it won't die
        reject: false, // resolve (don't throw) on non-zero exit → inspect uniformly
        cleanup: true, // kill child if our process exits
        // Close stdin (02-05 live fix, uniform across adapters): the prompt is an argv value, never
        // stdin. gemini also reads piped stdin when present — leaving execa's default open pipe risks
        // the same block codex exhibited. `stdin:"ignore"` makes the CLI see EOF and proceed.
        stdin: "ignore",
        // No shell (execa passes argv as an array) — prompt cannot inject shell commands (T-02-01).
        // PROT-04: scoped draft-phase cwd, conditionally spread LAST so the absent case spawns the
        // EXACT same options as today (omit when unset → unchanged behavior).
        ...(req.cwd ? { cwd: req.cwd } : {}),
      });

      const durationMs = result.durationMs ?? 0;

      // Timeout (or forced kill) → reported as timedOut, never trusts stdout.
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

      // CRITICAL: gemini's error JSON routes to STDERR on the auth-failure path → try both.
      const parsed = GeminiJson.safeParse(
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
          error: `unparseable output: ${result.stderr || "no json"}`,
        };
      }

      const j = parsed.data;
      // Gemini ok-rule: exit 0 AND no error key AND a response string. Do NOT allowlist exit codes.
      const ok = result.exitCode === 0 && j.error == null && typeof j.response === "string";

      return {
        ok,
        agent: this.name,
        text: ok ? (j.response ?? "") : "",
        exitCode: result.exitCode ?? 0,
        durationMs,
        timedOut: false,
        redactedCommand,
        sessionId: j.session_id,
        error: ok ? undefined : (j.error?.message ?? result.stderr ?? "gemini error"),
      };
    },
  };
}
