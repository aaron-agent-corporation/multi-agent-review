import type { TurnResult } from "../schema/turn.js";

/**
 * Vendor-agnostic request the protocol layer hands to any adapter. NO vendor-specific
 * fields (D-12 / ARCHITECTURE Anti-Pattern 3) — every CLI is driven through this shape so
 * Phase 2 can add codex/gemini behind the same interface without touching the protocol.
 */
export interface TurnRequest {
  /** Logical agent name, e.g. "claude". */
  agent: string;
  /** The full prompt text to send to the CLI. */
  promptText: string;
  /** Run directory the invocation belongs to (`runs/<id>`). */
  runDir: string;
  /** Zero-based-or-more turn sequence number within the run. */
  seq: number;
  /** External wall-clock timeout in milliseconds (D-17). */
  timeoutMs: number;
  /**
   * Optional scoped working directory for the draft phase (PROT-04); omitted -> execa uses
   * process cwd (unchanged behavior). When set, the turn runs in a per-agent `work/<agent>/`
   * dir that physically lacks any peer's draft, making independence a filesystem fact.
   */
  cwd?: string;
  /**
   * Optional environment overlay for repo-local MAR credentials/config. Adapters merge this with
   * any vendor-specific env they already set and never include values in redacted commands.
   */
  env?: Record<string, string>;
}

/**
 * The single interface the protocol layer programs against. An adapter owns all
 * vendor-specific subprocess/flag/normalization details and returns a normalized,
 * zod-validated {@link TurnResult}.
 */
export interface AgentAdapter {
  readonly name: string;
  invoke(req: TurnRequest): Promise<TurnResult>;
}
