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
