import type { AgentAdapter } from "./adapter.js";
import { makeClaudeAdapter } from "./claude.js";
import { makeCodexAdapter } from "./codex.js";
import { makeGeminiAdapter } from "./gemini.js";
import { makeGrokAdapter } from "./grok.js";

/**
 * The vendor → adapter-factory map: the ORCH-03 seam. Adding a vendor is ONE entry here and zero
 * protocol-layer change (the protocol programs against the unchanged `AgentAdapter` contract). The
 * key set IS the supported-vendor set; `keyof typeof FACTORIES` rejects an invalid vendor at the
 * type boundary. Each factory defaults its own bin and captures an optional `model` in closure.
 */
export const FACTORIES = {
  claude: makeClaudeAdapter,
  codex: makeCodexAdapter,
  gemini: makeGeminiAdapter,
  grok: makeGrokAdapter,
} as const;

/**
 * Construct the adapter for `vendor`, threading the optional `bin` and `model` straight through to
 * the factory closure (PINNED model-param contract — Plan 03 supplies `entry.model`, Plan 05's CLI
 * threads it via `makeAdapter(vendor, bin, model)`). This is the single construction path the
 * roster/CLI/preflight use; no vendor branching lives anywhere else.
 */
export function makeAdapter(
  vendor: keyof typeof FACTORIES,
  bin?: string,
  model?: string,
): AgentAdapter {
  return FACTORIES[vendor](bin, model);
}
