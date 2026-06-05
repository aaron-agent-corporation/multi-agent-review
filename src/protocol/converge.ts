import { join } from "node:path";
import type { AgentEntry } from "../schema/config.js";
import { EvaluationFrontmatter } from "../schema/evaluation.js";
import { readManifest } from "../workspace/manifest.js";
import { type ProtocolInput, runPhase } from "./engine.js";
import { readAgentFrontmatter } from "./frontmatter.js";
import { PHASES, type Phase } from "./phases.js";

/**
 * The result of the bounded evaluation convergence loop (D-40/41/43). The decision-record writer in
 * 04-05 reads `concessions` and `openDecision` from this object; the engine threads `base` +
 * `integrator` into machine context and uses `status` to pick the run's terminal status.
 *
 * - `agreed`: all surviving agents converged on the same `proposedBase` with no open disagreements.
 *   `integrator` is that base's author (D-44) — exactly one writer for the integration phase.
 * - `escalated`: the loop hit the iteration cap (D-41c) or an explicit unresolvable deadlock
 *   (D-41b). Per O-2 reading (a) the run STILL yields a usable artifact: a provisional fallback base
 *   (the most-supported proposedBase) is chosen, its author designated integrator, and the
 *   unresolved fork recorded as an `openDecision` for post-run human review (D-42, autonomous-only).
 */
export interface ConvergenceResult {
  /** The agreed (or fallback) base draft's author. */
  base: string;
  /** The single designated integrator — the base author (D-44). */
  integrator: string;
  /** How many evaluation rounds ran before the loop exited. */
  rounds: number;
  /** Status: unanimous agreement vs. an escalated cap/deadlock exit (O-2 (a) fallback). */
  status: "agreed" | "escalated";
  /** Disagreements conceded across rounds, threaded to the 04-05 decision record (RSLV-01). */
  concessions: string[];
  /** Present only on `escalated`: the unresolved fork flagged for human review (D-42). */
  openDecision?: { reason: string };
  /**
   * Which mechanism settled this resolution (D-61), mirroring `schema/resolved-decisions.ts Resolver`
   * (the vocabulary is single-sourced there as a zod enum; this is the structural TS union of the same
   * members). Additive/optional like `openDecision`. `convergence` = unanimous agreement (Guard 1);
   * `majority` = the post-cap/deadlock `> rosterSize/2` clear-majority tie-break (D-59). The escalate
   * fallback path leaves this UNSET — no clear majority settled it. The 05-06 decision-record sources
   * this provenance.
   */
  resolver?: "convergence" | "majority" | "integrator" | "human";
}

/**
 * One agent's parsed evaluation signal for a round, read from disk (filesystem-as-truth, A3). We
 * NEVER trust a model's prose self-report of "we agree" — agreement is computed from the validated
 * `proposedBase` + `remainingDisagreements` fields of the round's evaluation artifacts.
 */
interface RoundSignal {
  author: string;
  proposedBase: string;
  remainingDisagreements: string[];
}

/**
 * The kind written for round `n` of the convergence loop. Disambiguating the kind per round
 * (`evaluation-r1`, `evaluation-r2`, …) prevents the Pitfall-3 seq/filename collision that a fixed
 * `evaluation` kind would cause when the SAME phase runs multiple times — each round's artifacts get
 * a distinct `<seq>-<agent>-evaluation-r<n>.md` name, so a later round can never overwrite an earlier
 * one and lineage refs always point at the right round. The manifest `kind` is `z.string()`, so these
 * per-round kinds parse unchanged.
 */
function roundKind(round: number): string {
  return `evaluation-r${round}`;
}

/**
 * Build the Phase descriptor for evaluation round `n`: the canonical evaluation phase (its thin
 * prompt + the D-38 EvaluationFrontmatter validator) with the per-round `kind` so round artifacts
 * don't collide. The validate gate still runs per turn, so a malformed round artifact is retried
 * once then dropped exactly like every other structured phase.
 */
function roundPhase(round: number): Phase {
  const evaluation = PHASES.find((p) => p.name === "evaluation");
  if (!evaluation) throw new Error("evaluation phase descriptor missing from PHASES");
  return { ...evaluation, kind: roundKind(round) };
}

/**
 * Read the agent's emitted evaluation frontmatter back from a written round artifact. Delegates the
 * WHERE-is-the-frontmatter read to the ONE shared tolerant reader (`readAgentFrontmatter`, Pitfall 4):
 * it strips the engine-metadata wrapper and tolerantly finds the agent's frontmatter even when the
 * model emitted preamble prose before it — the previous strict double-parse here would have silently
 * returned empty data for such an artifact. Schema validation stays STRICT (fail-closed, D-38): the
 * EvaluationFrontmatter.safeParse below is unchanged, so a missing/malformed signal still returns null
 * (a non-signal — that agent simply does not count toward agreement this round).
 */
async function readEvaluationSignal(path: string): Promise<RoundSignal | null> {
  const data = await readAgentFrontmatter(path);
  if (data === null) return null;
  const parsed = EvaluationFrontmatter.safeParse(data);
  if (!parsed.success) return null;
  return {
    author: parsed.data.author,
    proposedBase: parsed.data.proposedBase,
    remainingDisagreements: parsed.data.remainingDisagreements,
  };
}

/**
 * Collect the evaluation signals written THIS round. We re-read the manifest fresh (so the round's
 * just-appended artifacts are visible) and select the entries whose kind matches this round's
 * disambiguated kind, then parse each one's agent frontmatter from disk. Reading the manifest+disk
 * (never the model's prose) is the A3 filesystem-as-truth contract.
 */
async function collectRoundSignals(runDir: string, round: number): Promise<RoundSignal[]> {
  const manifest = await readManifest(runDir);
  const kind = roundKind(round);
  const paths = manifest.artifacts.filter((a) => a.kind === kind).map((a) => join(runDir, a.path));
  const signals = await Promise.all(paths.map((p) => readEvaluationSignal(p)));
  return signals.filter((s): s is RoundSignal => s !== null);
}

/** Tally how many survivors proposed each base this round; the most-supported base wins ties by count. */
function tallyBases(signals: RoundSignal[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const s of signals) tally.set(s.proposedBase, (tally.get(s.proposedBase) ?? 0) + 1);
  return tally;
}

/** The most-supported proposedBase (the escalation fallback base, O-2 (a)), or null when no signals. */
function mostSupportedBase(signals: RoundSignal[]): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [base, count] of tallyBases(signals)) {
    if (count > bestCount) {
      best = base;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The CLEAR-MAJORITY tie-break base (D-59), or null when no base clears the threshold. A clear
 * majority is the highest-count base whose count is STRICTLY `> rosterSize/2` — a real majority of the
 * surviving roster, not a mere plurality. This is deliberately NOT `mostSupportedBase`, which returns
 * the leader even on a 1-1 tie (a plurality): reusing it would wrongly resolve the D-60 escalate cases
 * (2-vendor 1-1, 3-vendor 1-1-1), where 1 is not `> half` of the roster (Pitfall 3). Used ONLY at the
 * exit boundary (post-cap/deadlock) to break a tie BEFORE escalating — never injected into a round
 * prompt (D-59 anti-anchoring). `rosterSize` is the SURVIVING roster size (so a dropped agent does not
 * inflate the threshold beyond what could ever be met).
 */
function clearMajority(signals: RoundSignal[], rosterSize: number): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [base, count] of tallyBases(signals)) {
    if (count > bestCount) {
      best = base;
      bestCount = count;
    }
  }
  return best !== null && bestCount > rosterSize / 2 ? best : null;
}

/**
 * Agreement guard (A3): true iff there is ≥1 signal AND every survivor proposes the SAME base AND no
 * survivor carries an open disagreement. Computed purely from the validated artifact fields — never a
 * model self-report. An empty signal set is NOT agreement (fails closed).
 */
function isAgreed(signals: RoundSignal[]): boolean {
  if (signals.length === 0) return false;
  const firstBase = signals[0].proposedBase;
  return signals.every(
    (s) => s.proposedBase === firstBase && s.remainingDisagreements.length === 0,
  );
}

/**
 * Run the bounded evaluation CONVERGENCE LOOP (D-40 — this IS the product). Each round fans the
 * surviving roster through one evaluation phase (reusing `runPhase`, kind disambiguated per round so
 * round artifacts never collide — Pitfall 3) and then reads the round's evaluation artifacts back
 * from disk to decide the loop's fate via guards evaluated in this fixed order (mirrors the
 * guard-array onDone idiom):
 *
 *   1. agreed       → designate: base = the shared proposedBase; integrator = that base's author
 *                     (D-44); resolve { status:"agreed" }.
 *   2. capReached   (round === convergenceCap, D-41c) → escalate.
 *   3. unresolvable (an explicit, STABLE deadlock: agents split across conflicting bases with open
 *                     disagreements for `UNRESOLVABLE_STABLE_ROUNDS` consecutive rounds, D-41b) →
 *                     escalate.
 *   4. else         → increment round and loop. We do NOT cut rounds for token cost (D-43): the cap
 *                     is the only backstop.
 *
 * On escalate (O-2 reading (a)) the run still yields a usable artifact: the most-supported
 * proposedBase becomes a provisional fallback base, its author the integrator, and the unresolved
 * fork is recorded as an `openDecision` so it is flagged for post-run human review (D-42,
 * autonomous-only — escalation logs, it does NOT pause).
 *
 * The returned object carries `concessions` (disagreements that disappeared from one round to the
 * next) and `openDecision` for the 04-05 decision-record writer (RSLV-01: every resolution logged).
 */
export async function runConvergence(
  roster: AgentEntry[],
  input: ProtocolInput,
): Promise<ConvergenceResult> {
  // The hard backstop (D-41c). Fall back to the schema default (10) if the config was constructed
  // without going through MarConfig.parse (e.g. a hand-built test config) so the loop is never
  // governed by an undefined cap (`round <= undefined` is always false → zero rounds).
  const cap = input.config.defaults.convergenceCap ?? 10;
  // How many CONSECUTIVE rounds of a stable, conflicting split count as an unresolvable deadlock
  // (D-41b). 2 means: if two rounds in a row show agents split across conflicting bases with open
  // disagreements AND the disagreement set did not shrink, the loop concludes the debate is stuck and
  // escalates early rather than burning the full cap. The cap (D-41c) still backstops the loop.
  const UNRESOLVABLE_STABLE_ROUNDS = 2;

  const concessions: string[] = [];
  let prevDisagreements: Set<string> | null = null;
  let stableStuckRounds = 0;

  for (let round = 1; round <= cap; round++) {
    // One evaluation fan-out over the surviving roster. runPhase re-reads the manifest at entry, so
    // nextSeq advances monotonically across rounds; the per-round kind keeps filenames distinct.
    await runPhase(roundPhase(round), roster, input);

    const signals = await collectRoundSignals(input.runDir, round);

    // Track conceded disagreements: anything present last round but gone this round was conceded.
    const thisDisagreements = new Set<string>();
    for (const s of signals) for (const d of s.remainingDisagreements) thisDisagreements.add(d);
    if (prevDisagreements) {
      for (const d of prevDisagreements) {
        if (!thisDisagreements.has(d)) concessions.push(d);
      }
    }

    // Guard 1: agreement (A3) — exit with the agreed base + its author as integrator (D-44).
    if (isAgreed(signals)) {
      const base = signals[0].proposedBase;
      return {
        base,
        integrator: integratorFor(base, signals),
        rounds: round,
        status: "agreed",
        concessions,
        resolver: "convergence",
      };
    }

    // Guard 2: cap reached (D-41c) — hard DoS backstop (T-04-12). The evidence-grounded loop has run
    // out of rounds without unanimity. Before escalating, try the CLEAR-MAJORITY tie-break (D-59):
    // if a real majority of the surviving roster (> rosterSize/2) proposes one base, resolve the fork
    // `agreed` via that base with resolver:"majority" instead of escalating. No clear majority → fall
    // through to escalate exactly as before. The tally is read ONLY here at the exit boundary.
    if (round === cap) {
      const majorityBase = clearMajority(signals, roster.length);
      if (majorityBase !== null) {
        return {
          base: majorityBase,
          integrator: integratorFor(majorityBase, signals),
          rounds: round,
          status: "agreed",
          concessions,
          resolver: "majority",
        };
      }
      return escalate(
        signals,
        round,
        concessions,
        `convergence cap (${cap}) reached without unanimous agreement`,
      );
    }

    // Guard 3: explicit unresolvable deadlock (D-41b). A "stable stuck" round = agents split across
    // ≥2 distinct bases AND at least one open disagreement remains AND the disagreement set did not
    // shrink vs. the previous round. Two such rounds in a row → the debate is deadlocked, escalate.
    const distinctBases = tallyBases(signals).size;
    const hasOpenDisagreement = thisDisagreements.size > 0;
    const shrank = prevDisagreements !== null && thisDisagreements.size < prevDisagreements.size;
    if (signals.length > 0 && distinctBases >= 2 && hasOpenDisagreement && !shrank) {
      stableStuckRounds += 1;
    } else {
      stableStuckRounds = 0;
    }
    if (stableStuckRounds >= UNRESOLVABLE_STABLE_ROUNDS) {
      // Deadlock detected. Before escalating, try the CLEAR-MAJORITY tie-break (D-59): a real majority
      // of the surviving roster (> rosterSize/2) on one base resolves the fork `agreed` via
      // resolver:"majority". No clear majority (e.g. 2-vendor 1-1, 3-vendor 1-1-1, D-60) → escalate.
      const majorityBase = clearMajority(signals, roster.length);
      if (majorityBase !== null) {
        return {
          base: majorityBase,
          integrator: integratorFor(majorityBase, signals),
          rounds: round,
          status: "agreed",
          concessions,
          resolver: "majority",
        };
      }
      return escalate(
        signals,
        round,
        concessions,
        `unresolvable disagreement: agents deadlocked across ${distinctBases} bases for ${stableStuckRounds} consecutive rounds`,
      );
    }

    prevDisagreements = thisDisagreements;
    // else: increment round and loop (D-43 — never cut rounds for token cost).
  }

  // Unreachable: the cap guard above returns on the final round. Defensive fallback so the function
  // is total (TS exhaustiveness) — should never execute.
  throw new Error("convergence loop exited without a resolution (unreachable)");
}

/** The integrator for an agreed/fallback base = that base's author (D-44). */
function integratorFor(base: string, signals: RoundSignal[]): string {
  // Prefer the signal whose author IS the base (the base author evaluated this round). Fall back to
  // the base name itself when the base author produced no parseable signal this round (it is still
  // the author of the chosen draft).
  const own = signals.find((s) => s.author === base);
  return own ? own.author : base;
}

/**
 * Build an `escalated` resolution (O-2 reading (a)): pick the most-supported proposedBase as a
 * provisional fallback base, designate its author the integrator, and record the unresolved fork as
 * an open decision (D-42). The run still produces a usable artifact + an entry the 04-05 record flags
 * for human review.
 */
function escalate(
  signals: RoundSignal[],
  round: number,
  concessions: string[],
  reason: string,
): ConvergenceResult {
  const fallback = mostSupportedBase(signals);
  if (!fallback) {
    // No parseable signals at all (every round artifact malformed/dropped). The run cannot pick a
    // base — surface a hard error rather than fabricate one.
    throw new Error(
      `convergence escalated (${reason}) but no agent produced a parseable proposedBase`,
    );
  }
  return {
    base: fallback,
    integrator: integratorFor(fallback, signals),
    rounds: round,
    status: "escalated",
    concessions,
    openDecision: { reason },
  };
}
