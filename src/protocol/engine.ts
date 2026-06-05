import { existsSync, readdirSync } from "node:fs";
import { assign, createActor, fromPromise, setup, toPromise } from "xstate";
import { makeAdapter } from "../adapters/registry.js";
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
import { addArtifact, readManifest, setStatus } from "../workspace/manifest.js";
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

/**
 * Run ONE phase: fan the roster out N-wide with a bare settle-all (allSettled — never the
 * reject-fast variant, Pitfall 5; no concurrency-limiter dependency per the concurrency decision),
 * reuse the proven turn seam unchanged, and RESOLVE WITH the exact array of artifact paths actually
 * written. That `writtenPaths` array is the SINGLE SOURCE OF TRUTH the phase gate consumes — no
 * seq/path is recomputed anywhere else.
 */
async function runPhase(phase: Phase, input: ProtocolInput): Promise<string[]> {
  const { runDir, config, inputPath } = input;
  const roster = config.agents;
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

  const settled = await Promise.allSettled(
    roster.map(async (entry, index): Promise<WrittenArtifact | null> => {
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
        return null;
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
      return { absPath: written.path, relPath, agent: entry.name, seq };
    }),
  );

  // Index every written artifact into the manifest SEQUENTIALLY (no concurrent manifest writes).
  // Collect ONLY the paths actually written (one per ok turn). A rejected/failed turn contributes
  // nothing — the gate then sees a short write.
  const writtenPaths: string[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const { absPath, relPath, agent, seq } = r.value;
    await addArtifact(runDir, {
      path: relPath,
      agent,
      seq,
      kind: phase.kind,
      createdAt: new Date().toISOString(),
    });
    writtenPaths.push(absPath);
  }
  return writtenPaths;
}

interface ProtocolContext {
  input: ProtocolInput;
  /** Paths the most recent phase fan-out actually wrote (the gate's single source of truth). */
  writtenPaths: string[];
}

type PhaseEvent = { output: string[] };

/**
 * The phase gate guard, as a pure predicate over the actor's resolved `writtenPaths`: every
 * written artifact must be isDone AND the writer count must match the expected participant count
 * (so a failed/short-writing agent fails the gate). The gate input is EXACTLY the fan-out's
 * written paths — no seq/path is recomputed.
 */
function phasePasses(roster: AgentEntry[], phase: Phase, writtenPaths: string[]): boolean {
  return (
    requiredArtifactsExist(writtenPaths) &&
    writtenPaths.length === expectedParticipantCount(phase, roster)
  );
}

/**
 * The 6-phase protocol as an XState v5 machine. Each phase is a state that invokes a
 * `fromPromise` fan-out actor (resolving with the written paths); a guard then checks the gate
 * over EXACTLY those paths plus the expected writer count before advancing. The draft state runs
 * `promoteDrafts` (PROT-04 boundary) as a dedicated awaited actor in a transient `promote` state
 * placed BETWEEN draft and review. On any gate failure the machine routes to a `failed` final
 * state; on all 6 passing, to `done`. Terminal `setStatus` is applied by {@link runProtocol} off
 * the resolved final state so no async action races the manifest write.
 */
function buildMachine() {
  const phaseActor = fromPromise<string[], { phase: Phase; input: ProtocolInput }>(({ input }) =>
    runPhase(input.phase, input.input),
  );
  const promoteActor = fromPromise<void, { input: ProtocolInput }>(({ input }) =>
    promoteDrafts(
      input.input.runDir,
      input.input.config.agents.map((a) => a.name),
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
        input: ({ context }: { context: ProtocolContext }) => ({ phase, input: context.input }),
        onDone: [
          {
            guard: ({ context, event }: { context: ProtocolContext; event: PhaseEvent }) =>
              phasePasses(context.input.config.agents, phase, event.output),
            target: next,
            actions: assign({
              writtenPaths: ({ event }: { event: PhaseEvent }) => event.output,
            }),
          },
          { target: "failed" },
        ],
        onError: { target: "failed" },
      },
    };
  }

  // Transient state: promote drafts to shared/ at the draft->review boundary, THEN enter review.
  states.promote = {
    invoke: {
      src: "promoteActor",
      input: ({ context }: { context: ProtocolContext }) => ({ input: context.input }),
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
    context: ({ input }) => ({ input, writtenPaths: [] }),
    states: states as never,
  });
}

/**
 * Drive an input document through the 6-phase review protocol. Returns 0 when the run completes,
 * non-zero when a phase gate fails. PROT-01/03/04.
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
