import { join } from "node:path";
import { customAlphabet } from "nanoid";

// URL/path-safe alphabet — no "/" or ".." can ever appear in a run id (T-01-01 mitigation).
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_", 6);

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
export function artifactPath(runDirPath: string, seq: number, agent: string, kind = "output"): string {
  return join(runDirPath, artifactName(seq, agent, kind));
}

/** Sibling raw-JSON path: the artifact path with `.md` replaced by `.raw.json`. */
export function rawPath(runDirPath: string, seq: number, agent: string, kind = "output"): string {
  return artifactPath(runDirPath, seq, agent, kind).replace(/\.md$/, ".raw.json");
}
