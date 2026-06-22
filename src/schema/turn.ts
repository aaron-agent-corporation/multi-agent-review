import { z } from "zod";

/**
 * Raw `claude -p --output-format json` shape (claude 2.1.162, verified live in RESEARCH.md).
 * Only the fields we consume are declared; `.passthrough()` tolerates vendor key drift so a
 * new/extra key never fails validation (Pitfall 1). This type is claude-specific and MUST NOT
 * leak past the adapter boundary (D-12).
 */
export const ClaudeJson = z
  .object({
    is_error: z.boolean(),
    result: z.string().optional(), // text answer (absent on some errors)
    session_id: z.string().optional(),
    total_cost_usd: z.number().optional(),
    duration_ms: z.number().optional(),
    structured_output: z.unknown().optional(), // present only with --json-schema
    usage: z.unknown().optional(),
  })
  .passthrough();

export type ClaudeJson = z.infer<typeof ClaudeJson>;

/**
 * One `codex exec --json` NDJSON event (codex-cli 0.128.0, verified live in RESEARCH.md). Codex
 * emits one JSON object per stdout line; the adapter parses each line and keys success off the
 * terminal `turn.completed`/`turn.failed` event. Only the consumed fields are declared;
 * `.passthrough()` tolerates new event types / vendor key drift (Pitfall 1/7). Codex-specific —
 * MUST NOT leak past the adapter boundary (D-12).
 */
export const CodexEvent = z
  .object({
    type: z.string(),
    item: z.object({ type: z.string(), text: z.string().optional() }).partial().optional(),
    error: z.object({ message: z.string() }).partial().optional(),
    message: z.string().optional(),
    usage: z.unknown().optional(),
  })
  .passthrough();

export type CodexEvent = z.infer<typeof CodexEvent>;

/**
 * Raw `gemini -p --output-format json` shape (gemini 0.45.0; success shape per docs, failure
 * shapes verified live in RESEARCH.md). `error` is present ONLY on failure and — on the
 * auth-failure path — the whole object routes to STDERR (the adapter parses stdout-OR-stderr,
 * Pitfall 3). Only consumed fields declared; `.passthrough()` tolerates drift. Gemini-specific —
 * MUST NOT leak past the adapter boundary (D-12).
 */
export const GeminiJson = z
  .object({
    response: z.string().optional(), // present on success
    stats: z.unknown().optional(),
    session_id: z.string().optional(),
    error: z
      .object({
        type: z.string().optional(),
        message: z.string(),
        code: z.number().optional(),
      })
      .optional(), // present only on failure
  })
  .passthrough();

export type GeminiJson = z.infer<typeof GeminiJson>;

/**
 * Raw `grok -p --output-format json` shape. The xAI docs guarantee a final JSON object for
 * `--output-format json`; the exact text field may drift, so the adapter accepts the common
 * `response`/`result`/`text` spellings and normalizes back to TurnResult. Grok-specific fields
 * MUST NOT leak past the adapter boundary (D-12).
 */
export const GrokJson = z
  .object({
    response: z.string().optional(),
    result: z.string().optional(),
    text: z.string().optional(),
    session_id: z.string().optional(),
    sessionId: z.string().optional(),
    error: z
      .union([
        z.string(),
        z
          .object({
            message: z.string().optional(),
            type: z.string().optional(),
            code: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough(),
      ])
      .optional(),
  })
  .passthrough();

export type GrokJson = z.infer<typeof GrokJson>;

/**
 * Vendor-agnostic normalized result the protocol layer sees (D-12). No claude-specific
 * field names — camelCase metadata only. `text` is "" on failure.
 */
export const TurnResult = z.object({
  ok: z.boolean(),
  agent: z.string(),
  text: z.string(),
  exitCode: z.number(),
  durationMs: z.number(),
  timedOut: z.boolean(),
  /**
   * The EXACT argv the adapter spawned, with the prompt body replaced by a placeholder
   * (WR-04 / D-15). This is the single source of truth for the audit log: the CLI logs this
   * verbatim instead of hand-rebuilding the flag set, so the log can never silently diverge
   * from what was actually executed. The prompt body is NEVER present here.
   */
  redactedCommand: z.array(z.string()),
  costUsd: z.number().optional(),
  sessionId: z.string().optional(),
  structuredOutput: z.unknown().optional(),
  error: z.string().optional(), // e.g. "Not logged in", "timeout", "unparseable output"
});

export type TurnResult = z.infer<typeof TurnResult>;
