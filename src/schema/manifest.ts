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
});

export type Manifest = z.infer<typeof Manifest>;
export type ManifestStatus = Manifest["status"];
