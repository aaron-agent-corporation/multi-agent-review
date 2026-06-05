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
  status: z.enum(["created", "running", "completed", "failed", "timeout"]),
  createdAt: z.string(), // ISO
  updatedAt: z.string(), // ISO
  cliVersions: z.record(z.string(), z.string()), // { claude: "2.1.162" }
  artifacts: z.array(ManifestArtifact),
  // Agents dropped mid-run by partial-failure handling (D-30). Optional/defaulted so existing
  // manifests (and the common all-healthy run) parse unchanged.
  droppedAgents: z.array(DroppedAgent).default([]),
});

export type Manifest = z.infer<typeof Manifest>;
export type ManifestStatus = Manifest["status"];
