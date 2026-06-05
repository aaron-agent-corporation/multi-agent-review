import { z } from "zod";

/**
 * One numbered issue raised in a cross-review (REVW-01). `n` is the issue number a downstream
 * response references via `issueRef`; `severity` is the P1-P3 triage band; `question` is the
 * single concrete question the case-study protocol mandates per issue (no vague critiques).
 */
export const ReviewIssue = z.object({
  n: z.number().int().positive(),
  severity: z.enum(["P1", "P2", "P3"]),
  question: z.string().min(1),
});

export type ReviewIssue = z.infer<typeof ReviewIssue>;

/**
 * A structured cross-review artifact's frontmatter (REVW-01). `targets` is the routing key
 * (Pattern 4): which peer draft this review critiques. `issues` must hold at least one entry,
 * and a `.superRefine` rejects duplicate issue numbers exactly as config.ts rejects duplicate
 * agent names — so `issueRef` resolution downstream is unambiguous. Typed errors from a failed
 * safeParse feed the D-38 malformed-output retry.
 */
export const ReviewFrontmatter = z
  .object({
    phase: z.literal("review"),
    author: z.string().min(1),
    targets: z.string().min(1),
    issues: z.array(ReviewIssue).min(1),
  })
  .superRefine((r, ctx) => {
    const seen = new Set<number>();
    const dup = new Set<number>();
    for (const issue of r.issues) {
      if (seen.has(issue.n)) dup.add(issue.n);
      seen.add(issue.n);
    }
    if (dup.size > 0) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate issue number(s): ${[...dup].join(", ")}`,
        path: ["issues"],
      });
    }
  });

export type ReviewFrontmatter = z.infer<typeof ReviewFrontmatter>;
