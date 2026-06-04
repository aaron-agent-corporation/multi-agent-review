import type { TurnResult } from "./schema/turn.js";

/**
 * The ONE vendor-agnostic retry seam (D-24) wrapping any adapter's `invoke`. This file holds:
 *   - per-vendor transient-vs-fatal classifiers (D-22), and
 *   - the bounded backoff loop `withRetry` (D-23/25).
 *
 * Classifiers read ONLY normalized signals (`timedOut`, `error`, `exitCode`) — never re-parse
 * raw CLI output (that already happened in the adapter, D-12). String sets are LIVE-VERIFIED in
 * 02-RESEARCH.md against codex 0.128.0 / gemini 0.45.0 / claude 2.1.162.
 */

/** Verdict a classifier returns for a failed TurnResult. */
export type Classification = "transient" | "fatal";

/** A per-vendor classifier: given a (failed) TurnResult, decide whether retrying could help. */
export type Classify = (t: TurnResult) => Classification;

/**
 * Tokens that ALWAYS mean "retrying could help" regardless of vendor: a hang, a parse fluke,
 * or any rate-limit / overload signal. Matched case-insensitively against `t.error`.
 */
const COMMON_TRANSIENT =
  /(429|resource_exhausted|rate.?limit|usage.?limit|too many requests|quota|overloaded|503|529|unparseable)/i;

/**
 * Shared classification core. Order matters: a hang (timedOut) and an unparseable-output fluke
 * are transient even if no transient token is present; then explicit transient tokens; then
 * vendor-specific fatal tokens; otherwise DEFAULT TO FATAL — an unclassified clean error won't
 * be fixed by re-running, so we never waste a retry on it (D-22).
 */
function classify(t: TurnResult, fatalTokens: RegExp): Classification {
  if (t.timedOut) return "transient"; // a hang is retryable
  const err = t.error ?? "";
  if (/unparseable/i.test(err)) return "transient"; // parse fluke (re-run may succeed)
  if (COMMON_TRANSIENT.test(err)) return "transient";
  if (fatalTokens.test(err)) return "fatal";
  return "fatal"; // unclassified clean error -> never retry
}

/**
 * Codex (0.128.0) fatal tokens: auth / bad-model / clean request errors. 401 & invalid-model are
 * LIVE-VERIFIED; re-running never fixes login or an unsupported model (D-22).
 */
const CODEX_FATAL =
  /(401|unauthorized|missing bearer|not logged in|invalid_request_error|model is not supported)/i;

export function classifyCodex(t: TurnResult): Classification {
  return classify(t, CODEX_FATAL);
}

/**
 * Gemini (0.45.0) fatal tokens: the LIVE-VERIFIED exit-41/55 auth + trusted-directory strings,
 * plus project-id and invalid-API-key. Note: a FIRST gemini 429 is NOT fatal (false-positive
 * #17906) — it matches COMMON_TRANSIENT and the bounded loop handles it.
 */
const GEMINI_FATAL =
  /(auth method|unauthorized|projectidrequired|trusted directory|api key not valid)/i;

export function classifyGemini(t: TurnResult): Classification {
  return classify(t, GEMINI_FATAL);
}

/** Claude (2.1.162) fatal tokens: login state. "overloaded"/529 are transient via COMMON. */
const CLAUDE_FATAL = /(not logged in|unauthorized|invalid api key)/i;

export function classifyClaude(t: TurnResult): Classification {
  return classify(t, CLAUDE_FATAL);
}
