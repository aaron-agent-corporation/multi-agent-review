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

/** Append an artifact entry, bump updatedAt, and atomically persist. Returns the new manifest. */
export async function addArtifact(runDir: string, entry: ManifestArtifact): Promise<Manifest> {
  const current = await readManifest(runDir);
  const next: Manifest = {
    ...current,
    updatedAt: new Date().toISOString(),
    artifacts: [...current.artifacts, entry],
  };
  await writeManifestAtomic(runDir, next);
  return next;
}

/** Set run status, bump updatedAt, atomically persist. */
export async function setStatus(runDir: string, status: ManifestStatus): Promise<Manifest> {
  const current = await readManifest(runDir);
  const next: Manifest = { ...current, status, updatedAt: new Date().toISOString() };
  await writeManifestAtomic(runDir, next);
  return next;
}

/**
 * Record an agent dropped mid-run by partial-failure handling (D-30). Appended to the manifest's
 * `droppedAgents` audit list so the smaller surviving roster is explained, never silent. Sequential
 * (read-modify-write) like {@link addArtifact} — callers must invoke it OUTSIDE a concurrent fan-out.
 */
export async function addDroppedAgent(runDir: string, entry: DroppedAgent): Promise<Manifest> {
  const current = await readManifest(runDir);
  const next: Manifest = {
    ...current,
    updatedAt: new Date().toISOString(),
    droppedAgents: [...current.droppedAgents, entry],
  };
  await writeManifestAtomic(runDir, next);
  return next;
}
