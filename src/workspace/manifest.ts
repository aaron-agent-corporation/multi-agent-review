import { join } from "node:path";
import fsExtra from "fs-extra";
import {
  type DroppedAgent,
  Manifest,
  type ManifestArtifact,
  type ManifestStatus,
} from "../schema/manifest.js";

const { ensureDir, readFile, rename, writeFile } = fsExtra;

const MANIFEST_FILE = "manifest.json";

function manifestPath(runDir: string): string {
  return join(runDir, MANIFEST_FILE);
}

/**
 * Per-runDir in-process write serialization (WR-01). Each manifest mutator below is a
 * read-modify-write: it reads the current manifest, spreads in its change, and atomically renames.
 * The atomic rename prevents a TORN file but NOT a lost update — two overlapping read-modify-write
 * cycles against the same runDir would each read the same base and the second rename would clobber
 * the first's appended entry. The engine already drives manifest writes sequentially, but `mar
 * invoke` can fan a turn into a run concurrently with engine activity, so we chain every mutation
 * for a given runDir onto a per-dir promise tail. This guarantees in-process serializability:
 * read → modify → write runs to completion before the next mutation for that runDir begins.
 *
 * LIMITATION (documented, by design — D-16 / WR-01): this is IN-PROCESS only. Two SEPARATE OS
 * processes writing the same runDir can still lose an update — that needs an advisory/O_EXCL file
 * lock, which is intentionally out of scope for the current single-process engine. The manifest is
 * a single-writer-process audit trail; concurrent multi-process writers are unsupported.
 */
const writeChains = new Map<string, Promise<unknown>>();

function serializeWrite<T>(runDir: string, op: () => Promise<T>): Promise<T> {
  const prior = writeChains.get(runDir) ?? Promise.resolve();
  // Run `op` only after the prior write for this runDir settles (success OR failure — a failed
  // mutation must not wedge the chain). The chained promise is the new tail.
  const next = prior.then(op, op);
  // Keep the tail resolved-only so a rejection doesn't poison the next caller; prune when current.
  writeChains.set(
    runDir,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export interface CreateRunOptions {
  runDir: string;
  runId: string;
  cliVersions?: Record<string, string>;
  status?: ManifestStatus;
}

/**
 * Initialize a run on disk: ensure the run dir exists, build an initial Manifest
 * (status "created", empty artifacts), and write it atomically.
 */
export async function createRun(opts: CreateRunOptions): Promise<Manifest> {
  const now = new Date().toISOString();
  await ensureDir(opts.runDir);
  const manifest: Manifest = {
    runId: opts.runId,
    status: opts.status ?? "created",
    createdAt: now,
    updatedAt: now,
    cliVersions: opts.cliVersions ?? {},
    artifacts: [],
    droppedAgents: [],
  };
  await writeManifestAtomic(opts.runDir, manifest);
  return manifest;
}

/** Load + validate the manifest from disk. State is always re-derivable from this file. */
export async function readManifest(runDir: string): Promise<Manifest> {
  const raw = await readFile(manifestPath(runDir), "utf8");
  return Manifest.parse(JSON.parse(raw));
}

/**
 * Write the manifest via temp-file-then-rename (D-16). `rename(2)` is atomic on the same
 * filesystem, so a crash mid-write leaves the prior complete manifest, never a corrupt one.
 */
export async function writeManifestAtomic(runDir: string, manifest: Manifest): Promise<void> {
  // Validate before persisting — never write a manifest that won't parse back.
  const valid = Manifest.parse(manifest);
  const finalPath = manifestPath(runDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  await rename(tmpPath, finalPath);
}

/**
 * Append an artifact entry, bump updatedAt, and atomically persist. Returns the new manifest. The
 * read-modify-write is serialized per-runDir (WR-01) so a concurrent append cannot lose an entry.
 */
export async function addArtifact(runDir: string, entry: ManifestArtifact): Promise<Manifest> {
  return serializeWrite(runDir, async () => {
    const current = await readManifest(runDir);
    const next: Manifest = {
      ...current,
      updatedAt: new Date().toISOString(),
      artifacts: [...current.artifacts, entry],
    };
    await writeManifestAtomic(runDir, next);
    return next;
  });
}

/**
 * Set run status, bump updatedAt, atomically persist. When `failureReason` is supplied (a terminal
 * `failed`/`timeout`), it is recorded so the cause of an unsuccessful run is never discarded (CR-01).
 * Passing it as `undefined` on a successful transition leaves any prior reason untouched.
 */
export async function setStatus(
  runDir: string,
  status: ManifestStatus,
  failureReason?: string,
): Promise<Manifest> {
  return serializeWrite(runDir, async () => {
    const current = await readManifest(runDir);
    const next: Manifest = {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
      ...(failureReason !== undefined ? { failureReason } : {}),
    };
    await writeManifestAtomic(runDir, next);
    return next;
  });
}

/**
 * Record an agent dropped mid-run by partial-failure handling (D-30). Appended to the manifest's
 * `droppedAgents` audit list so the smaller surviving roster is explained, never silent. The
 * read-modify-write is serialized per-runDir (WR-01) like {@link addArtifact}, so a concurrent
 * append can no longer lose a drop record.
 */
export async function addDroppedAgent(runDir: string, entry: DroppedAgent): Promise<Manifest> {
  return serializeWrite(runDir, async () => {
    const current = await readManifest(runDir);
    const next: Manifest = {
      ...current,
      updatedAt: new Date().toISOString(),
      droppedAgents: [...current.droppedAgents, entry],
    };
    await writeManifestAtomic(runDir, next);
    return next;
  });
}
