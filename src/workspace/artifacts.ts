import { existsSync, statSync } from "node:fs";
import fsExtra from "fs-extra";
import { artifactPath, rawPath } from "./layout.js";

const { ensureDir, remove, rename, writeFile } = fsExtra;

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

/**
 * Serialize a single scalar to a YAML-safe representation. Vendor-controlled values
 * (e.g. `sessionId`, which `cli.ts` copies verbatim from the claude CLI JSON) may contain
 * newlines, a leading `---`, or `: ` sequences that would break the frontmatter delimiters or
 * inject arbitrary keys (CR-01). Numbers are emitted bare; strings are flattened (CR/LF →
 * spaces, remaining C0 control chars + DEL stripped) and JSON-stringified, which yields a
 * quoted, escaped double-quoted scalar that is valid YAML.
 */
// C0 control characters (U+0000-U+001F) plus DEL (U+007F). Built from a string literal so no
// raw control byte is embedded in this source file.
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping control chars.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function yamlScalar(v: string | number): string {
  if (typeof v === "number") return String(v);
  const flattened = v.replace(/\r?\n/g, " ").replace(CONTROL_CHARS, "");
  return JSON.stringify(flattened);
}

/** Serialize a flat object to a minimal, injection-safe YAML frontmatter block (CR-01). */
function toFrontmatter(fields: Record<string, string | number>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${yamlScalar(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

/** The temp-file name used by the staged two-file write (single source for write + cleanup). */
function tmpFor(finalPath: string): string {
  return `${finalPath}.tmp-${process.pid}`;
}

/**
 * Write the normalized markdown artifact (YAML frontmatter + text body) and its sibling
 * raw-JSON file (D-10, D-16). Returns the two paths.
 *
 * WR-06 (Phase 3): the PAIR is made crash-safe. Both temp files are written FIRST, then the
 * `.raw.json` is renamed into place, then the `.md` last. Because the `.md` is the gate's
 * done-signal (isDone), ordering its rename LAST guarantees the invariant **md-present implies
 * raw-present**: a crash can leave a `.raw.json` with no `.md` (harmless — the gate ignores it and
 * WR-05 keeps its seq monotonic), but never a "done" `.md` whose raw is missing (which would
 * violate D-10). If the raw rename fails, the staged `.md` temp is best-effort removed so a
 * half-write leaves no stray temp behind.
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

  // 1. Stage BOTH temp files before any rename — a crash here leaves only temps (no live artifact).
  const mdTmp = tmpFor(mdPath);
  const rawTmp = tmpFor(rawJsonPath);
  await writeFile(mdTmp, body, "utf8");
  try {
    await writeFile(rawTmp, `${JSON.stringify(opts.raw, null, 2)}\n`, "utf8");
  } catch (err) {
    await remove(mdTmp).catch(() => {}); // best-effort: don't leave the md temp behind
    throw err;
  }

  // 2. Rename raw FIRST, then md LAST. md (the done-signal) appearing last ⇒ md-present⇒raw-present.
  try {
    await rename(rawTmp, rawJsonPath);
  } catch (err) {
    await remove(mdTmp).catch(() => {});
    throw err;
  }
  await rename(mdTmp, mdPath);

  return { path: mdPath, rawPath: rawJsonPath };
}

/**
 * Done-detection (PROT-02 / ARCHITECTURE Anti-Pattern 4): a turn is done only when its
 * artifact file exists AND is non-empty. A half-written or missing file is never "done".
 */
export function isDone(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;
}
