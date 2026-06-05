import { z } from "zod";

/**
 * The zod schema for the rolling `shared/resolved-decisions.md` ledger (D-63): the machine-readable
 * trail of settled forks that the majority tie-break (05-03) appends to and the re-litigation guard
 * (05-06) reads to refuse reopening a decision. It mirrors `schema/decision-record.ts ResolvedDecision`
 * (same id/summary/rationale/lineage shape) and ADDS the `resolver` provenance field (D-61): which
 * mechanism settled each fork.
 *
 * Everything is additive in the manifest-droppedAgents / decision-record style: `.min(1)` for required
 * non-empty strings, `.default([])` for collections, so a run with ZERO settled forks still produces a
 * parseable empty ledger (`{ runId, decisions: [] }`). The reader stays gray-matter READ-only; ledger
 * WRITES go through the hand-rolled injection-safe serializer in 05-06 — never `matter.stringify`
 * (T-04-07 / T-05-05).
 */

/** An artifact lineage reference (D-47), e.g. "002-codex-review.md issue 3". Mirrors decision-record. */
const LineageRef = z.string().min(1);

/**
 * Which mechanism resolved a fork (D-61). Modeled as a closed `z.enum` (the additive-enum style of
 * schema/manifest.ts status): `convergence` = unanimous agreement; `majority` = the >size/2 tie-break
 * (05-03, D-59); `integrator` = a single-integrator merge/drop ruling (D-44/D-64); `human` = an
 * arbitrated escalation (D-52). Adding a future resolver is an additive enum change — prior ledgers
 * carrying only today's values parse unchanged.
 */
export const Resolver = z.enum(["convergence", "majority", "integrator", "human"]);

export type Resolver = z.infer<typeof Resolver>;

/**
 * One settled decision in the rolling ledger. The contested-decision shape from
 * `schema/decision-record.ts ResolvedDecision` (id/summary/required-rationale/lineage[]) PLUS the
 * `resolver` provenance (D-61) so a later reader knows HOW it was settled (e.g. to weight a majority
 * resolution differently from a human ruling, or to enforce the re-litigation drop, D-64).
 */
export const ResolvedDecisionEntry = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  lineage: z.array(LineageRef).default([]),
  resolver: Resolver,
});

export type ResolvedDecisionEntry = z.infer<typeof ResolvedDecisionEntry>;

/**
 * The ledger frontmatter for `shared/resolved-decisions.md` (D-63). `runId` ties it to the run;
 * `decisions` is the rolling list of settled forks, defaulted additively so an empty ledger
 * (zero settled forks) is a valid, parseable artifact.
 */
export const ResolvedDecisionsLedger = z.object({
  runId: z.string().min(1),
  decisions: z.array(ResolvedDecisionEntry).default([]),
});

export type ResolvedDecisionsLedger = z.infer<typeof ResolvedDecisionsLedger>;
