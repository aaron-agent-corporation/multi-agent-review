import { z } from "zod";

/**
 * One artifact entry indexed by the manifest. `path` is relative to the run dir.
 */
export const ManifestArtifact = z.object({
  path: z.string(),
  agent: z.string(),
  seq: z.number(),
  kind: z.string(),
  createdAt: z.string(), // ISO
});

export type ManifestArtifact = z.infer<typeof ManifestArtifact>;

/**
 * A roster agent dropped mid-run by the partial-failure handler (D-30 / applySkipFailed). Recorded
 * so the run's audit trail explains why the surviving roster is smaller than the configured one
 * (e.g. gemini's headless-auth failure). The run still completes as long as >=2 distinct vendors
 * survive; dropping is observable, never silent.
 */
export const DroppedAgent = z.object({
  agent: z.string(),
  vendor: z.string(),
  phase: z.string(), // the phase whose fan-out the agent failed in
  reason: z.string(),
  droppedAt: z.string(), // ISO
});

export type DroppedAgent = z.infer<typeof DroppedAgent>;

/**
 * Authoritative per-run index (D-14, PROT-07). Run state is always re-derivable from this
 * file on disk. `timeout` is kept distinct from `failed` for D-17 observability.
 */
export const Manifest = z.object({
  runId: z.string(), // "20260604-x7Kp2a"
  // "escalated" is the O-2 fallback-base outcome: the run completed the protocol but converged via
  // an escalation rather than unanimous agreement. Additive (mirrors the optional droppedAgents
  // precedent) so prior manifests parse unchanged.
  // "paused-awaiting-approval" is the NON-terminal gated-mode pause status (D-50/Q7): the run halted
  // at a phase boundary awaiting human approval and is resumable. Additive in the same style — prior
  // manifests (which never carry it) parse unchanged.
  status: z.enum([
    "created",
    "running",
    "completed",
    "failed",
    "timeout",
    "escalated",
    "paused-awaiting-approval",
  ]),
  createdAt: z.string(), // ISO
  updatedAt: z.string(), // ISO
  cliVersions: z.record(z.string(), z.string()), // { claude: "2.1.162" }
  artifacts: z.array(ManifestArtifact),
  // Agents dropped mid-run by partial-failure handling (D-30). Optional/defaulted so existing
  // manifests (and the common all-healthy run) parse unchanged.
  droppedAgents: z.array(DroppedAgent).default([]),
  // Human-readable cause of a terminal `failed`/`timeout` status (CR-01). Records WHY a protocol
  // run ended unsuccessfully (the failing agent/gate reason, or an engine-internal actor error) so
  // the cause is never silently discarded. Optional so prior manifests and successful runs parse
  // unchanged.
  failureReason: z.string().optional(),
});

export type Manifest = z.infer<typeof Manifest>;
export type ManifestStatus = Manifest["status"];

/**
 * The SINGLE explicit source of resumability (Q7, Pitfall 6). Terminal-vs-resumable is enforced
 * nowhere else today; the `mar resume` command (05-04) is the first reader. Defining these sets once,
 * here next to the enum, keeps the two notions from drifting and makes the filter testable.
 *
 * A status is RESUMABLE when the run can be re-derived from disk and driven forward: `running` (an
 * interrupted in-flight run), `failed`/`timeout` (D-57: these ARE resumable — a re-run picks up the
 * FULL roster), and `paused-awaiting-approval` (a gated-mode boundary pause). It is TERMINAL-done when
 * the protocol finished: `completed` (unanimous) or `escalated` (O-2 fallback). `created` is neither —
 * a run that never started has no phase to resume into.
 *
 * Typed as `readonly ManifestStatus[]` so adding or renaming an enum member that should belong here
 * surfaces a compile error at the literal (the array entries are checked against `ManifestStatus`).
 */
export const RESUMABLE_STATUSES = [
  "running",
  "failed",
  "timeout",
  "paused-awaiting-approval",
] as const satisfies readonly ManifestStatus[];

export const TERMINAL_DONE = [
  "completed",
  "escalated",
] as const satisfies readonly ManifestStatus[];
