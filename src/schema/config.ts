import { z } from "zod";

/**
 * Shared base fields for every roster agent entry (D-19). `vendor` is the discriminator
 * (added per-variant below); `bin` overrides the binary (supports fake-CLI test injection);
 * `extraArgs` are append-only vendor flags — adapters own the command shape, so config can
 * never break argv safety.
 */
const Base = {
  name: z.string().min(1),
  bin: z.string().optional(),
  model: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  extraArgs: z.array(z.string()).optional(),
};

/**
 * One roster agent, typed per-vendor via a discriminated union on `vendor` (RESEARCH Pattern 4).
 * Adding a vendor = adding a literal variant here — no protocol-layer change (ORCH-03).
 */
const Agent = z.discriminatedUnion("vendor", [
  z.object({ vendor: z.literal("claude"), ...Base }),
  z.object({ vendor: z.literal("codex"), ...Base }),
  z.object({ vendor: z.literal("gemini"), ...Base }),
]);

/**
 * The roster (`mar.config.json`). `agents` requires at least one entry; `defaults` supplies the
 * timeout/retry budget (retries default 2 per D-23 — the discussion settled on 2 even though the
 * CONTEXT example shows 1).
 *
 * NOTE: the >=2-vendor rule is a run-start GATE (gates.ts / ORCH-04 / D-29), NOT a config-load
 * error — a single-vendor config is legitimate for `mar invoke` (D-29 exemption). Do NOT enforce
 * a vendor count here.
 *
 * `defaults` uses `.prefault({})` (NOT `.default({})`): zod v4's `.default()` returns the literal
 * value without re-parsing, so nested field defaults (timeoutMs/retries) would NOT fire. `prefault`
 * runs the fallback through parse so the inner defaults apply when `defaults` is omitted.
 */
export const MarConfig = z
  .object({
    agents: z.array(Agent).min(1),
    defaults: z
      .object({
        timeoutMs: z.number().int().positive().default(600_000),
        retries: z.number().int().min(0).default(2),
      })
      .prefault({}),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const a of c.agents) {
      if (seen.has(a.name)) dup.add(a.name);
      seen.add(a.name);
    }
    if (dup.size > 0) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate agent name(s): ${[...dup].join(", ")}`,
        path: ["agents"],
      });
    }
  });

export type MarConfig = z.infer<typeof MarConfig>;
export type AgentEntry = z.infer<typeof Agent>;
