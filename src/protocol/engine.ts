import { existsSync, readdirSync } from "node:fs";
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
      // Minimal placeholder prompt — structured per-phase CONTENT is Phase 4 (RESEARCH A4); a
      // minimal prompt that yields *a* phase artifact is correct here.
      const promptText = `phase: ${phase.name}\ninput: ${inputPath}`;
      const promptRef = `inline:phase:${phase.name}`;
      // PROT-04: only the draft phase runs in an isolated per-agent cwd. The scoped draft artifact
      // is also WRITTEN into that per-agent dir (`work/<agent>/`), so a peer can never read it from
      // a shared location until promoteDrafts copies it at the boundary. Non-scoped phases write
      // straight into the run dir (the shared workspace).
      const cwd = phase.scoped ? await scopedWorkdir(runDir, entry.name, inputPath) : undefined;
      const artifactDir = cwd ?? runDir;

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

      const secs = (turn.durationMs / 1000).toFixed(1);
      if (!turn.ok) {
        const reason = turn.timedOut ? "timeout" : (turn.error ?? "failed");
        process.stdout.write(`  ${entry.name} ✗  ${secs}s  (${reason})\n`);
        return { entry, failure: reason };
      }

      const written = await writeArtifact(artifactDir, seq, entry.name, {
        text: turn.text,
        raw: turn,
        kind: phase.kind,
        frontmatter: { runId: manifest.runId, phase: phase.name },
      });
      // Manifest path is ALWAYS relative to the run dir (scoped drafts live under work/<agent>/).
      const relPath = written.path.slice(runDir.length + 1);
      process.stdout.write(`  ${entry.name} ✓  ${secs}s  → ${relPath}\n`);
      return { entry, written: { absPath: written.path, relPath, agent: entry.name, seq } };
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
 * Run a phase AND decide its outcome, applying partial-failure handling (D-30) and the artifacts
 * gate (PROT-03) together. Returns the surviving roster to carry into the next phase, or `null` to
 * fail the run. Steps:
 *
 *   1. Fan out over the current roster (runPhase) → writtenPaths + ok/failed partition.
 *   2. If any agent failed, apply `applySkipFailed(survivors, failed)`. It re-asserts the
 *      >=2-distinct-vendor invariant over the SURVIVORS, so dropping can never silently produce a
 *      single-vendor run. If it throws, the run fails (return null). Each dropped agent is recorded
 *      in the manifest's audit list (never a silent drop).
 *   3. Gate the phase on EXACTLY the survivors' written paths: every path isDone AND the written
 *      count equals the expected participant count for the SURVIVING roster (so a survivor that
 *      claimed success but wrote a short/0-byte artifact still fails the gate, PROT-03 / Pitfall 3).
 *
 * The roster shrinks monotonically across phases: an agent dropped in draft never participates in
 * review, and the gate/expected-count always reflect the live surviving roster.
 */
async function runPhaseGated(
  phase: Phase,
  roster: AgentEntry[],
  input: ProtocolInput,
): Promise<AgentEntry[] | null> {
  const { writtenPaths, ok, failed } = await runPhase(phase, roster, input);

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
      return null;
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
  // count is the SURVIVING roster's participant count, so a survivor short-write fails the gate.
  const passes =
    requiredArtifactsExist(writtenPaths) &&
    writtenPaths.length === expectedParticipantCount(phase, survivors);
  return passes ? survivors : null;
}

interface ProtocolContext {
  input: ProtocolInput;
  /** The LIVE surviving roster, shrinking as agents are dropped (D-30). */
  roster: AgentEntry[];
}

/** A phase actor resolves with the surviving roster (continue) or null (fail the run). */
type PhaseEvent = { output: AgentEntry[] | null };

/**
 * The 6-phase protocol as an XState v5 machine. Each phase is a state that invokes a `fromPromise`
 * actor running {@link runPhaseGated} over the LIVE roster; the actor resolves with the surviving
 * roster (continue) or null (fail). A guard advances only on a non-null survivor set and assigns it
 * to context so the next phase fans out over the shrunken roster. The draft state runs
 * `promoteDrafts` (PROT-04 boundary) as a dedicated awaited actor in a transient `promote` state
 * placed BETWEEN draft and review, promoting ONLY the surviving drafters. On any failure the
 * machine routes to a `failed` final state; on all 6 passing, to `done`. Terminal `setStatus` is
 * applied by {@link runProtocol} off the resolved final state so no async action races the manifest.
 */
function buildMachine() {
  const phaseActor = fromPromise<
    AgentEntry[] | null,
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
            guard: ({ event }: { event: PhaseEvent }) => event.output !== null,
            target: next,
            actions: assign({
              roster: ({ event }: { event: PhaseEvent }) => event.output as AgentEntry[],
            }),
          },
          { target: "failed" },
        ],
        onError: { target: "failed" },
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
      onError: { target: "failed" },
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
  const final = actor.getSnapshot().value;
  const ok = final === "done";
  await setStatus(runDir, ok ? "completed" : "failed");
  return ok ? 0 : 1;
}
