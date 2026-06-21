import { z } from "zod";

/**
 * Evidence for a position in a convergence round (REVW-03). `artifact` is the peer artifact
 * being cited; `evidence` is the concrete excerpt or point from that artifact.
 */
export const EvaluationCitation = z.object({
  artifact: z.string().min(1),
  evidence: z.string().min(1),
});

export type EvaluationCitation = z.infer<typeof EvaluationCitation>;

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
  citations: z.array(EvaluationCitation).default([]),
});

export type EvaluationFrontmatter = z.infer<typeof EvaluationFrontmatter>;
