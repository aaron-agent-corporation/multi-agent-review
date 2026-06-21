import { join } from "node:path";
import fsExtra from "fs-extra";
import { type EvaluationCitation, EvaluationFrontmatter } from "../schema/evaluation.js";
import type { ResolvedDecisionEntry } from "../schema/resolved-decisions.js";
import { readManifest } from "../workspace/manifest.js";
import type { ConvergenceResult } from "./converge.js";
import type { Ask } from "./engine.js";
import { readAgentFrontmatter } from "./frontmatter.js";

const { ensureDir, readFile, rename, writeFile } = fsExtra;

/**
 * Gating (PROT-05 / RSLV-03). The phase-boundary gate (D-50/D-51) and the escalated-convergence
 * arbitration (D-52). ALL human interaction rides the injectable {@link Ask} seam threaded from
 * `mar run` — no readline is created here, so every path is provable in a hermetic test by injecting
 * answers. Human-authored text (feedback notes, arbitration rulings) is attacker-influenceable input
 * (T-05-14/T-05-16): it is NEVER shell-interpolated and, when it reaches a YAML record, it goes
 * through the injection-safe scalar serializer below — never string-concatenated into frontmatter.
 */

/**
 * C0 control chars (U+0000-U+001F) + DEL, built via `new RegExp`-equivalent literal so no raw
 * control byte sits in source. Mirrors decision-record.ts CONTROL_CHARS — human ruling/feedback
 * prose can carry newlines, a leading `---`, or `: ` that would break frontmatter or inject keys.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping control chars.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Serialize ONE scalar to injection-safe YAML (the decision-record.ts discipline, reused because the
 * human ruling/feedback strings are attacker-influenceable, T-05-14/T-05-16). Strings are flattened
 * (CR/LF → space, control chars stripped) then JSON-quoted (a valid double-quoted YAML scalar).
 */
function yamlScalar(v: string): string {
  return JSON.stringify(v.replace(/\r?\n/g, " ").replace(CONTROL_CHARS, ""));
}

// ============================================================================================
// Phase-boundary gate (D-50/D-51): approve / abort / feedback.
// ============================================================================================

/** The human's decision at a phase boundary (D-51). */
export type GateAction =
  | { kind: "approve" }
  | { kind: "abort" }
  | { kind: "feedback"; note: string };

/**
 * Parse a raw gate answer into a {@link GateAction}. The contract is forgiving on the leading token
 * (case-insensitive `approve`/`a`, `abort`/`x`, `feedback`/`f`) so a human can type the obvious
 * thing; anything else is treated as a feedback note (the safest default — never silently abort or
 * approve on an unrecognized answer). For `feedback`, the note is everything after the keyword (or
 * the whole line when the keyword was the bare token).
 */
export function parseGateAnswer(raw: string): GateAction {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "approve" || lower === "a" || lower === "y" || lower === "yes") {
    return { kind: "approve" };
  }
  if (lower === "abort" || lower === "x" || lower === "q" || lower === "quit") {
    return { kind: "abort" };
  }
  // `feedback <note>` or `f <note>`: strip the keyword, keep the rest as the note.
  const fb = /^(?:feedback|f)\b[:\s]*(.*)$/is.exec(trimmed);
  if (fb) {
    const note = fb[1].trim();
    return { kind: "feedback", note: note.length > 0 ? note : "" };
  }
  // Unrecognized → treat the whole line as a feedback note (fail-safe: never abort/approve blindly).
  return { kind: "feedback", note: trimmed };
}

/**
 * Run the blocking phase-boundary gate (D-50/D-51): present the just-completed phase, ask the human,
 * and return the parsed action. A feedback note with an empty body is re-asked once (a human who
 * chose feedback but typed nothing is prompted again), then defaults to approve so the gate can never
 * wedge the run on a blank note.
 */
export async function runGate(
  ask: Ask,
  completedPhase: string,
  nextPhase: string,
): Promise<GateAction> {
  const prompt =
    `\n── GATE ── phase "${completedPhase}" complete; next phase: "${nextPhase}".\n` +
    "  [approve] continue   [abort] stop the run   [feedback <note>] steer the next phase\n" +
    "> ";
  const action = parseGateAnswer(await ask(prompt));
  if (action.kind === "feedback" && action.note.length === 0) {
    const retry = parseGateAnswer(
      await ask('feedback note was empty — type a short note, or "approve" to continue\n> '),
    );
    if (retry.kind === "feedback" && retry.note.length === 0) return { kind: "approve" };
    return retry;
  }
  return action;
}

/**
 * Persist a gate feedback note with attribution + timestamp (D-51 / T-05-14). The note steers ONLY
 * the next phase's prompt (the caller threads it into context as `feedback` for exactly one phase),
 * but is also written to `gate-feedback/<phase>.md` so the steering is auditable. The note is the
 * BODY (markdown, human prose) and the frontmatter carries machine-readable attribution; the note is
 * NOT injected as YAML (it is a markdown body), so no scalar escaping is needed for the body, but the
 * frontmatter scalars are escaped. Returns the relative path written.
 */
export async function writeGateFeedback(
  runDir: string,
  nextPhase: string,
  note: string,
): Promise<string> {
  const dir = join(runDir, "gate-feedback");
  await ensureDir(dir);
  const rel = join("gate-feedback", `${nextPhase}.md`);
  const finalPath = join(runDir, rel);
  const ts = new Date().toISOString();
  const front = [
    "---",
    "source: human-gate-feedback",
    `phase: ${yamlScalar(nextPhase)}`,
    `at: ${yamlScalar(ts)}`,
    "---",
  ].join("\n");
  // The note BODY is markdown; flatten nothing — but strip control chars defensively so a crafted
  // note can't smuggle terminal escapes into a later reader.
  const body = note.replace(CONTROL_CHARS, "");
  const content = `${front}\n\n${body}\n`;
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, finalPath);
  return rel;
}

/**
 * Compose the next phase's prompt WITH a human feedback note prepended (D-51). The note is steering
 * only: it is clearly delimited and attributed, and it does NOT carry the format contract (the
 * thin-prompt convention is preserved — the format vocabulary still lives solely in the seeded
 * instruction file). Control chars are stripped (T-05-14). The base prompt is unchanged below the
 * note, so the agent still receives the canonical thin prompt.
 */
export function injectFeedback(basePrompt: string, note: string): string {
  const clean = note.replace(CONTROL_CHARS, "").trim();
  if (clean.length === 0) return basePrompt;
  return `## Human steering note (for this phase only)\n${clean}\n\n${basePrompt}`;
}

// ============================================================================================
// Gated arbitration of an escalated convergence (RSLV-03 / D-52).
// ============================================================================================

/** One agent's final position for arbitration, read from the last evaluation round's artifacts. */
export interface AgentPosition {
  author: string;
  proposedBase: string;
  remainingDisagreements: string[];
  citations: EvaluationCitation[];
}

/**
 * Read each surviving agent's FINAL evaluation position (proposedBase + remaining disagreements +
 * cited evidence) from the highest-numbered `evaluation-r<n>` round on disk (D-52: present each
 * agent's final position with cited evidence). Filesystem-as-truth (A3): never a model self-report.
 */
export async function readFinalPositions(runDir: string): Promise<AgentPosition[]> {
  const manifest = await readManifest(runDir);
  const rounds = manifest.artifacts
    .map((a) => /^evaluation-r(\d+)$/.exec(a.kind))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  if (rounds.length === 0) return [];
  const lastRound = Math.max(...rounds);
  const lastKind = `evaluation-r${lastRound}`;
  const paths = manifest.artifacts
    .filter((a) => a.kind === lastKind)
    .map((a) => join(runDir, a.path));
  const positions: AgentPosition[] = [];
  for (const p of paths) {
    const data = await readAgentFrontmatter(p);
    const parsed = EvaluationFrontmatter.safeParse(data);
    if (!parsed.success) continue;
    positions.push({
      author: parsed.data.author,
      proposedBase: parsed.data.proposedBase,
      remainingDisagreements: parsed.data.remainingDisagreements,
      citations: parsed.data.citations,
    });
  }
  return positions;
}

/**
 * Format the arbitration prompt: each agent's final position with its cited evidence (D-52), then the
 * human's choice — pick a side (an author name) OR write a free-form ruling. Returns the prompt text.
 */
function formatArbitrationPrompt(positions: AgentPosition[], reason: string): string {
  const lines: string[] = [];
  lines.push("\n── ARBITRATION ── convergence escalated; human ruling required.");
  lines.push(`  reason: ${reason}`);
  lines.push("  Each agent's FINAL position:");
  for (const p of positions) {
    lines.push(`   • ${p.author} → base "${p.proposedBase}"`);
    if (p.remainingDisagreements.length > 0) {
      lines.push(`       open: ${p.remainingDisagreements.join("; ")}`);
    }
    if (p.citations.length > 0) {
      const cites = p.citations.map((c) => `${c.artifact}: ${c.evidence}`).join("; ");
      lines.push(`       cites: ${cites}`);
    }
  }
  lines.push("  Pick a side by author name, OR type a free-form ruling.");
  lines.push("> ");
  return lines.join("\n");
}

/** The outcome of a human arbitration (D-52): the chosen base + the human's rationale. */
export interface ArbitrationOutcome {
  base: string;
  rationale: string;
}

/**
 * Run the gated arbitration of an escalated convergence (D-52). Presents each agent's final position
 * with cited evidence; the human either picks a side (typing an author name that matches a position →
 * that author's proposedBase becomes the base, rationale records the pick) or writes a free-form
 * ruling (the rationale is the typed text and the base stays the escalation's most-supported fallback
 * already in `result.base`). Returns the chosen base + rationale.
 */
export async function runArbitration(
  ask: Ask,
  runDir: string,
  result: ConvergenceResult,
): Promise<ArbitrationOutcome> {
  const positions = await readFinalPositions(runDir);
  const reason = result.openDecision?.reason ?? "escalated convergence";
  const answer = (await ask(formatArbitrationPrompt(positions, reason))).trim();
  // Picking a side: the answer exactly matches one position's author (case-insensitive).
  const sided = positions.find((p) => p.author.toLowerCase() === answer.toLowerCase());
  if (sided) {
    return {
      base: sided.proposedBase,
      rationale: `human picked ${sided.author}'s position (base "${sided.proposedBase}")`,
    };
  }
  // Free-form ruling: keep the escalation fallback base; the rationale is the human's text.
  return {
    base: result.base,
    rationale: answer.length > 0 ? answer : "human ruling (no text supplied)",
  };
}

/**
 * Build the resolved-decision ledger entry for a human arbitration ruling (D-52 / D-61). Recorded
 * with `resolver: "human"` and the human's rationale; lineage points at the escalation reason so the
 * fork's provenance is traceable. The 05-06 re-litigation guard / ledger appends this entry. The
 * rationale is attacker-influenceable prose (T-05-16) — the schema keeps it as a string and the
 * ledger writer escapes it through the injection-safe serializer (never string-concat into YAML).
 */
export function arbitrationLedgerEntry(
  result: ConvergenceResult,
  outcome: ArbitrationOutcome,
): ResolvedDecisionEntry {
  const reason = result.openDecision?.reason ?? "escalated convergence";
  return {
    id: `arbitration-${result.rounds}`,
    summary: `human arbitrated escalated convergence → base "${outcome.base}"`,
    rationale: outcome.rationale,
    lineage: [`escalation: ${reason}`],
    resolver: "human",
  };
}

/**
 * Persist the human arbitration ruling to disk so it survives the run for the 05-06 ledger and for
 * audit (D-52 / T-05-16). Written to `human-ruling.md`: frontmatter carries the machine-readable
 * resolved-decision entry (id/summary/rationale/lineage/resolver) through the injection-safe scalar
 * serializer; the body restates the rationale for a human reader. Returns the relative path.
 */
export async function writeHumanRuling(
  runDir: string,
  entry: ResolvedDecisionEntry,
): Promise<string> {
  const rel = "human-ruling.md";
  const finalPath = join(runDir, rel);
  const lines: string[] = ["---"];
  lines.push(`id: ${yamlScalar(entry.id)}`);
  lines.push(`summary: ${yamlScalar(entry.summary)}`);
  lines.push(`rationale: ${yamlScalar(entry.rationale)}`);
  if (entry.lineage.length === 0) {
    lines.push("lineage: []");
  } else {
    lines.push("lineage:");
    for (const ref of entry.lineage) lines.push(`  - ${yamlScalar(ref)}`);
  }
  lines.push(`resolver: ${yamlScalar(entry.resolver)}`);
  lines.push("---");
  const content = `${lines.join("\n")}\n\n# Human ruling\n\n${entry.rationale.replace(CONTROL_CHARS, "")}\n`;
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, finalPath);
  return rel;
}

/** Read back a persisted human ruling (audit/test helper). Returns null when absent/unreadable. */
export async function readHumanRuling(runDir: string): Promise<string | null> {
  try {
    return await readFile(join(runDir, "human-ruling.md"), "utf8");
  } catch {
    return null;
  }
}

/** Production ask() seam (D-53): one readline question, closed after each call. */
export async function defaultAsk(question: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
