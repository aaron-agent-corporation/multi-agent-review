import { join } from "node:path";
import fsExtra from "fs-extra";
import type { AgentEntry } from "./schema/config.js";
import { PreflightCache, type PreflightResult } from "./schema/preflight.js";

const { ensureDir, pathExists, readFile, rename, writeFile } = fsExtra;

/** Cache directory + file (D-27): machine state, NOT run lineage — lives OUTSIDE runs/. */
const CACHE_DIR = ".mar";
const CACHE_FILE = "preflight.json";

/** ~10-minute TTL for the pre-flight cache (D-27). */
export const CACHE_TTL_MS = 600_000;

function cachePath(): string {
  return join(CACHE_DIR, CACHE_FILE);
}

/**
 * Per-vendor version extraction (Pitfall 2). The three `--version` formats differ:
 *   claude --version  -> "2.1.162 (Claude Code)"   (first token IS the semver)
 *   codex --version   -> "codex-cli 0.128.0"       (semver is the SECOND token)
 *   gemini --version  -> "0.45.0"                  (bare)
 * `split(/\s+/)[0]` is claude-ONLY and yields "codex-cli" for codex — WRONG. A semver regex match
 * is vendor-agnostic: it finds the `\d+\.\d+\.\d+` token wherever it sits. Returns "unknown" when no
 * semver is present (empty/garbage), so a missing version never masquerades as a real one.
 */
export function extractVersion(versionStdout: string): string {
  const m = versionStdout.match(/\d+\.\d+\.\d+/);
  return m ? m[0] : "unknown";
}

/**
 * Whether a cache `checkedAt` (ISO) is within the TTL window relative to `now`. A cache older than
 * `ttlMs` (~10 min) is stale and must be re-probed at run-start (Phase 3) — this bounds how long a
 * poisoned/stale cache could gate an unhealthy roster (T-02-14).
 */
export function isFresh(checkedAt: string, now: number = Date.now(), ttlMs = CACHE_TTL_MS): boolean {
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return false;
  return now - t < ttlMs;
}

/**
 * Persist the pre-flight results to `.mar/preflight.json` via temp-file-then-rename (D-16/D-27).
 * `rename(2)` is atomic on the same filesystem, so a crash mid-write leaves the prior complete cache,
 * never a corrupt/partial one (T-02-14). Validated by `PreflightCache.parse` before persisting — we
 * never write a cache that won't parse back. `checkedAt` is stamped at write time (drives the TTL).
 */
export async function writeCache(results: PreflightResult[]): Promise<void> {
  const cache: PreflightCache = {
    checkedAt: new Date().toISOString(),
    results,
  };
  const valid = PreflightCache.parse(cache);
  await ensureDir(CACHE_DIR);
  const finalPath = cachePath();
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  await rename(tmpPath, finalPath);
}

/**
 * Load + validate the cache from disk, or `undefined` when absent. Validation on read is a tampering
 * mitigation (T-02-14): a hand-edited/corrupt cache fails `PreflightCache.parse` and is treated as a
 * miss, forcing a fresh probe rather than trusting poisoned state.
 */
export async function readCache(): Promise<PreflightCache | undefined> {
  const p = cachePath();
  if (!(await pathExists(p))) return undefined;
  const raw = await readFile(p, "utf8");
  const parsed = PreflightCache.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : undefined;
}

/** Options for {@link runPreflight}. Implemented in Task 2. */
export interface RunPreflightOptions {
  probeTimeoutMs?: number;
  probePrompt?: string;
}

/**
 * Tiered pre-flight (ORCH-05) — IMPLEMENTED IN TASK 2 (GREEN). Placeholder so the version + cache
 * helpers above ship first under the TDD gate; the real tier-1/tier-2 body lands next.
 */
export async function runPreflight(
  _roster: AgentEntry[],
  _opts?: RunPreflightOptions,
): Promise<{ results: PreflightResult[]; allPass: boolean }> {
  throw new Error("runPreflight not yet implemented (Task 2)");
}
