import { z } from "zod";

/**
 * One per-addition verdict in an integration artifact (REVW-04). The single integrator decides,
 * per proposed addition, whether it is merged into the base. `additionRef` points at the source
 * addition (e.g. a review issue or a draft section); `verdict` is the merge decision; a
 * `merged-with-change` verdict REQUIRES a `change` note explaining what was altered, mirroring the
 * response schema's "reject-with-reason requires reason" discriminated-union contract.
 */
const AdditionVerdict = z.discriminatedUnion("verdict", [
  z.object({
    verdict: z.literal("merged"),
    additionRef: z.string().min(1),
  }),
  z.object({
    verdict: z.literal("merged-with-change"),
    additionRef: z.string().min(1),
    change: z.string().min(1),
  }),
  z.object({
    verdict: z.literal("dropped"),
    additionRef: z.string().min(1),
    reason: z.string().min(1),
  }),
]);

/**
 * The integration artifact's frontmatter (REVW-04). Produced by exactly ONE integrator (the gate
 * enforces a single writer). `base` names the draft chosen as the merge base; `additions` carries
 * at least one per-addition verdict so the merge decision trail is auditable. The merged document
 * body lives in the markdown body, not frontmatter.
 */
export const IntegrationFrontmatter = z.object({
  phase: z.literal("integration"),
  author: z.string().min(1),
  base: z.string().min(1),
  additions: z.array(AdditionVerdict).min(1),
});

export type IntegrationFrontmatter = z.infer<typeof IntegrationFrontmatter>;
