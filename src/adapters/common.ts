import { existsSync } from "node:fs";

/**
 * The placeholder substituted for the prompt body in the redacted command (WR-04 / D-15). The
 * audit log records the real argv with ONLY this slot swapped, so the log never carries the
 * prompt body yet always reflects the actual flag set. Shared by every adapter so the redaction
 * convention can never drift per-vendor.
 */
export const PROMPT_PLACEHOLDER = "<prompt>";

/**
 * Split an injectable `bin` into an executable + leading args. The production default is the
 * bare vendor name (e.g. `"claude"` → `["claude", []]`), but the e2e harness injects a launcher
 * like `node /path/fake-claude.mjs`. execa takes a single executable plus an argv array (no shell
 * — T-01-05), so we split on the FIRST whitespace only: the leading token is the executable and
 * the remainder is treated as a SINGLE argument (the script path). Splitting only once keeps paths
 * that contain spaces (e.g. "Active Projects/…") intact. A bare vendor name has no whitespace →
 * `{ cmd:"<vendor>", preArgs:[] }`.
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
export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Build the redacted argv (real flags, prompt body replaced) from the spawned argv. Matches by
 * VALUE, so it works regardless of where the prompt sits in the argv (claude `-p <prompt> ...`,
 * codex trailing positional, gemini `-p <prompt> ...`). The redacted array is the SAME array the
 * adapter spawned with only the prompt slot swapped — one source of truth with the spawn.
 */
export function redactArgv(argv: string[], promptText: string): string[] {
  return argv.map((a) => (a === promptText ? PROMPT_PLACEHOLDER : a));
}
