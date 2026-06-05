import { existsSync, readdirSync } from "node:fs";
import matter from "gray-matter";
import { assign, createActor, fromPromise, setup, toPromise } from "xstate";
import { makeAdapter } from "../adapters/registry.js";
import { applySkipFailed } from "../gates.js";
import { logInvocation } from "../log/invocation.js";
import {
  type Classify,
  classifyClaude,
  classifyCodex,
  classifyGemini,
  withRetry,
} from "../retry.js";
import type { AgentEntry, MarConfig } from "../schema/config.js";
import { writeArtifact } from "../workspace/artifacts.js";
import { nextSeq } from "../workspace/layout.js";
import { addArtifact, addDroppedAgent, readManifest, setStatus } from "../workspace/manifest.js";
import { promoteDrafts, scopedWorkdir } from "../workspace/scope.js";
import { expectedParticipantCount, requiredArtifactsExist } from "./gate.js";
import { PHASES, type Phase } from "./phases.js";

/** Per-vendor transient-vs-fatal classifier for the retry seam (mirrors cli.ts CLASSIFY). */
const CLASSIFY: Record<AgentEntry["vendor"], Classify> = {
  claude: classifyClaude,
  codex: classifyCodex,
  gemini: classifyGemini,
};

/** Shared input every actor/guard reads from the machine context. */
interface ProtocolInput {
  runDir: string;
  config: MarConfig;
  inputPath: string;
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
interface PhaseResult {
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
async function runPhase(
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
        const parseFront = (text: string): unknown => matter(text).data;
        let result = phase.validate(parseFront(attempt.text));
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
          result = phase.validate(parseFront(attempt.text));
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
 * that SETS the designated integrator (e.g. from EvaluationFrontmatter.proposedBase agreement) lands
 * in 04-04; until then we deterministically designate the FIRST surviving agent so the integration
 * phase fans out over exactly one writer rather than the whole roster. PRECONDITION: integration
 * requires at least one survivor — guaranteed here because the prior phases' gate fails closed on a
 * zero-survivor roster, so `roster[0]` always exists when this runs.
 */
function designateIntegrator(roster: AgentEntry[]): AgentEntry {
  const integrator = roster[0];
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
): Promise<PhaseOutcome> {
  // REVW-04: the integration phase fans out over ONLY the designated integrator, not the surviving
  // roster. Every other phase fans out over all survivors. The gate's expectedParticipantCount
  // independently expects exactly 1 writer for the integrator phase, so a redundant non-integrator
  // merge (or a missing merge) fails the gate.
  const fanoutRoster = phase.participants === "integrator" ? [designateIntegrator(roster)] : roster;
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
}

/** A phase actor resolves with the surviving roster (continue) or a structured failure (fail). */
type PhaseEvent = { output: PhaseOutcome };

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
function buildMachine() {
  const phaseActor = fromPromise<
    PhaseOutcome,
    { phase: Phase; roster: AgentEntry[]; input: ProtocolInput }
  >(({ input }) => runPhaseGated(input.phase, input.roster, input.input));
  const promoteActor = fromPromise<void, { roster: AgentEntry[]; input: ProtocolInput }>(
    ({ input }) =>
      promoteDrafts(
        input.input.runDir,
        input.roster.map((a) => a.name),
      ),
  );

  // Build the per-phase states programmatically so the 6-phase series stays in lock-step with
  // PHASES (single source of the phase order). The draft phase advances to a transient `promote`
  // state (PROT-04 boundary) before review; every other phase advances to the next phase or done.
  const states: Record<string, unknown> = {};
  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i];
    const isLast = i + 1 >= PHASES.length;
    const next = phase.name === "draft" ? "promote" : isLast ? "done" : PHASES[i + 1].name;
    states[phase.name] = {
      invoke: {
        src: "phaseActor",
        input: ({ context }: { context: ProtocolContext }) => ({
          phase,
          roster: context.roster,
          input: context.input,
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
    actors: { phaseActor, promoteActor },
  }).createMachine({
    id: "protocol",
    initial: PHASES[0].name,
    context: ({ input }) => ({ input, roster: input.config.agents }),
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
    await setStatus(runDir, "completed");
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
