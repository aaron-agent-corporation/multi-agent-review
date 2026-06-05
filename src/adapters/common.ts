import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

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
  // If the WHOLE value LOOKS like a path (absolute, or contains a separator) AND that path exists,
  // use it directly — never split it. This disambiguates a spaced path from a `node <script>`
  // launcher form. WR-06: the path-shape guard is REQUIRED — without it, a bare vendor name like
  // "claude" would resolve to the relative `./claude` whenever the cwd happens to contain a file
  // named `claude` (a cwd-driven path-confusion footgun). A bare name now always flows to PATH
  // resolution by execa.
  const looksLikePath = isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\");
  if (looksLikePath && existsSync(trimmed)) return { cmd: trimmed, preArgs: [] };
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
 * Build the redacted argv by POSITION (WR-02). Only the single slot at `promptIndex` is replaced
 * with {@link PROMPT_PLACEHOLDER}; every other element is copied verbatim. The prompt index is
 * known at build time per adapter (claude/gemini: the slot after `-p`; codex: the trailing
 * positional), so the redaction is exact regardless of the prompt's content.
 *
 * This replaces the older value-based redaction, which rewrote EVERY argv element equal to the
 * prompt text. A prompt that happened to equal a pinned flag value (e.g. `--prompt json`,
 * `--prompt read-only`, or a prompt equal to the configured model name) would corrupt the
 * recorded `redactedCommand`, defeating the "single source of truth with the spawn" guarantee
 * (it never leaked the prompt, but it did misreport the actual flag set in the audit log).
 *
 * The returned array is the SAME array the adapter spawned with only the prompt slot swapped.
 */
export function redactArgvAt(argv: string[], promptIndex: number): string[] {
  if (promptIndex < 0 || promptIndex >= argv.length) {
    // Defensive: an out-of-range index means the caller miscomputed the slot. Never spawn the
    // prompt unredacted into the audit log — fail loudly instead of silently logging it.
    throw new Error(
      `redactArgvAt: promptIndex ${promptIndex} out of range for argv of length ${argv.length}`,
    );
  }
  return argv.map((a, i) => (i === promptIndex ? PROMPT_PLACEHOLDER : a));
}
