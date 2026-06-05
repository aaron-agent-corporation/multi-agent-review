import { setTimeout as sleep } from "node:timers/promises";
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

/** Default retry budget (D-23): 2 retries == 3 total attempts. */
export const DEFAULT_RETRIES = 2;
/** Default exponential-backoff base (~15s) and cap (~60s) per D-23. */
export const DEFAULT_BASE_MS = 15_000;
export const DEFAULT_MAX_MS = 60_000;

export interface WithRetryOptions {
  /** Number of RETRIES (total attempts = retries + 1). Default 2 (D-23). */
  retries: number;
  /** Per-vendor transient-vs-fatal verdict on a failed result (D-22). */
  classify: Classify;
  /** Called for EVERY attempt incl. failures, with the 1-based attempt # (D-25). */
  onAttempt: (t: TurnResult, attempt: number) => void;
  /** Exponential-backoff base in ms (default ~15s). */
  baseMs?: number;
  /** Backoff cap in ms (default ~60s). */
  maxMs?: number;
  /** Optional provider retry-after hint (ms); when returned, it OVERRIDES the computed backoff. */
  retryAfterMs?: (t: TurnResult) => number | undefined;
}

/**
 * The ONE vendor-agnostic bounded retry wrapper (D-24) around any adapter `invoke`.
 *
 * Policy (RESEARCH Pattern 3, D-22..25): run attempts 1..retries+1; log EVERY attempt (incl.
 * failures) via `onAttempt`; return immediately on success OR on a fatal classification (never
 * retry auth/clean errors); on a transient failure with budget remaining, sleep
 * `retryAfterMs ?? (exponential backoff + jitter)` and try again. Returns the last TurnResult
 * when the budget is exhausted. Backoff sleeps use `node:timers/promises` — no new dependency
 * (D-35) and fully fake-timer-testable (no real 15-60s waits in the suite).
 */
export async function withRetry(
  invoke: () => Promise<TurnResult>,
  opts: WithRetryOptions,
): Promise<TurnResult> {
  const base = opts.baseMs ?? DEFAULT_BASE_MS;
  const cap = opts.maxMs ?? DEFAULT_MAX_MS;
  let last!: TurnResult;
  for (let attempt = 1; attempt <= opts.retries + 1; attempt++) {
    last = await invoke();
    opts.onAttempt(last, attempt); // log EVERY attempt incl. failures (D-25)
    if (last.ok) return last;
    if (opts.classify(last) === "fatal") return last; // never retry auth/clean errors (D-22)
    if (attempt > opts.retries) return last; // budget exhausted
    const ra = opts.retryAfterMs?.(last); // honor provider retry-after if present
    // WR-01: jitter is added to the RAW exponential value and the cap is applied to the TOTAL, so
    // `cap` is a true ceiling on the wait. (Previously the cap was applied first and jitter added
    // after, letting an actual sleep reach 1.5×cap — the documented `maxMs` was not a real bound.)
    const raw = base * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * (raw / 2));
    await sleep(ra ?? Math.min(cap, raw + jitter));
  }
  return last;
}
