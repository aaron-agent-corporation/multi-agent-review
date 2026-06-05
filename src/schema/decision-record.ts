import { z } from "zod";
import { Resolver } from "./resolved-decisions.js";

/**
 * An artifact lineage reference (D-47): a pointer to the evidence trail behind a decision, e.g.
 * "002-codex-review.md issue 3".
 */
const LineageRef = z.string().min(1);

/**
 * A resolved (contested) decision (D-46 records contested decisions only; D-47 keeps per-decision
 * lineage). `rationale` is mandatory — a resolved decision without a recorded reason is malformed.
 * `lineage` defaults to [] (additive, manifest droppedAgents style). `resolver` (D-61/D-63) records
 * HOW the fork settled (convergence/majority/integrator/human); OPTIONAL + additive so the trail
 * re-derivation cross-check (which does not always know the resolver) and prior records parse
 * unchanged, while ledger-sourced entries (05-06) carry it.
 */
export const ResolvedDecision = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  lineage: z.array(LineageRef).default([]),
  resolver: Resolver.optional(),
});

export type ResolvedDecision = z.infer<typeof ResolvedDecision>;

/**
 * A re-litigation violation noted in the record (D-64): a later-phase position that reopened a settled
 * decision was DROPPED (drop + warn, no retry, run continues). The record notes it so the audit trail
 * shows the guard fired. Additive + defaulted so prior records parse unchanged.
 */
export const RelitigationViolation = z.object({
  artifactPath: z.string().min(1),
  relitigatedIds: z.array(z.string().min(1)).default([]),
  reason: z.literal("re-litigation"),
});

export type RelitigationViolation = z.infer<typeof RelitigationViolation>;

/**
 * An open decision (D-42 escalation): unresolved, carries the `reason` it could not be settled.
 */
export const OpenDecision = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  reason: z.string().min(1),
});

export type OpenDecision = z.infer<typeof OpenDecision>;

/**
 * The per-run decision record (RCRD-01, RSLV-01). `resolvedDecisions`/`openDecisions` carry the
 * contested-only trail; `unanimousTally` is the one-line count of non-contested agreements (D-46);
 * `runChain` records input → base → final lineage (D-47). All collections default additively so a
 * trivially-converged run still produces a parseable record.
 */
export const DecisionRecordFrontmatter = z.object({
  runId: z.string().min(1),
  resolvedDecisions: z.array(ResolvedDecision).default([]),
  openDecisions: z.array(OpenDecision).default([]),
  unanimousTally: z.number().int().min(0).default(0),
  runChain: z.array(z.string()).default([]),
  // Re-litigation drops (D-64): positions dropped for reopening a settled decision. Additive +
  // defaulted so prior records and runs with no violations parse unchanged.
  relitigationViolations: z.array(RelitigationViolation).default([]),
});

export type DecisionRecordFrontmatter = z.infer<typeof DecisionRecordFrontmatter>;
