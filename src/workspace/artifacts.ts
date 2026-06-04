import { existsSync, statSync } from "node:fs";
import fsExtra from "fs-extra";
import { artifactPath, rawPath } from "./layout.js";

const { ensureDir, rename, writeFile } = fsExtra;

export interface WriteArtifactOptions {
  /** The agent's text output — becomes the markdown body. */
  text: string;
  /** Raw vendor CLI JSON — preserved verbatim as the sibling .raw.json (D-10, never discarded). */
  raw: unknown;
  /** Extra frontmatter fields (vendor, runId, turnId, invocation log ref, ...). */
  frontmatter?: Record<string, string | number>;
  /** Artifact kind; defaults to "output". */
  kind?: string;
}

/** Serialize a flat object to a minimal YAML frontmatter block. */
function toFrontmatter(fields: Record<string, string | number>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** Write a file atomically: temp-file-then-rename on the same filesystem. */
async function writeAtomic(finalPath: string, data: string): Promise<void> {
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, data, "utf8");
  await rename(tmpPath, finalPath);
}

/**
 * Write the normalized markdown artifact (YAML frontmatter + text body) and its sibling
 * raw-JSON file, both atomically (D-10, D-16). Returns the two paths.
 */
export async function writeArtifact(
  runDir: string,
  seq: number,
  agent: string,
  opts: WriteArtifactOptions,
): Promise<{ path: string; rawPath: string }> {
  const kind = opts.kind ?? "output";
  await ensureDir(runDir);

  const mdPath = artifactPath(runDir, seq, agent, kind);
  const rawJsonPath = rawPath(runDir, seq, agent, kind);

  const frontmatter = toFrontmatter({
    agent,
    seq,
    kind,
    timestamp: new Date().toISOString(),
    ...(opts.frontmatter ?? {}),
  });
  const body = `${frontmatter}\n${opts.text}\n`;

  await writeAtomic(mdPath, body);
  await writeAtomic(rawJsonPath, `${JSON.stringify(opts.raw, null, 2)}\n`);

  return { path: mdPath, rawPath: rawJsonPath };
}

/**
 * Done-detection (PROT-02 / ARCHITECTURE Anti-Pattern 4): a turn is done only when its
 * artifact file exists AND is non-empty. A half-written or missing file is never "done".
 */
export function isDone(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}
