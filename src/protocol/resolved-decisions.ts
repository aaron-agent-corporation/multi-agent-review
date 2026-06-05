import { join } from "node:path";
import fsExtra from "fs-extra";
import matter from "gray-matter";
import {
  type ResolvedDecisionEntry,
  ResolvedDecisionsLedger,
} from "../schema/resolved-decisions.js";
import { serializeWrite } from "../workspace/manifest.js";

const { ensureDir, readFile, rename, writeFile } = fsExtra;

/**
 * The rolling resolved-decisions ledger (D-63): `runs/<id>/shared/resolved-decisions.md`. It lives
 * under the run's `shared/` workspace so every non-scoped phase's cwd reaches it (Q5 option (b)) and
 * agents can read it as a peer artifact. Settled forks are appended to it as they resolve (response
 * concessions, convergence concessions, majority tie-breaks, integrator calls, human rulings); the
 * re-litigation guard (D-62/D-64) reads its settled ids to refuse reopening a decision.
 */
export const LEDGER_FILE = join("shared", "resolved-decisions.md");

/**
 * C0 control chars (U+0000-U+001F) + DEL. Built so NO raw control byte is embedded in this source
 * file; used by the injection-safe scalar serializer below (CR-01 / T-05-17). Mirrors the discipline
 * in decision-record.ts — the ledger body is agent-authored prose (rationales) and is parsed back on
 * read, so the WRITE must never let a crafted rationale inject keys or break the frontmatter.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping control chars.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Serialize ONE scalar to injection-safe YAML (reuses the decision-record.ts yamlScalar discipline,
 * T-05-17). Numbers bare; strings flattened (CR/LF → space, control chars stripped) then JSON-quoted
 * (a valid double-quoted YAML scalar). The ledger's rationale/summary are agent-authored prose, so a
 * crafted value (newline + `injected: key`, or a stray `---`) must never escape the scalar.
 */
function yamlScalar(v: string | number): string {
  if (typeof v === "number") return String(v);
  const flattened = v.replace(/\r?\n/g, " ").replace(CONTROL_CHARS, "");
  return JSON.stringify(flattened);
}

/**
 * Serialize the assembled, schema-validated ledger to an injection-safe YAML frontmatter block PLUS a
 * one-line-per-fork digest body (D-65: decision + one-line rationale + resolver — full lineage stays
 * in the frontmatter `lineage` field, not the digest). gray-matter stays strictly READ-only
 * (T-04-07): the WRITE path is this hand-rolled scalar-escaping serializer — never `matter.stringify`.
 * Nested arrays of decision objects are emitted as a YAML block sequence with each scalar escaped.
 */
function serializeLedger(ledger: ResolvedDecisionsLedger): string {
  const lines: string[] = [];
  lines.push(`runId: ${yamlScalar(ledger.runId)}`);

  if (ledger.decisions.length === 0) {
    lines.push("decisions: []");
  } else {
    lines.push("decisions:");
    for (const d of ledger.decisions) {
      lines.push(`  - id: ${yamlScalar(d.id)}`);
      lines.push(`    summary: ${yamlScalar(d.summary)}`);
      lines.push(`    rationale: ${yamlScalar(d.rationale)}`);
      lines.push(`    resolver: ${yamlScalar(d.resolver)}`);
      if (d.lineage.length === 0) {
        lines.push("    lineage: []");
      } else {
        lines.push("    lineage:");
        for (const ref of d.lineage) lines.push(`      - ${yamlScalar(ref)}`);
      }
    }
  }

  const frontmatter = `---\n${lines.join("\n")}\n---\n`;
  return `${frontmatter}\n${renderDigest(ledger)}\n`;
}

/**
 * The human/agent-readable digest body (D-65): ONE line per settled fork — decision summary, a single
 * rationale line, and what resolved it. This is the contract agents read; the per-turn prompt only
 * points at this file (D-37 thin-prompt convention — the ledger IS the digest, never inlined).
 */
function renderDigest(ledger: ResolvedDecisionsLedger): string {
  const out: string[] = [`# Resolved decisions — ${ledger.runId}`, ""];
  out.push("These forks are SETTLED. Do not re-litigate them in any later phase.");
  out.push("");
  if (ledger.decisions.length === 0) {
    out.push("None settled yet.");
  } else {
    for (const d of ledger.decisions) {
      out.push(`- **${d.summary}** (${d.id}) — resolved by ${d.resolver}`);
      out.push(`  - ${d.rationale}`);
    }
  }
  return out.join("\n");
}

/** Absolute path of the rolling ledger under a run dir. */
function ledgerPath(runDir: string): string {
  return join(runDir, LEDGER_FILE);
}

/**
 * Read + validate the current rolling ledger (tolerant reader; gray-matter READ-only). Returns an
 * empty `{ runId, decisions: [] }` ledger when the file is absent (additive default — a run with zero
 * settled forks has no ledger yet). The frontmatter is attacker-influenceable content (agents author
 * the underlying rationales), so it is parsed via the shared tolerant reader and validated by the
 * 05-02 schema before use (fail-closed: a malformed ledger throws rather than silently coercing).
 *
 * Unlike an agent artifact, the ledger has NO engine-metadata wrapper (it is the orchestrator's own
 * peer artifact): its frontmatter is at position 0, so it is read with a single gray-matter parse
 * (READ-only, js-yaml SAFE load — T-04-07), not the double-strip agent reader.
 */
export async function readLedger(runDir: string): Promise<ResolvedDecisionsLedger> {
  let raw: string;
  try {
    raw = await readFile(ledgerPath(runDir), "utf8");
  } catch {
    // No ledger yet (no fork has settled) — return the empty, parseable default keyed by run dir.
    return { runId: deriveRunId(runDir), decisions: [] };
  }
  return ResolvedDecisionsLedger.parse(matter(raw).data);
}

/**
 * Derive the runId from the run dir basename as a defensive default for the empty-ledger case (the
 * ledger does not yet exist, so the runId is taken from the dir; the real runId is supplied by the
 * caller on the FIRST append via `runId`). Falls back to "unknown" for a degenerate empty path.
 */
function deriveRunId(runDir: string): string {
  const base = runDir.split(/[\\/]/).filter(Boolean).pop();
  return base && base.length > 0 ? base : "unknown";
}

/**
 * Append settled forks to the rolling ledger (D-63), idempotently and injection-safely. Read the
 * current ledger (empty if absent), append the new entries — DEDUPING by `id` so re-appending an
 * already-settled fork is a no-op (a phase boundary may re-derive the same settled set) — validate the
 * assembled ledger against the 05-02 schema, and write atomically (temp-then-rename). The whole
 * read-modify-write is routed through the per-runDir `serializeWrite` chain (Pitfall 7) so two
 * same-phase appends never lose an entry to a clobbering rename.
 *
 * `runId` keys the ledger (the empty default derives it from the dir; the first real append pins it).
 * The WRITE uses the hand-rolled scalar serializer — gray-matter is never asked to stringify (T-05-17).
 */
export async function appendResolved(
  runDir: string,
  runId: string,
  entries: ResolvedDecisionEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  await serializeWrite(runDir, async () => {
    const current = await readLedger(runDir);
    const byId = new Map<string, ResolvedDecisionEntry>();
    for (const d of current.decisions) byId.set(d.id, d);
    // Append, deduping by id (first-write-wins: an already-settled id is NOT overwritten — a settled
    // fork is settled, idempotent re-appends must not mutate its recorded resolution).
    for (const e of entries) {
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    const next = ResolvedDecisionsLedger.parse({
      runId,
      decisions: [...byId.values()],
    });
    const content = serializeLedger(next);
    await ensureDir(join(runDir, "shared"));
    const finalPath = ledgerPath(runDir);
    const tmpPath = `${finalPath}.tmp-${process.pid}`;
    await writeFile(tmpPath, content, "utf8");
    await rename(tmpPath, finalPath);
  });
}

/**
 * Detect re-litigation (D-64): given the ledger's SETTLED decision ids and a later-phase artifact's
 * already-parsed frontmatter, return which settled ids that artifact reopens. A position reopens a
 * settled decision when it re-raises that decision's `id` — matched against the shared decision-id
 * key the contested-collection uses (e.g. a response re-raising `response-<author>-issue-<ref>`, or an
 * integration re-raising `integration-<additionRef>`). The frontmatter is parsed defensively: a
 * non-object or a shape we don't recognize reopens nothing (fail-open on detection — enforcement, not
 * parsing, is the guard).
 */
export function detectRelitigation(
  settledIds: Set<string>,
  artifactFrontmatter: unknown,
): { relitigatedIds: string[] } {
  const ids = collectDecisionIds(artifactFrontmatter);
  const relitigatedIds = ids.filter((id) => settledIds.has(id));
  return { relitigatedIds };
}

/**
 * Collect the decision ids a later-phase artifact's frontmatter touches, in the SAME id vocabulary the
 * decision-record contested-collection mints:
 *   - response:    `response-<author>-issue-<issueRef>` per response verdict
 *   - integration: `integration-<additionRef>` per addition
 * Anything else contributes no ids (so it reopens nothing). Tolerant of partial shapes.
 */
function collectDecisionIds(frontmatter: unknown): string[] {
  if (!frontmatter || typeof frontmatter !== "object") return [];
  const fm = frontmatter as Record<string, unknown>;
  const ids: string[] = [];

  if (fm.phase === "response" && Array.isArray(fm.responses)) {
    const author = typeof fm.author === "string" ? fm.author : "unknown";
    for (const r of fm.responses) {
      if (r && typeof r === "object") {
        const ref = (r as Record<string, unknown>).issueRef;
        if (ref !== undefined && ref !== null) {
          ids.push(`response-${author}-issue-${String(ref)}`);
        }
      }
    }
  }

  if (fm.phase === "integration" && Array.isArray(fm.additions)) {
    for (const a of fm.additions) {
      if (a && typeof a === "object") {
        const ref = (a as Record<string, unknown>).additionRef;
        if (ref !== undefined && ref !== null) {
          ids.push(`integration-${String(ref)}`);
        }
      }
    }
  }

  return ids;
}

/** A dropped position recorded for the decision record (D-64: drop + warn, no retry, run continues). */
export interface RelitigationDrop {
  /** The artifact path whose position reopened a settled decision. */
  artifactPath: string;
  /** The settled decision ids that artifact attempted to reopen. */
  relitigatedIds: string[];
  /** Always `re-litigation` — the generalization of 04-03's integrator conflicts-with-resolved drop. */
  reason: "re-litigation";
}

/**
 * Enforce the re-litigation guard for ONE later-phase artifact (D-64). When the artifact reopens one
 * or more settled ids, DROP its position with a `re-litigation` reason: emit a warning (no retry — the
 * run continues, generalizing decision-record.ts's integrator `dropped`/conflicts path) and return the
 * drop record so the decision record can note the violation. Returns null when nothing was reopened.
 */
export function enforceDrop(
  artifactPath: string,
  settledIds: Set<string>,
  artifactFrontmatter: unknown,
): RelitigationDrop | null {
  const { relitigatedIds } = detectRelitigation(settledIds, artifactFrontmatter);
  if (relitigatedIds.length === 0) return null;
  process.stdout.write(
    `  ⤵ dropping ${artifactPath} (re-litigation): reopens settled decision(s) ${relitigatedIds.join(", ")}\n`,
  );
  return { artifactPath, relitigatedIds, reason: "re-litigation" };
}

/**
 * The on-disk record of re-litigation drops (D-64), under the run's `shared/` dir. The terminal
 * decision record reads it to note each violation (the run continued, but the guard fired). A plain
 * JSON sidecar (the drops are orchestrator-minted, not agent-authored prose) — appended sequentially
 * via the per-runDir serializeWrite chain so concurrent enforcement at a boundary never loses a drop.
 */
const DROPS_FILE = join("shared", "relitigation-drops.json");

function dropsPath(runDir: string): string {
  return join(runDir, DROPS_FILE);
}

/** Read the recorded re-litigation drops (empty array when none recorded yet). */
export async function readRelitigationDrops(runDir: string): Promise<RelitigationDrop[]> {
  let raw: string;
  try {
    raw = await readFile(dropsPath(runDir), "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RelitigationDrop[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append re-litigation drops to the run's sidecar record (D-64), idempotently by artifactPath, routed
 * through the per-runDir serializeWrite chain (Pitfall 7) and written atomically (temp-then-rename).
 */
export async function recordRelitigationDrops(
  runDir: string,
  drops: RelitigationDrop[],
): Promise<void> {
  if (drops.length === 0) return;
  await serializeWrite(runDir, async () => {
    const current = await readRelitigationDrops(runDir);
    const byPath = new Map<string, RelitigationDrop>();
    for (const d of current) byPath.set(d.artifactPath, d);
    for (const d of drops) byPath.set(d.artifactPath, d);
    const next = [...byPath.values()];
    await ensureDir(join(runDir, "shared"));
    const finalPath = dropsPath(runDir);
    const tmpPath = `${finalPath}.tmp-${process.pid}`;
    await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tmpPath, finalPath);
  });
}

/** The set of settled decision ids in the current ledger (for the enforcement pass). */
export async function settledIds(runDir: string): Promise<Set<string>> {
  const ledger = await readLedger(runDir);
  return new Set(ledger.decisions.map((d) => d.id));
}
