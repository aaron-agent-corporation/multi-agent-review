import { join } from "node:path";
import { customAlphabet } from "nanoid";

// URL/path-safe alphabet — no "/" or ".." can ever appear in a run id (T-01-01 mitigation).
const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_",
  6,
);

/**
 * Sortable, collision-safe run id: `YYYYMMDD` timestamp prefix + `-` + nanoid(6) (D-13).
 * e.g. "20260604-x7Kp2a".
 */
export function newRunId(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}-${nanoid()}`;
}

/** Run directory relative to the project workspace: `runs/<runId>`. */
export function runDir(runId: string): string {
  return join("runs", runId);
}

/**
 * Deterministic artifact filename: `<seq>-<agent>-<kind>.md`, seq zero-padded to 3 (D-11).
 * Default kind is "output"; Phase 3 extends kind to protocol phases.
 */
export function artifactName(seq: number, agent: string, kind = "output"): string {
  return `${String(seq).padStart(3, "0")}-${agent}-${kind}.md`;
}

/** Full path to the normalized markdown artifact within a run dir. */
export function artifactPath(
  runDirPath: string,
  seq: number,
  agent: string,
  kind = "output",
): string {
  return join(runDirPath, artifactName(seq, agent, kind));
}

/** Sibling raw-JSON path: the artifact path with `.md` replaced by `.raw.json`. */
export function rawPath(runDirPath: string, seq: number, agent: string, kind = "output"): string {
  return artifactPath(runDirPath, seq, agent, kind).replace(/\.md$/, ".raw.json");
}

/**
 * Extract the leading zero-padded seq from an artifact filename (`<seq>-<agent>-<kind>.md`),
 * or `null` when the name does not match the deterministic pattern. Used to derive the next
 * monotonic seq from files already on disk (WR-03).
 */
export function seqFromArtifactName(name: string): number | null {
  const m = /^(\d+)-.+\.md$/.exec(name);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isInteger(n) ? n : null;
}

/**
 * Compute the next monotonic turn seq for a run (WR-03). Seq must advance over ALL turns, not
 * just the successful ones recorded in the manifest, so a resumed run can never reuse a seq and
 * overwrite a prior artifact. Takes the max seq seen across the manifest's recorded artifact
 * paths AND any artifact files present on disk, then returns that max + 1 (1 for an empty run).
 */
export function nextSeq(manifestArtifactPaths: string[], onDiskNames: string[]): number {
  let max = 0;
  for (const p of manifestArtifactPaths) {
    const s = seqFromArtifactName(p.split("/").pop() ?? p);
    if (s !== null && s > max) max = s;
  }
  for (const name of onDiskNames) {
    const s = seqFromArtifactName(name);
    if (s !== null && s > max) max = s;
  }
  return max + 1;
}
