import type { z } from "zod";
import { EvaluationFrontmatter } from "../schema/evaluation.js";
import { IntegrationFrontmatter } from "../schema/integration.js";
import { ResponseFrontmatter } from "../schema/response.js";
import { ReviewFrontmatter } from "../schema/review.js";

/**
 * The 6-phase review protocol as TYPED DATA, not control flow (RESEARCH Pattern 1). Mirrors the
 * `as const` descriptor-table idiom from adapters/registry.ts: a frozen array the engine iterates,
 * never a hand-rolled switch. Each phase's `kind` feeds straight into
 * artifactName(seq, agent, kind) (layout.ts), so kind === name keeps artifact filenames aligned
 * with the phase that produced them.
 *
 * `scoped` is true ONLY for "draft" — the one phase that runs each agent in an isolated cwd
 * (PROT-04 independence boundary). `participants` is "all" for every phase EXCEPT "integration",
 * which flips to "integrator" so exactly one agent writes the merged document (REVW-04).
 */

/**
 * What a phase prompt needs to compose a THIN per-turn prompt (D-37). Deliberately minimal: the
 * format contract (frontmatter shapes, severities, verdict vocabulary) lives in the seeded
 * instruction file (04-02), NOT in the prompt — stuffing the format into the prompt is an
 * anti-pattern that duplicates the contract and invites drift.
 */
export interface PhasePromptCtx {
  readonly inputPath: string;
  readonly phaseName: string;
}

/**
 * A thin, machine-tag-prefixed prompt: `[phase:<name>] <instruction>`. The leading tag is the ONLY
 * structured token in the prompt — it lets a hermetic fixture know which phase it is answering
 * (so it can emit the matching schema-valid frontmatter, D-49) without the prompt carrying the
 * format contract itself. The tag is the phase NAME, never the format vocabulary (no P1/severity/
 * verdict tokens), so the contract still lives solely in the seeded instruction file (D-37).
 */
function thinPrompt(phaseName: string, instruction: string): string {
  return `[phase:${phaseName}] ${instruction}`;
}

/** The outcome of validating a turn's frontmatter against a phase's zod schema (D-38). */
export type PhaseValidation = { ok: true } | { ok: false; errors: string };

export interface Phase {
  readonly name: "draft" | "review" | "response" | "evaluation" | "integration" | "validation";
  readonly kind: string;
  readonly scoped: boolean;
  readonly participants: "all" | "integrator";
  /** Thin per-phase prompt referencing the seeded instruction file (D-37). No format-stuffing. */
  readonly prompt: (ctx: PhasePromptCtx) => string;
  /**
   * Optional zod gate for the turn's parsed frontmatter (D-38). Present for the structured phases
   * (review/response/evaluation/integration); absent for draft/validation. On failure it returns
   * the formatted zod issues so the engine can feed them back into the single retry.
   */
  readonly validate?: (frontmatter: unknown) => PhaseValidation;
}

/**
 * Format zod issues as `path: message` lines — the SAME shape config.ts's formatIssues produces, so
 * the validation-retry error block fed back to the agent matches the roster-validation convention.
 */
function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length > 0 ? i.path.join(".") : "(root)";
      return `  ${path}: ${i.message}`;
    })
    .join("\n");
}

/** Wrap a zod schema into a Phase.validate function (safeParse → {ok} | {ok,errors}). */
function makeValidator(schema: z.ZodTypeAny): (frontmatter: unknown) => PhaseValidation {
  return (frontmatter: unknown): PhaseValidation => {
    const parsed = schema.safeParse(frontmatter);
    if (parsed.success) return { ok: true };
    return { ok: false, errors: formatIssues(parsed.error) };
  };
}

export const PHASES: readonly Phase[] = [
  {
    name: "draft",
    kind: "draft",
    scoped: true,
    participants: "all",
    prompt: (ctx) => thinPrompt(ctx.phaseName, "Draft the document per your seeded instructions."),
  },
  {
    name: "review",
    kind: "review",
    scoped: false,
    participants: "all",
    prompt: (ctx) =>
      thinPrompt(
        ctx.phaseName,
        "Review the peer drafts in this folder per your seeded instructions.",
      ),
    validate: makeValidator(ReviewFrontmatter),
  },
  {
    name: "response",
    kind: "response",
    scoped: false,
    participants: "all",
    prompt: (ctx) =>
      thinPrompt(
        ctx.phaseName,
        "Respond to the reviews of your draft per your seeded instructions.",
      ),
    validate: makeValidator(ResponseFrontmatter),
  },
  {
    name: "evaluation",
    kind: "evaluation",
    scoped: false,
    participants: "all",
    prompt: (ctx) =>
      thinPrompt(
        ctx.phaseName,
        "Evaluate the responses and propose a base per your seeded instructions.",
      ),
    validate: makeValidator(EvaluationFrontmatter),
  },
  {
    name: "integration",
    kind: "integration",
    scoped: false,
    participants: "integrator",
    prompt: (ctx) =>
      thinPrompt(
        ctx.phaseName,
        "Integrate the agreed additions into the base per your seeded instructions.",
      ),
    validate: makeValidator(IntegrationFrontmatter),
  },
  {
    name: "validation",
    kind: "validation",
    scoped: false,
    participants: "all",
    prompt: (ctx) =>
      thinPrompt(ctx.phaseName, "Validate the integrated document per your seeded instructions."),
  },
] as const;
