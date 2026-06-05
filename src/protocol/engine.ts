import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { assign, createActor, fromPromise, setup, toPromise } from "xstate";
import { makeAdapter } from "../adapters/registry.js";
import { applySkipFailed } from "../gates.js";
import { logInvocation } from "../log/invocation.js";
import { runPreflight } from "../preflight.js";
import {
  type Classify,
  classifyClaude,
  classifyCodex,
  classifyGemini,
  withRetry,
} from "../retry.js";
import type { AgentEntry, MarConfig } from "../schema/config.js";
import { EvaluationFrontmatter } from "../schema/evaluation.js";
import { IntegrationFrontmatter } from "../schema/integration.js";
import {
  type Manifest,
  RESUMABLE_STATUSES,
  TERMINAL_DONE,
} from "../schema/manifest.js";
import { ResponseFrontmatter } from "../schema/response.js";
import { ReviewFrontmatter } from "../schema/review.js";
import { isDone, writeArtifact } from "../workspace/artifacts.js";
import { nextSeq } from "../workspace/layout.js";
import { addArtifact, addDroppedAgent, readManifest, setStatus } from "../workspace/manifest.js";
import { promoteDrafts, scopedWorkdir } from "../workspace/scope.js";
import { type ConvergenceResult, runConvergence } from "./converge.js";
import { writeDecisionRecord } from "./decision-record.js";
import { readAgentFrontmatter } from "./frontmatter.js";
import { expectedParticipantCount, requiredArtifactsExist } from "./gate.js";
import { PHASES, type Phase } from "./phases.js";

/** Per-vendor transient-vs-fatal classifier for the retry seam (mirrors cli.ts CLASSIFY). */
const CLASSIFY: Record<AgentEntry["vendor"], Classify> = {
  claude: classifyClaude,
  codex: classifyCodex,
  gemini: classifyGemini,
};

/** Shared input every actor/guard reads from the machine context. */
export interface ProtocolInput {
  runDir: string;
  config: MarConfig;
  inputPath: string;
  /**
   * The initial LIVE roster the machine's `context.roster` is seeded with. A fresh `mar run` omits
   * it (the context factory defaults to `config.agents`). `mar resume` SETS it to the rehydrated
   * roster (survivors vs. full original, per D-57) so the resumed run fans out over exactly that set
   * and `expectedParticipantCount` recomputes from it (Pitfall 10).
   */
  roster?: AgentEntry[];
}

/** A roster agent that failed its turn in a phase, with the reason for the audit log. */
interface FailedAgent {
  entry: AgentEntry;
  reason: string;
}

/**
 * What ONE phase produced: the exact paths the fan-out wrote (the gate's single source of truth),
 * plus the partition of the CURRENT roster into the agents that succeeded and those that failed.
 * The engine uses ok/failed to apply partial-failure handling (D-30) and shrink the live roster.
 */
export interface PhaseResult {
  writtenPaths: string[];
  ok: AgentEntry[];
  failed: FailedAgent[];
}

/**
 * Run ONE phase over `roster` (the LIVE surviving roster, which may be smaller than the configured
 * one after earlier drops): fan out N-wide with a bare settle-all (allSettled — never the
 * reject-fast variant, Pitfall 5; no concurrency-limiter dependency per the concurrency decision),
 * reuse the proven turn seam unchanged, and return BOTH the exact array of artifact paths actually
 * written AND the ok/failed partition of `roster`. `writtenPaths` is the SINGLE SOURCE OF TRUTH the
 * phase gate consumes; ok/failed drives the partial-failure handler in {@link runPhaseGated}.
 */
export async function runPhase(
  phase: Phase,
  roster: AgentEntry[],
  input: ProtocolInput,
): Promise<PhaseResult> {
  const { runDir, config, inputPath } = input;
  const timeoutMs = config.defaults.timeoutMs;
  const retries = config.defaults.retries;

  // Decide each agent's seq ONCE, up front, from the manifest + on-disk names via nextSeq (the
  // monotonic source — never the success count). A single base read + per-index offset keeps
  // concurrent writers in the same phase from colliding on a seq.
  const manifest = await readManifest(runDir);
  const onDiskNames = existsSync(runDir) ? readdirSync(runDir) : [];
  const baseSeq = nextSeq(
    manifest.artifacts.map((a) => a.path),
    onDiskNames,
  );

  /**
   * Seq assignment. In a SCOPED phase every agent writes into its OWN isolated `work/<agent>/`
   * dir, so all drafts share seq 1 (no filename collision) — this matches scope.ts's
   * draftFileName(agent) === artifactName(1, agent, "draft") contract that promoteDrafts relies
   * on. In a shared (non-scoped) phase every artifact lands in the run dir, so each agent needs a
   * DISTINCT monotonic seq (baseSeq + index) to avoid clobbering a peer.
   */
  const seqFor = (index: number): number => (phase.scoped ? 1 : baseSeq + index);

  process.stdout.write(`▶ phase ${phase.name} — fanning out ${roster.length} agent(s)\n`);

  // One written artifact awaiting manifest indexing (agent tasks write FILES concurrently — those
  // are independent paths — but the manifest is appended SEQUENTIALLY below to avoid a concurrent
  // read-modify-write race on the single manifest.json).
  interface WrittenArtifact {
    absPath: string;
    relPath: string;
    agent: string;
    seq: number;
  }
  // Per-agent outcome: either a written artifact (ok) or a failure reason (dropped from the run).
  type AgentOutcome =
    | { entry: AgentEntry; written: WrittenArtifact }
    | { entry: AgentEntry; failure: string };

  const settled = await Promise.allSettled(
    roster.map(async (entry, index): Promise<AgentOutcome> => {
      const seq = seqFor(index);
      const adapter = makeAdapter(entry.vendor, entry.bin, entry.model);
      // Thin per-phase prompt (D-37): references the seeded instruction file, carries NO format
      // contract. The format vocabulary lives solely in work/<agent>/<vendor-file> (04-02).
      const basePrompt = phase.prompt({ inputPath, phaseName: phase.name });
      const promptRef = `phase:${phase.name}`;
      // PROT-04: only the draft phase runs in an isolated per-agent cwd. The scoped draft artifact
      // is also WRITTEN into that per-agent dir (`work/<agent>/`), so a peer can never read it from
      // a shared location until promoteDrafts copies it at the boundary. Non-scoped phases write
      // straight into the run dir (the shared workspace).
      const cwd = phase.scoped
        ? await scopedWorkdir(runDir, entry.name, inputPath, entry.vendor)
        : undefined;
      const artifactDir = cwd ?? runDir;

      // One transport-retried turn for `promptText`, written to an artifact. Returns the written
      // artifact (ok) or a failure reason. The transport retry (withRetry / D-23) is DISTINCT from
      // the validation retry below (D-38, Pitfall 5): this wraps only the spawn/transport layer.
      const runTurn = async (
        promptText: string,
      ): Promise<
        | { ok: true; written: { path: string }; text: string; durationMs: number }
        | { ok: false; reason: string; durationMs: number }
      > => {
        const turn = await withRetry(
          () =>
            adapter.invoke({
              agent: entry.name,
              promptText,
              runDir,
              seq,
              timeoutMs,
              ...(cwd ? { cwd } : {}),
            }),
          {
            retries,
            classify: CLASSIFY[entry.vendor],
            onAttempt: (t, attempt) =>
              logInvocation(runDir, {
                command: t.redactedCommand,
                promptRef,
                exitCode: t.exitCode,
                durationMs: t.durationMs,
                timedOut: t.timedOut,
                attempt,
              }),
          },
        );
        if (!turn.ok) {
          const reason = turn.timedOut ? "timeout" : (turn.error ?? "failed");
          return { ok: false, reason, durationMs: turn.durationMs };
        }
        const written = await writeArtifact(artifactDir, seq, entry.name, {
          text: turn.text,
          raw: turn,
          kind: phase.kind,
          frontmatter: { runId: manifest.runId, phase: phase.name },
        });
        return { ok: true, written, text: turn.text, durationMs: turn.durationMs };
      };

      // First attempt.
      let attempt = await runTurn(basePrompt);
      if (!attempt.ok) {
        const secs = (attempt.durationMs / 1000).toFixed(1);
        process.stdout.write(`  ${entry.name} ✗  ${secs}s  (${attempt.reason})\n`);
        return { entry, failure: attempt.reason };
      }

      // Validation-with-one-retry gate (D-38). Runs AFTER withRetry returns a successful turn —
      // NOT inside it (Pitfall 5: transport retry and validation retry are distinct). gray-matter
      // is used READ-only (the injection-safe toFrontmatter serializer still WRITES). Default
      // js-yaml SAFE load (no `!!js/function`) — no custom unsafe schema is passed (T-04-07). On a
      // schema miss we re-invoke the SAME adapter ONCE with the formatted zod issues appended; a
      // second failure converts the turn to a FAILED turn so applySkipFailed (D-30) drops it.
      //
      // We validate the AGENT'S emitted markdown+frontmatter (the turn text), parsed with
      // gray-matter. writeArtifact wraps that text under an engine-metadata frontmatter block
      // (agent/seq/kind/timestamp/runId/phase) for the audit trail, so the on-disk `.md` has the
      // engine block FIRST — parsing the file would validate engine metadata, not the agent's
      // structured frontmatter. Parsing the agent text directly is the read that validates the
      // attacker-influenceable content (T-04-06). The raw turn JSON + wrapped .md are still on disk.
      if (phase.validate) {
        // Tolerant reader (live-run hardening, 04-05 checkpoint): models — claude especially —
        // sometimes emit preamble prose before the artifact despite the contract's output-channel
        // rule. gray-matter only recognizes frontmatter at position 0, so when the direct parse
        // yields no data we fall back to the FIRST `---` delimiter line and parse from there.
        // Schema validation stays strict (fail-closed, D-38) — leniency applies only to WHERE the
        // frontmatter is found, never to its shape.
        const parseFront = (text: string): unknown => {
          const direct = matter(text).data;
          if (direct && Object.keys(direct).length > 0) return direct;
          const delim = text.match(/^---\s*$/m);
          if (delim?.index !== undefined && delim.index > 0) {
            return matter(text.slice(delim.index)).data;
          }
          return direct;
        };
        // YAML parse exceptions (e.g. an unquoted colon inside a string value) must feed the SAME
        // one-retry path as schema misses — previously they threw past the gate and the turn died
        // with no feedback (observed live: gemini-1, run 20260605-MYPrO2).
        const safeValidate = (text: string): { ok: true } | { ok: false; errors: string } => {
          try {
            return phase.validate!(parseFront(text));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return {
              ok: false,
              errors: `YAML parse error in frontmatter: ${msg}\nQuote every string value that contains a colon, e.g. question: "How does X: Y work?"`,
            };
          }
        };
        let result = safeValidate(attempt.text);
        if (!result.ok) {
          process.stdout.write(`  ${entry.name} ↻ revalidating (validation errors fed back)\n`);
          const retryPrompt = `${basePrompt}\n\n## Validation errors to fix\n${result.errors}`;
          const reattempt = await runTurn(retryPrompt);
          if (!reattempt.ok) {
            const secs = (reattempt.durationMs / 1000).toFixed(1);
            process.stdout.write(`  ${entry.name} ✗  ${secs}s  (${reattempt.reason})\n`);
            return { entry, failure: reattempt.reason };
          }
          attempt = reattempt;
          result = safeValidate(attempt.text);
          if (!result.ok) {
            const secs = (attempt.durationMs / 1000).toFixed(1);
            process.stdout.write(`  ${entry.name} ✗  ${secs}s  (validation-failed)\n`);
            // Fail-closed: never silently auto-normalize a still-malformed artifact (D-38).
            return { entry, failure: "validation-failed" };
          }
        }
      }

      const secs = (attempt.durationMs / 1000).toFixed(1);
      // Manifest path is ALWAYS relative to the run dir (scoped drafts live under work/<agent>/).
      const relPath = attempt.written.path.slice(runDir.length + 1);
      process.stdout.write(`  ${entry.name} ✓  ${secs}s  → ${relPath}\n`);
      return { entry, written: { absPath: attempt.written.path, relPath, agent: entry.name, seq } };
    }),
  );

  // Index every written artifact into the manifest SEQUENTIALLY (no concurrent manifest writes) and
  // partition the roster into ok/failed. A rejected promise (the fan-out itself threw — should not
  // happen, but allSettled tolerates it) counts as a failure with the rejection reason.
  const writtenPaths: string[] = [];
  const ok: AgentEntry[] = [];
  const failed: FailedAgent[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "rejected") {
      failed.push({ entry: roster[i], reason: String(r.reason ?? "rejected") });
      continue;
    }
    const outcome = r.value;
    if ("failure" in outcome) {
      failed.push({ entry: outcome.entry, reason: outcome.failure });
      continue;
    }
    const { absPath, relPath, agent, seq } = outcome.written;
    await addArtifact(runDir, {
      path: relPath,
      agent,
      seq,
      kind: phase.kind,
      createdAt: new Date().toISOString(),
    });
    writtenPaths.push(absPath);
    ok.push(outcome.entry);
  }
  return { writtenPaths, ok, failed };
}

/**
 * Why a phase failed the run, threaded back to {@link runProtocol} so the terminal status preserves
 * the cause instead of collapsing every non-success into a blanket `failed` (CR-01). `timedOut`
 * routes the run to the schema's distinct `timeout` status (D-17); `reason` is the human-readable
 * cause persisted to the manifest's `failureReason`.
 */
interface PhaseFailure {
  reason: string;
  timedOut: boolean;
}

/** A phase outcome: the surviving roster to carry forward, or a structured failure cause (CR-01). */
type PhaseOutcome = { survivors: AgentEntry[] } | { failure: PhaseFailure };

/**
 * Run a phase AND decide its outcome, applying partial-failure handling (D-30) and the artifacts
 * gate (PROT-03) together. Returns the surviving roster to carry into the next phase, or a
 * {@link PhaseFailure} carrying WHY the run must fail (so the cause is never discarded — CR-01).
 * Steps:
 *
 *   1. Fan out over the current roster (runPhase) → writtenPaths + ok/failed partition.
 *   2. If any agent failed, apply `applySkipFailed(survivors, failed)`. It re-asserts the
 *      >=2-distinct-vendor invariant over the SURVIVORS, so dropping can never silently produce a
 *      single-vendor run. If it throws, the run fails. Each dropped agent is recorded in the
 *      manifest's audit list (never a silent drop).
 *   3. Gate the phase on EXACTLY the survivors' written paths: every path isDone AND the written
 *      count equals the expected participant count for the SURVIVING roster (so a survivor that
 *      claimed success but wrote a short/0-byte artifact still fails the gate, PROT-03 / Pitfall 3).
 *
 * The roster shrinks monotonically across phases: an agent dropped in draft never participates in
 * review, and the gate/expected-count always reflect the live surviving roster.
 */
/**
 * Pick the single integrator for the integration phase (REVW-04, Pitfall 4). The convergence loop
 * (04-04) SETS the integrator from the agreed/fallback base's author (D-44) and threads it here via
 * `designated`. When a designated integrator is supplied we resolve it to its roster entry; if (only
 * defensively) it is absent we fall back to the FIRST survivor so the integration phase still fans
 * out over exactly one writer rather than the whole roster. PRECONDITION: integration requires at
 * least one survivor — guaranteed because the prior phases' gate fails closed on a zero-survivor
 * roster, so `roster[0]` always exists when this runs.
 */
/**
 * Resolve the convergence-designated integrator NAME (D-44) to its LIVE roster entry. Falls back to
 * the first survivor only defensively (the convergence loop always names a real survivor's author).
 */
function resolveIntegrator(roster: AgentEntry[], integratorName: string): AgentEntry {
  return roster.find((a) => a.name === integratorName) ?? roster[0];
}

function designateIntegrator(roster: AgentEntry[], designated?: AgentEntry): AgentEntry {
  // Prefer the convergence-designated integrator (D-44), matched by name against the LIVE roster so
  // the entry's vendor/bin are the surviving roster's, not a stale copy.
  if (designated) {
    const match = roster.find((a) => a.name === designated.name);
    if (match) return match;
  }
  const integrator = designated ?? roster[0];
  if (!integrator) {
    // Defensive: the upstream gate fails closed before this, but never fan out over an empty roster.
    throw new Error("integration phase requires a designated integrator but the roster is empty");
  }
  return integrator;
}

async function runPhaseGated(
  phase: Phase,
  roster: AgentEntry[],
  input: ProtocolInput,
  designatedIntegrator?: AgentEntry,
): Promise<PhaseOutcome> {
  // REVW-04: the integration phase fans out over ONLY the designated integrator, not the surviving
  // roster. Every other phase fans out over all survivors. The gate's expectedParticipantCount
  // independently expects exactly 1 writer for the integrator phase, so a redundant non-integrator
  // merge (or a missing merge) fails the gate.
  const fanoutRoster =
    phase.participants === "integrator"
      ? [designateIntegrator(roster, designatedIntegrator)]
      : roster;
  const { writtenPaths, ok, failed } = await runPhase(phase, fanoutRoster, input);

  // A failure is a timeout iff EVERY failing agent timed out (the per-agent reason is the literal
  // "timeout" string set in runPhase). A mixed batch is reported as a generic failure — only an
  // all-timeout failure preserves the distinct D-17 `timeout` status.
  const failedTimedOut = failed.length > 0 && failed.every((f) => f.reason === "timeout");

  // Partial-failure handling: drop the failed agents, but only if >=2 distinct vendors survive.
  let survivors = ok;
  if (failed.length > 0) {
    try {
      survivors = applySkipFailed(
        ok,
        failed.map((f) => f.entry),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`  ✗ cannot continue: ${msg}\n`);
      // Preserve the underlying cause (e.g. an all-timeout drop below the 2-vendor floor → timeout).
      const reasons = failed.map((f) => `${f.entry.name}: ${f.reason}`).join("; ");
      return {
        failure: {
          reason: `phase ${phase.name} cannot continue: ${msg} (${reasons})`,
          timedOut: failedTimedOut,
        },
      };
    }
    // Record each drop in the manifest audit trail (sequential — outside any fan-out).
    for (const f of failed) {
      process.stdout.write(`  ⤵ dropping ${f.entry.name} (${f.entry.vendor}): ${f.reason}\n`);
      await addDroppedAgent(input.runDir, {
        agent: f.entry.name,
        vendor: f.entry.vendor,
        phase: phase.name,
        reason: f.reason,
        droppedAt: new Date().toISOString(),
      });
    }
  }

  // The artifacts gate over EXACTLY the survivors' written paths (gated == written). The expected
  // count is the participant count for the SURVIVING roster (1 for the integrator phase), so a
  // survivor short-write — or a redundant non-integrator merge — fails the gate. WR-03:
  // requiredArtifactsExist fails closed on an empty list, so a degenerate zero-survivor phase fails.
  const passes =
    requiredArtifactsExist(writtenPaths) &&
    writtenPaths.length === expectedParticipantCount(phase, survivors);
  if (passes) {
    // REVW-04: the integration phase ran over ONLY the integrator, but the non-integrators did NOT
    // fail — they simply did not participate. Carry the FULL incoming roster forward so the
    // following validation phase still fans out over every surviving agent (the integrator phase
    // must not silently shrink the roster to one).
    const carried = phase.participants === "integrator" ? roster : survivors;
    return { survivors: carried };
  }
  // Gate failure: distinguish a survivor short-write (a real gate miss) from a still-open cause.
  return {
    failure: {
      reason: `phase ${phase.name} gate failed: wrote ${writtenPaths.length}/${expectedParticipantCount(
        phase,
        survivors,
      )} required artifact(s)`,
      timedOut: false,
    },
  };
}

interface ProtocolContext {
  input: ProtocolInput;
  /** The LIVE surviving roster, shrinking as agents are dropped (D-30). */
  roster: AgentEntry[];
  /** Set on the failure path so {@link runProtocol} can persist the cause + pick timeout vs failed. */
  failure?: PhaseFailure;
  /**
   * The single integrator designated by the convergence loop (D-44): the agreed/fallback base's
   * author. The integration phase fans out over ONLY this agent (REVW-04). Set when the evaluation
   * convergence actor resolves; consumed by the integration phase's `runPhaseGated`.
   */
  integrator?: AgentEntry;
  /**
   * The full convergence resolution (base, integrator, rounds, status, concessions, openDecision).
   * Its `status` drives the run's terminal status: an `escalated` convergence makes the completed run
   * terminal-status `escalated` rather than `completed` (O-2 additive), even though integration still
   * runs with the fallback base. The 04-05 decision-record writer reads concessions/openDecision.
   */
  convergence?: ConvergenceResult;
}

/** A phase actor resolves with the surviving roster (continue) or a structured failure (fail). */
type PhaseEvent = { output: PhaseOutcome };

/** The convergence actor resolves with the loop's full resolution (base/integrator/status/...). */
type ConvergenceEvent = { output: ConvergenceResult };

/** An XState `onError` event carrying the thrown actor error (the cause the engine must surface). */
type ErrorEvent = { error: unknown };

/** Build a PhaseFailure from a thrown actor error (promote/internal), preserving its message (CR-01). */
function failureFromError(prefix: string, error: unknown): PhaseFailure {
  const msg = error instanceof Error ? error.message : String(error);
  return { reason: `${prefix}: ${msg}`, timedOut: false };
}

/**
 * The 6-phase protocol as an XState v5 machine. Each phase is a state that invokes a `fromPromise`
 * actor running {@link runPhaseGated} over the LIVE roster; the actor resolves with the surviving
 * roster (continue) or a structured {@link PhaseFailure} (fail). A guard advances only on a
 * `survivors` outcome and assigns it to context so the next phase fans out over the shrunken roster;
 * the failure branch records the cause into context so {@link runProtocol} can persist it and pick
 * the right terminal status (CR-01). The draft state runs `promoteDrafts` (PROT-04 boundary) as a
 * dedicated awaited actor in a transient `promote` state placed BETWEEN draft and review, promoting
 * ONLY the surviving drafters. On any failure the machine routes to a `failed` final state — and the
 * actual error (gate reason, agent timeout, or an actor's `onError` cause) is captured in
 * `context.failure` rather than discarded. On all 6 passing, to `done`. Terminal `setStatus` is
 * applied by {@link runProtocol} off the resolved final state so no async action races the manifest.
 */
function buildMachine(resumePhase?: Phase["name"]) {
  const phaseActor = fromPromise<
    PhaseOutcome,
    { phase: Phase; roster: AgentEntry[]; input: ProtocolInput; integrator?: AgentEntry }
  >(({ input }) => runPhaseGated(input.phase, input.roster, input.input, input.integrator));
  const promoteActor = fromPromise<void, { roster: AgentEntry[]; input: ProtocolInput }>(
    ({ input }) =>
      promoteDrafts(
        input.input.runDir,
        input.roster.map((a) => a.name),
      ),
  );
  // The evaluation phase IS the bounded convergence loop (D-40): instead of one evaluation fan-out it
  // runs runConvergence (round loop, agreement/cap/unresolvable guards) and resolves the designated
  // base + integrator. The integration phase that follows fans out over ONLY that integrator.
  const convergenceActor = fromPromise<
    ConvergenceResult,
    { roster: AgentEntry[]; input: ProtocolInput }
  >(({ input }) => runConvergence(input.roster, input.input));

  // Build the per-phase states programmatically so the 6-phase series stays in lock-step with
  // PHASES (single source of the phase order). The draft phase advances to a transient `promote`
  // state (PROT-04 boundary) before review; every other phase advances to the next phase or done.
  const states: Record<string, unknown> = {};
  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i];
    const isLast = i + 1 >= PHASES.length;
    const next = phase.name === "draft" ? "promote" : isLast ? "done" : PHASES[i + 1].name;

    // The evaluation phase is the convergence loop (D-40), not a single gated fan-out. It invokes
    // the convergenceActor, which runs the bounded round loop and resolves the designated base +
    // integrator; on done we record the integrator (D-44, consumed by the integration phase over
    // exactly one writer) and the full convergence result (its status drives the terminal status:
    // an escalated convergence → terminal `escalated`, but the run STILL advances to integration
    // with the fallback base — O-2 (a)). A thrown convergence actor (e.g. no parseable base) routes
    // to `failed` with the cause preserved.
    if (phase.name === "evaluation") {
      states[phase.name] = {
        invoke: {
          src: "convergenceActor",
          input: ({ context }: { context: ProtocolContext }) => ({
            roster: context.roster,
            input: context.input,
          }),
          onDone: {
            target: next,
            actions: assign({
              convergence: ({ event }: { event: ConvergenceEvent }) => event.output,
              integrator: ({ context, event }) =>
                resolveIntegrator(
                  context.roster,
                  (event as unknown as ConvergenceEvent).output.integrator,
                ),
            }),
          },
          onError: {
            target: "failed",
            actions: assign({
              failure: ({ event }: { event: ErrorEvent }) =>
                failureFromError("evaluation convergence actor error", event.error),
            }),
          },
        },
      };
      continue;
    }

    states[phase.name] = {
      invoke: {
        src: "phaseActor",
        input: ({ context }: { context: ProtocolContext }) => ({
          phase,
          roster: context.roster,
          input: context.input,
          // The integration phase fans out over ONLY the convergence-designated integrator (D-44 /
          // REVW-04). Passed through for every phase; runPhaseGated ignores it unless the phase is
          // participants:"integrator".
          integrator: context.integrator,
        }),
        onDone: [
          {
            guard: ({ event }: { event: PhaseEvent }) => "survivors" in event.output,
            target: next,
            actions: assign({
              roster: ({ event }: { event: PhaseEvent }) =>
                (event.output as { survivors: AgentEntry[] }).survivors,
            }),
          },
          {
            // Gated failure (gate miss, agent timeout, sub-2-vendor drop): keep the cause.
            target: "failed",
            actions: assign({
              failure: ({ event }: { event: PhaseEvent }) =>
                (event.output as { failure: PhaseFailure }).failure,
            }),
          },
        ],
        // Actor threw (unexpected internal error): capture event.error instead of swallowing it.
        onError: {
          target: "failed",
          actions: assign({
            failure: ({ event }: { event: ErrorEvent }) =>
              failureFromError(`phase ${phase.name} actor error`, event.error),
          }),
        },
      },
    };
  }

  // Transient state: promote the SURVIVING drafters' drafts to shared/ at the draft->review
  // boundary, THEN enter review.
  states.promote = {
    invoke: {
      src: "promoteActor",
      input: ({ context }: { context: ProtocolContext }) => ({
        roster: context.roster,
        input: context.input,
      }),
      onDone: { target: "review" },
      onError: {
        target: "failed",
        actions: assign({
          failure: ({ event }: { event: ErrorEvent }) =>
            failureFromError("draft->review promotion failed", event.error),
        }),
      },
    },
  };

  states.done = { type: "final" };
  states.failed = { type: "final" };

  return setup({
    types: {} as { context: ProtocolContext; input: ProtocolInput },
    actors: { phaseActor, promoteActor, convergenceActor },
  }).createMachine({
    id: "protocol",
    // Resume RE-DERIVATION (D-14/D-54): a resumePhase name re-enters the SAME programmatic states at
    // that phase. The per-phase `next` wiring is unchanged, so resuming at `review` skips `promote`
    // (only `draft`'s next is `"promote"` — Pitfall 1) and resuming at `draft` runs the full
    // draft→promote→review chain. A fresh run omits resumePhase and starts at PHASES[0].
    initial: resumePhase ?? PHASES[0].name,
    // The roster is rehydrated from `input.roster` when present (resume: survivors vs. full original,
    // D-57), else defaults to the configured roster for a fresh run.
    context: ({ input }) => ({ input, roster: input.roster ?? input.config.agents }),
    states: states as never,
  });
}

/**
 * Drive an input document through the 6-phase review protocol. Returns 0 when the run completes,
 * non-zero when a phase gate fails or survivors drop below 2 distinct vendors. PROT-01/03/04, D-30.
 *
 * The terminal status preserves the CAUSE (CR-01): a failure whose every dropped agent timed out is
 * recorded as the schema's distinct `timeout` status (D-17 observability); any other failure is
 * `failed`. The human-readable cause — gate reason, agent timeout, sub-2-vendor drop, or an
 * engine-internal actor error captured from `onError` — is persisted to the manifest's
 * `failureReason` and mirrored to stderr, so the reason is never silently discarded.
 */
export async function runProtocol(
  runDir: string,
  config: MarConfig,
  inputPath: string,
): Promise<number> {
  const machine = buildMachine();
  const actor = createActor(machine, { input: { runDir, config, inputPath } });
  actor.start();
  await toPromise(actor);
  const snapshot = actor.getSnapshot();
  if (snapshot.value === "done") {
    // O-2 (a): a run whose convergence ESCALATED (cap/deadlock → fallback base) completed the full
    // protocol and produced a merged artifact, but did so via an escalation rather than unanimous
    // agreement. Record the distinct `escalated` terminal status (additive, D-41/D-42) so the
    // unresolved fork is observable; the open decision itself is logged in the 04-05 record. Any
    // other completed run is `completed`.
    const escalated = snapshot.context.convergence?.status === "escalated";
    // Terminal step (RCRD-01): assemble + write the run's decision record from the artifact trail.
    // Written on BOTH `completed` and `escalated` outcomes — an escalated run still produced a merged
    // fallback artifact and an open decision, so it must still yield its record (the open decision is
    // exactly what a human reviews). Runs in the same terminal position as setStatus, off the resolved
    // final snapshot, so no async action races the manifest. A hard failed/timeout run skips it
    // (handled below — the run produced no convergence/integration trail to record).
    await writeDecisionRecord(runDir, snapshot.context.convergence);
    await setStatus(runDir, escalated ? "escalated" : "completed");
    return 0;
  }
  // Failure: prefer the cause captured in context; fall back to a generic reason if (defensively)
  // the machine reached a non-`done` final state without recording one.
  const failure = snapshot.context.failure ?? {
    reason: `protocol ended in non-success state "${String(snapshot.value)}"`,
    timedOut: false,
  };
  process.stderr.write(`protocol error: ${failure.reason}\n`);
  await setStatus(runDir, failure.timedOut ? "timeout" : "failed", failure.reason);
  return 1;
}

// ============================================================================================
// RESUME (PROT-06, D-54/D-55/D-56/D-57). Resume is RE-DERIVATION ONLY: read the manifest, find the
// first not-fully-satisfied phase, rebuild the machine with `initial` = that phase + the rehydrated
// roster, and run forward. NO XState snapshot persistence (Pitfall 2: restoring a mid-flight
// `fromPromise` actor silently hangs). D-54: the interrupted phase re-runs from its start and
// convergence restarts at round 1.
// ============================================================================================

/** The per-phase strict zod validator for resume re-validation (D-56), keyed by phase NAME. */
const RESUME_VALIDATORS: Record<string, { safeParse(data: unknown): { success: boolean } }> = {
  review: ReviewFrontmatter,
  response: ResponseFrontmatter,
  evaluation: EvaluationFrontmatter,
  integration: IntegrationFrontmatter,
};

/**
 * Rehydrate the LIVE roster for a resumed run (D-57, the roster-source-by-reason rule). For a
 * `paused-awaiting-approval` pause or an interrupted `running` run, the surviving roster is the
 * configured roster minus the agents the manifest recorded as dropped (by name) — the run continues
 * with exactly the survivors it had. For a `failed`/`timeout` run the FULL configured roster is
 * restored so every previously-dropped agent gets another chance (D-57, directly motivated by the
 * Phase-4 live run that died at review below the vendor floor and wasted three drafts); the resumed
 * phase's expected participant count then recomputes from the larger roster (Pitfall 10).
 */
export function rehydrateRoster(config: MarConfig, manifest: Manifest): AgentEntry[] {
  if (manifest.status === "failed" || manifest.status === "timeout") {
    return config.agents; // D-57: dropped agents rejoin on a failed/timeout resume.
  }
  const dropped = new Set(manifest.droppedAgents.map((d) => d.agent));
  return config.agents.filter((a) => !dropped.has(a.name));
}

/**
 * Walk PHASES in order and return the FIRST phase whose required artifacts are NOT all present for
 * `roster` (the resume entry point). Reuses the gate's completeness notion: a phase is COMPLETE iff
 * the manifest records at least `expectedParticipantCount(phase, roster)` artifacts of that phase's
 * kind AND each exists on disk (isDone). A completed phase may carry MORE than the resume roster
 * expects (an agent dropped later wrote here before being dropped) — hence `>=`.
 *
 * The evaluation phase is special (D-54 / Q4): it runs as the bounded convergence loop writing
 * per-round `evaluation-r<n>` kinds, and its terminal output is the designated base+integrator held
 * only in machine context, not on disk. Per D-54 the simplest correct rule is to re-run convergence
 * from round 1 whenever it is not provably done — so evaluation is treated COMPLETE iff at least one
 * `integration` artifact exists (integration consumes the convergence result, so its presence proves
 * convergence resolved). Otherwise evaluation is the resume point and convergence restarts at round 1.
 *
 * `runDir` resolves each recorded (run-dir-relative) artifact path to an absolute path for `isDone`.
 */
export function firstIncompletePhase(
  runDir: string,
  manifest: Manifest,
  roster: AgentEntry[],
): Phase {
  const countOfKind = (kind: string): number =>
    manifest.artifacts.filter((a) => a.kind === kind).length;
  const allDone = (kind: string): boolean =>
    manifest.artifacts.filter((a) => a.kind === kind).every((a) => isDone(join(runDir, a.path)));

  for (const phase of PHASES) {
    if (phase.name === "evaluation") {
      // Complete iff an integration artifact exists (proves convergence resolved). Else resume here.
      if (countOfKind("integration") < 1) return phase;
      continue;
    }
    const expected = expectedParticipantCount(phase, roster);
    const have = countOfKind(phase.kind);
    if (have < expected || !allDone(phase.kind)) return phase;
  }
  // Every phase satisfied — defensively resume at the final phase (validation) so the run still
  // re-derives forward to `done`. (Callers refuse terminal-done runs before reaching here.)
  return PHASES[PHASES.length - 1];
}

/** A specific, named re-validation outcome (D-56): either OK or a precise refusal reason. */
type RevalidateResult = { ok: true } | { ok: false; error: string };

/**
 * D-56 resume re-validation. Before continuing a resumed run, prove the on-disk artifact trail it
 * builds on is intact and the roster's auth still works, refusing with a SPECIFIC error naming
 * exactly what is broken:
 *   (1) manifest integrity — `readManifest` already fails closed on a corrupt manifest (the caller
 *       passes the parsed manifest, so this is implicit).
 *   (2) every COMPLETED phase (strictly before the resume phase) — each required artifact exists
 *       (isDone) AND its agent frontmatter re-validates against that phase's 04-01 zod schema via the
 *       SHARED tolerant reader (`readAgentFrontmatter`, 05-02 — never the strict double-parse, or a
 *       valid preamble-prefixed artifact the live gate accepted would be wrongly refused, Pitfall 4).
 *   (3) roster preflight (`runPreflight`) — auth can decay between sessions (observed live with
 *       gemini); a now-unauthenticated agent is refused by name.
 */
export async function revalidateForResume(
  runDir: string,
  config: MarConfig,
  manifest: Manifest,
  roster: AgentEntry[],
  resumePhase: Phase,
): Promise<RevalidateResult> {
  const resumeIdx = PHASES.findIndex((p) => p.name === resumePhase.name);

  // (2) Re-validate every completed phase's artifacts (those strictly before the resume phase).
  for (let i = 0; i < resumeIdx; i++) {
    const phase = PHASES[i];
    // Evaluation's per-round kinds are validated as round artifacts; match by the `evaluation-` prefix.
    const entries = manifest.artifacts.filter((a) =>
      phase.name === "evaluation" ? a.kind.startsWith("evaluation-") : a.kind === phase.kind,
    );
    const validator =
      phase.name === "evaluation" ? RESUME_VALIDATORS.evaluation : RESUME_VALIDATORS[phase.name];
    for (const art of entries) {
      const abs = join(runDir, art.path);
      if (!isDone(abs)) {
        return {
          ok: false,
          error: `resume refused: completed-phase artifact missing or empty: ${art.path} (phase ${phase.name})`,
        };
      }
      if (validator) {
        const data = await readAgentFrontmatter(abs);
        const parsed = validator.safeParse(data);
        if (!parsed.success) {
          return {
            ok: false,
            error: `resume refused: completed-phase artifact failed re-validation against the ${phase.name} schema: ${art.path}`,
          };
        }
      }
    }
  }

  // (3) Roster preflight — refuse if any resumed agent's CLI auth/responsiveness has decayed.
  const { results } = await runPreflight(roster);
  const broken = results.filter((r) => !(r.installed && r.responsive));
  if (broken.length > 0) {
    const names = broken.map((r) => `${r.name} (${r.vendor})`).join(", ");
    return { ok: false, error: `resume refused: roster preflight failed for: ${names}` };
  }

  return { ok: true };
}

/**
 * Resume an interrupted/failed/paused run (PROT-06) by RE-DERIVING from the manifest — mirrors
 * {@link runProtocol}'s terminal branch but rebuilds the machine at the first not-fully-satisfied
 * phase with the rehydrated roster. Refuses a TERMINAL-done run (completed/escalated). On a D-56
 * re-validation failure it refuses with the specific cause and a non-zero exit. NO snapshots
 * (Pitfall 2): the resume entry is a phase NAME, the interrupted phase re-runs from its start, and
 * convergence restarts at round 1 (D-54). Seq monotonicity (nextSeq over manifest + on-disk names)
 * guarantees no phase ≤ N artifact is rewritten.
 */
export async function resumeProtocol(runDir: string, config: MarConfig): Promise<number> {
  const manifest = await readManifest(runDir); // (1) manifest integrity — fails closed if corrupt.

  // Refuse a terminal-done run: there is nothing left to resume.
  if ((TERMINAL_DONE as readonly string[]).includes(manifest.status)) {
    process.stderr.write(`resume refused: run already ${manifest.status}; nothing to resume\n`);
    return 2;
  }
  // Defensive: only resumable statuses reach the engine (the CLI filters), but fail closed here too.
  if (!(RESUMABLE_STATUSES as readonly string[]).includes(manifest.status)) {
    process.stderr.write(`resume refused: run status "${manifest.status}" is not resumable\n`);
    return 2;
  }
  // The input document path is re-derived from the manifest (recorded at run start, D-54). Without
  // it the run cannot re-run any phase.
  const inputPath = manifest.inputPath;
  if (!inputPath) {
    process.stderr.write(
      "resume refused: manifest has no recorded inputPath (run predates resume support)\n",
    );
    return 2;
  }

  // Rehydrate the roster by reason (D-57) and derive the resume phase from disk (D-54).
  const roster = rehydrateRoster(config, manifest);
  const resumePhase = firstIncompletePhase(runDir, manifest, roster);

  // D-56: re-validate the completed-phase trail + roster preflight before continuing.
  const check = await revalidateForResume(runDir, config, manifest, roster, resumePhase);
  if (!check.ok) {
    process.stderr.write(`${check.error}\n`);
    return 2;
  }

  process.stdout.write(
    `↻ resuming run ${manifest.runId} at phase "${resumePhase.name}" with ${roster.length} agent(s)\n`,
  );

  // Re-derivation: rebuild the machine at the resume phase with the rehydrated roster (no snapshot).
  const machine = buildMachine(resumePhase.name);
  const actor = createActor(machine, {
    input: { runDir, config, inputPath, roster },
  });
  actor.start();
  await toPromise(actor);
  const snapshot = actor.getSnapshot();
  if (snapshot.value === "done") {
    const escalated = snapshot.context.convergence?.status === "escalated";
    await writeDecisionRecord(runDir, snapshot.context.convergence);
    await setStatus(runDir, escalated ? "escalated" : "completed");
    return 0;
  }
  const failure = snapshot.context.failure ?? {
    reason: `resumed protocol ended in non-success state "${String(snapshot.value)}"`,
    timedOut: false,
  };
  process.stderr.write(`protocol error: ${failure.reason}\n`);
  await setStatus(runDir, failure.timedOut ? "timeout" : "failed", failure.reason);
  return 1;
}
