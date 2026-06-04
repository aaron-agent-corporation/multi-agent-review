import { execa } from "execa";
import { CodexEvent, type TurnResult } from "../schema/turn.js";
import type { AgentAdapter, TurnRequest } from "./adapter.js";
import { redactArgv, safeJsonParse, splitBin } from "./common.js";

/**
 * Build the exact, pinned codex argv for headless NDJSON invocation (codex-cli 0.128.0,
 * LIVE-VERIFIED in RESEARCH.md). Pinned flags:
 *   --json                 → NDJSON on stdout (REQUIRED for parsing)
 *   --skip-git-repo-check  → codex normally refuses to run outside a git repo (T-02 — run dir
 *                            may not be a repo)
 *   --ephemeral            → no rollout/session-file litter per invocation
 *   -s read-only           → least-privilege sandbox; NEVER --dangerously-bypass-... (T-02-04)
 * `model` (factory-closure param) appends `-m <model>` before the prompt. The prompt is the
 * TRAILING positional (matters for redactArgv, which matches by value). The flag-pinning test
 * asserts this exact array so any drift fails loudly (Pitfall 7).
 */
function buildArgv(promptText: string, model?: string): string[] {
  const a = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only"];
  if (model) a.push("-m", model);
  a.push(promptText); // trailing positional → redactArgv swaps THIS for "<prompt>"
  return a;
}

/**
 * Create a codex {@link AgentAdapter}. `bin` is injectable so tests spawn the fake-codex fixture
 * instead of the real CLI (no credits burned); `model` is captured in closure and threaded into
 * the argv as `-m <model>` (PINNED model-param contract — registry threads it via
 * `makeAdapter(vendor, bin, model)`).
 *
 * Normalization follows the LIVE-VERIFIED codex ok-rule (RESEARCH):
 *   success = exitCode === 0 AND a `turn.completed` event was seen AND no `turn.failed` event.
 * Mirrors the Phase-1 claude discipline: require the POSITIVE terminal event + exit 0, never trust
 * a single ambiguous field. Final text = the last `agent_message` `item.completed` text. Codex
 * NDJSON event types/quirks MUST NOT leak past this adapter (D-12). Unparseable stdout (no terminal
 * event) becomes a graceful `ok:false`, never a crash (T-02-02). A hung process is bounded by
 * execa's wall-clock `timeout` + `forceKillAfterDelay`.
 */
export function makeCodexAdapter(bin = "codex", model?: string): AgentAdapter {
  return {
    name: "codex",
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
        // No shell (execa passes argv as an array) — prompt cannot inject shell commands (T-02-01).
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

      // Parse stdout NDJSON line-by-line; track the terminal event + last agent_message text.
      let completed = false;
      let failed = false;
      let lastText = "";
      let lastErr = "";
      for (const line of result.stdout.split("\n")) {
        if (!line.trim()) continue;
        const ev = CodexEvent.safeParse(safeJsonParse(line)); // zod, drift-safe .passthrough()
        if (!ev.success) continue;
        const e = ev.data;
        if (e.type === "item.completed" && e.item?.type === "agent_message") {
          lastText = e.item.text ?? "";
        } else if (e.type === "turn.completed") {
          completed = true;
        } else if (e.type === "turn.failed") {
          failed = true;
          lastErr = e.error?.message ?? "turn failed";
        } else if (e.type === "error") {
          lastErr = e.message ?? lastErr;
        }
      }

      // No parseable terminal event at all → unparseable output (mirror claude's branch).
      if (!completed && !failed) {
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

      // Codex ok-rule: exit 0 AND turn.completed seen AND no turn.failed.
      const ok = result.exitCode === 0 && completed && !failed;

      return {
        ok,
        agent: this.name,
        text: ok ? lastText : "",
        exitCode: result.exitCode ?? 0,
        durationMs,
        timedOut: false,
        redactedCommand,
        error: ok ? undefined : lastErr || "codex error",
      };
    },
  };
}
