import { z } from "zod";

/**
 * An evaluation-round artifact's frontmatter (REVW-03) — the convergence signal of the loop.
 * `round` disambiguates iterations (Pitfall 3: never reuse a round number); `proposedBase` is the
 * agreement-detection signal A3 (the agent whose draft this evaluator proposes as the integration
 * base). `remainingDisagreements` empty (all conceded) means convergence. `citations` are evidence
 * refs to peer artifacts; defaulted to [] (additive, like manifest droppedAgents).
 */
export const EvaluationFrontmatter = z.object({
  phase: z.literal("evaluation"),
  author: z.string().min(1),
  round: z.number().int().positive(),
  proposedBase: z.string().min(1),
  remainingDisagreements: z.array(z.string()),
  citations: z.array(z.string()).default([]),
});

export type EvaluationFrontmatter = z.infer<typeof EvaluationFrontmatter>;
