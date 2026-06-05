import { readFile } from "node:fs/promises";
import matter from "gray-matter";

/**
 * The ONE shared tolerant agent-frontmatter reader (Pitfall 4 fix). The on-disk artifact `.md`
 * carries the engine-metadata wrapper block FIRST (writeArtifact prepends
 * agent/seq/kind/timestamp/runId/phase for the audit trail); the AGENT'S own structured frontmatter
 * lives in the body AFTER it. Every consumer that validates the agent's emitted frontmatter (the
 * engine validation gate, the convergence loop, the decision-record writer, and — in 05-04 — resume
 * re-validation) must parse the SAME way, or a preamble-prefixed artifact the live gate accepted is
 * silently dropped by a stricter reader (Pitfall 4: a valid artifact that passed the gate but the
 * strict double-parse in converge.ts / decision-record.ts returned empty data for).
 *
 * This module unifies that read. It strips the engine wrapper, then applies the TOLERANT fallback
 * battle-tested live in the Phase-4 checkpoint (engine.ts parseFront): models — claude especially —
 * sometimes emit preamble prose before the artifact despite the contract's output-channel rule, and
 * gray-matter only recognizes a frontmatter block at position 0. When the direct parse of the inner
 * body yields no data we fall back to the FIRST `---` delimiter line and parse from there.
 *
 * Leniency applies ONLY to WHERE the frontmatter is found, NEVER to its shape: callers keep their own
 * strict zod `safeParse` of the returned `data` (fail-closed, D-38). gray-matter stays strictly
 * READ-only (T-04-07) — no `matter.stringify`; gray-matter's default js-yaml SAFE load is preserved.
 */

/**
 * The tolerant fallback over a single gray-matter parse: if the direct `matter(text).data` has keys
 * use it; otherwise match the first `^---$` delimiter line (preamble prose precedes it) and parse
 * from there. Mirrors engine.ts:198-206 exactly — the variant hardened in the 04-05 live checkpoint.
 */
function tolerantData(text: string): unknown {
  const direct = matter(text).data;
  if (direct && Object.keys(direct).length > 0) return direct;
  const delim = text.match(/^---\s*$/m);
  if (delim?.index !== undefined && delim.index > 0) {
    return matter(text.slice(delim.index)).data;
  }
  return direct;
}

/**
 * Parse the agent's emitted frontmatter from already-read artifact text (no I/O — so resume
 * re-validation in 05-04 can validate text it already holds without a second read). Strips the
 * engine-metadata wrapper with `matter(raw)`, `.trimStart()`s the inner body (gray-matter only
 * recognizes frontmatter at position 0 — the wrapped body begins with a leading `\n`), then applies
 * the tolerant fallback. Returns the parsed frontmatter `data` object (possibly `{}` when none found).
 */
export function parseAgentFrontmatter(raw: string): unknown {
  const outer = matter(raw);
  return tolerantData(outer.content.trimStart());
}

/**
 * Read the agent's emitted frontmatter back from a written artifact at `path`. Returns null when the
 * file is missing/unreadable (a non-signal — that artifact simply does not contribute), preserving
 * the existing non-signal semantics of the readers this replaces. Otherwise delegates to
 * `parseAgentFrontmatter`. Callers keep their own strict zod validation of the returned data.
 */
export async function readAgentFrontmatter(path: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  return parseAgentFrontmatter(raw);
}
