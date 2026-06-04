import { existsSync } from "node:fs";
import { execa } from "execa";
import { ClaudeJson, type TurnResult } from "../schema/turn.js";
import type { AgentAdapter, TurnRequest } from "./adapter.js";

/**
 * Build the exact, pinned claude argv for headless JSON invocation.
 *
 * IMPORTANT: the config-isolation flag is deliberately OMITTED (D-09 amended / RESEARCH
 * Pitfall 1) — it reads ONLY `ANTHROPIC_API_KEY`/apiKeyHelper and breaks the machine's
 * subscription (OAuth/keychain) auth. The flag-pinning test asserts this exact array so a
 * future edit that drifts the flags fails loudly.
 */
function buildArgv(promptText: string): string[] {
  return ["-p", promptText, "--output-format", "json"];
}

/**
 * Split an injectable `bin` into an executable + leading args. The production default is the
 * bare `"claude"` (→ `["claude", []]`), but the e2e harness injects a launcher like
 * `node /path/fake-claude.mjs` via MAR_CLAUDE_BIN. execa takes a single executable plus an argv
 * array (no shell — T-01-05), so we split on the FIRST whitespace only: the leading token is the
 * executable and the remainder is treated as a SINGLE argument (the script path). Splitting only
 * once keeps paths that contain spaces (e.g. "Active Projects/…") intact. The production default
 * `"claude"` has no whitespace → `{ cmd:"claude", preArgs:[] }`.
 */
export function splitBin(bin: string): { cmd: string; preArgs: string[] } {
  const trimmed = bin.trim();
  // If the WHOLE value is itself an existing executable file (e.g. a fixture path that may
  // contain spaces), use it directly — never split it. This disambiguates a spaced path from a
  // `node <script>` launcher form.
  if (existsSync(trimmed)) return { cmd: trimmed, preArgs: [] };
  const i = trimmed.search(/\s/);
  if (i === -1) return { cmd: trimmed, preArgs: [] };
  return { cmd: trimmed.slice(0, i), preArgs: [trimmed.slice(i + 1).trim()] };
}

/** Parse JSON without throwing — returns `undefined` on any parse error. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Create a claude {@link AgentAdapter}. `bin` is injectable so tests spawn the fake-claude
 * fixture instead of the real CLI (no credits burned). Defaults to `"claude"` in production.
 *
 * Normalization follows the VERIFIED ok-rule (RESEARCH, claude 2.1.162):
 *   success = exitCode === 0 AND parsed.is_error === false (BOTH conditions).
 * The misleading `result.type` field is NEVER read — it reports a false-positive on a
 * not-logged-in failure (RESEARCH verified). Only exitCode + is_error decide success.
 * Unparseable stdout becomes a graceful `ok:false` TurnResult, never a crash (T-01-06).
 * A hung process is bounded by execa's wall-clock `timeout` + `forceKillAfterDelay` (T-01-07).
 */
export function makeClaudeAdapter(bin = "claude"): AgentAdapter {
  return {
    name: "claude",
    async invoke(req: TurnRequest): Promise<TurnResult> {
      const { cmd, preArgs } = splitBin(bin);
      const argv = [...preArgs, ...buildArgv(req.promptText)];
      const result = await execa(cmd, argv, {
        timeout: req.timeoutMs, // wall-clock ms; subprocess terminated on overrun (D-17)
        killSignal: "SIGTERM",
        forceKillAfterDelay: 5000, // SIGKILL escalation if it won't die
        reject: false, // resolve (don't throw) on non-zero exit → inspect uniformly
        cleanup: true, // kill child if our process exits
        // No shell (execa passes argv as an array) — prompt cannot inject shell commands (T-01-05).
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
          error: "timeout",
        };
      }

      // Parse + validate stdout. Unknown-flag errors emit NO JSON (stderr only) → graceful fail.
      const parsed = ClaudeJson.safeParse(safeJsonParse(result.stdout));
      if (!parsed.success) {
        return {
          ok: false,
          agent: this.name,
          text: "",
          exitCode: result.exitCode ?? -1,
          durationMs,
          timedOut: false,
          error: `unparseable output: ${result.stderr || "no json"}`,
        };
      }

      const j = parsed.data;
      // The verified ok-rule: BOTH exitCode 0 AND is_error false. Never branch on result.type.
      const ok = result.exitCode === 0 && j.is_error === false;

      return {
        ok,
        agent: this.name,
        text: ok ? (j.result ?? "") : "",
        exitCode: result.exitCode ?? 0,
        durationMs: j.duration_ms ?? durationMs,
        timedOut: false,
        costUsd: j.total_cost_usd,
        sessionId: j.session_id,
        structuredOutput: j.structured_output,
        error: ok ? undefined : (j.result ?? "claude error"),
      };
    },
  };
}
