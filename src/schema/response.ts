import { z } from "zod";

/**
 * One response to a reviewed issue (REVW-02), typed per-verdict via a discriminated union on
 * `verdict` (the config.ts discriminatedUnion idiom). The union structurally enforces the
 * case-study response contract: `reject-with-reason` REQUIRES a `reason`, `refine` REQUIRES a
 * `refinement`, `accept` needs neither. `issueRef` points back at a ReviewIssue.n.
 */
const Verdict = z.discriminatedUnion("verdict", [
  z.object({
    verdict: z.literal("accept"),
    issueRef: z.number().int().positive(),
  }),
  z.object({
    verdict: z.literal("reject-with-reason"),
    issueRef: z.number().int().positive(),
    reason: z.string().min(1),
  }),
  z.object({
    verdict: z.literal("refine"),
    issueRef: z.number().int().positive(),
    refinement: z.string().min(1),
  }),
]);

/**
 * A response-round artifact's frontmatter (REVW-02). `reviewOf` names the review artifact this
 * answers; `responses` must hold at least one verdict. Distinct from merging (the response round
 * produces a decision trail, not an integrated draft).
 */
export const ResponseFrontmatter = z.object({
  phase: z.literal("response"),
  author: z.string().min(1),
  reviewOf: z.string().min(1),
  responses: z.array(Verdict).min(1),
});

export type ResponseFrontmatter = z.infer<typeof ResponseFrontmatter>;
