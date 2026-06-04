import { z } from "zod";

/**
 * One per-agent pre-flight result (D-26/D-28). `installed` = tier-1 (binary on PATH + `--version`
 * parsed); `responsive` = tier-2 (a tiny live "pong" probe proving auth + responsiveness). `version`
 * is the extracted semver (Pitfall-2-safe per-vendor extraction). `latencyMs` is the probe round-trip
 * (durationMs from the adapter). `hint` is a FIXED, actionable failure string keyed off the failure
 * class — it NAMES env vars / commands, never echoes a secret value or raw stderr verbatim (T-02-15).
 */
export const PreflightResult = z.object({
  name: z.string(),
  vendor: z.enum(["claude", "codex", "gemini"]),
  installed: z.boolean(),
  version: z.string().optional(),
  responsive: z.boolean(),
  latencyMs: z.number().optional(),
  hint: z.string().optional(),
});

export type PreflightResult = z.infer<typeof PreflightResult>;

/**
 * The machine-readable pre-flight cache (`.mar/preflight.json`, gitignored, written via atomic
 * temp+rename — D-27). Lives OUTSIDE runs/ because it is machine state, not run-artifact lineage.
 * `checkedAt` (ISO) drives the ~10-min TTL (isFresh): a stale cache forces a re-probe at run-start
 * (Phase 3) so a poisoned/stale cache can't gate an unhealthy roster past its trust window (T-02-14).
 * Validated by `PreflightCache.parse` on both write and read.
 */
export const PreflightCache = z.object({
  checkedAt: z.string(),
  results: z.array(PreflightResult),
});

export type PreflightCache = z.infer<typeof PreflightCache>;
