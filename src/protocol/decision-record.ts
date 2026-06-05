import { join } from "node:path";
import fsExtra from "fs-extra";
import {
  DecisionRecordFrontmatter,
  type OpenDecision,
  type RelitigationViolation,
  type ResolvedDecision,
} from "../schema/decision-record.js";
import { IntegrationFrontmatter } from "../schema/integration.js";
import type { ManifestArtifact } from "../schema/manifest.js";
import { ResponseFrontmatter } from "../schema/response.js";
import { readManifest } from "../workspace/manifest.js";
import type { ConvergenceResult } from "./converge.js";
import { readAgentFrontmatter } from "./frontmatter.js";
import { readLedger, readRelitigationDrops } from "./resolved-decisions.js";

const { ensureDir, rename, writeFile } = fsExtra;

const RECORD_FILE = "decision-record.md";

/**
 * C0 control chars (U+0000-U+001F) + DEL. Built from a string of escape sequences via `new RegExp`
 * so NO raw control byte is embedded in this source file. Used by the injection-safe scalar
 * serializer below (CR-01).
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping control chars.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Serialize ONE scalar to injection-safe YAML (the artifacts.ts toFrontmatter discipline, reused
 * here because the decision-record fields are assembled from agent-authored prose — reason/rationale
 * strings can contain newlines, a leading `---`, or `: ` that would break the frontmatter or inject
 * keys, CR-01 / T-04-14). Numbers bare; strings flattened (CR/LF → space, control chars stripped)
 * then JSON-quoted (valid double-quoted YAML scalar).
 */
function yamlScalar(v: string | number): string {
  if (typeof v === "number") return String(v);
  const flattened = v.replace(/\r?\n/g, " ").replace(CONTROL_CHARS, "");
  return JSON.stringify(flattened);
}

/**
 * Serialize the assembled, schema-validated DecisionRecordFrontmatter to an injection-safe YAML
 * frontmatter block. gray-matter stays strictly READ-only (T-04-07): the WRITE path uses this
 * hand-rolled, scalar-escaping serializer — never `matter.stringify`. Nested arrays of objects
 * (resolved/open decisions) are emitted as a YAML block sequence with each scalar escaped.
 */
function serializeFrontmatter(record: DecisionRecordFrontmatter): string {
  const lines: string[] = [];
  lines.push(`runId: ${yamlScalar(record.runId)}`);

  if (record.resolvedDecisions.length === 0) {
    lines.push("resolvedDecisions: []");
  } else {
    lines.push("resolvedDecisions:");
    for (const d of record.resolvedDecisions) {
      lines.push(`  - id: ${yamlScalar(d.id)}`);
      lines.push(`    summary: ${yamlScalar(d.summary)}`);
      lines.push(`    rationale: ${yamlScalar(d.rationale)}`);
      // resolver (D-61/D-63) — present on ledger-sourced entries (how the fork settled); omitted on a
      // trail-only cross-check entry not yet in the ledger (optional + additive).
      if (d.resolver !== undefined) lines.push(`    resolver: ${yamlScalar(d.resolver)}`);
      if (d.lineage.length === 0) {
        lines.push("    lineage: []");
      } else {
        lines.push("    lineage:");
        for (const ref of d.lineage) lines.push(`      - ${yamlScalar(ref)}`);
      }
    }
  }

  if (record.openDecisions.length === 0) {
    lines.push("openDecisions: []");
  } else {
    lines.push("openDecisions:");
    for (const o of record.openDecisions) {
      lines.push(`  - id: ${yamlScalar(o.id)}`);
      lines.push(`    summary: ${yamlScalar(o.summary)}`);
      lines.push(`    reason: ${yamlScalar(o.reason)}`);
    }
  }

  lines.push(`unanimousTally: ${record.unanimousTally}`);

  if (record.runChain.length === 0) {
    lines.push("runChain: []");
  } else {
    lines.push("runChain:");
    for (const step of record.runChain) lines.push(`  - ${yamlScalar(step)}`);
  }

  // Re-litigation violations (D-64): positions dropped for reopening a settled decision.
  if (record.relitigationViolations.length === 0) {
    lines.push("relitigationViolations: []");
  } else {
    lines.push("relitigationViolations:");
    for (const v of record.relitigationViolations) {
      lines.push(`  - artifactPath: ${yamlScalar(v.artifactPath)}`);
      lines.push(`    reason: ${yamlScalar(v.reason)}`);
      if (v.relitigatedIds.length === 0) {
        lines.push("    relitigatedIds: []");
      } else {
        lines.push("    relitigatedIds:");
        for (const id of v.relitigatedIds) lines.push(`      - ${yamlScalar(id)}`);
      }
    }
  }

  return `---\n${lines.join("\n")}\n---\n`;
}

/** Manifest artifacts filtered to one kind (e.g. all `response` artifacts). */
function artifactsOfKind(artifacts: ManifestArtifact[], kind: string): ManifestArtifact[] {
  return artifacts.filter((a) => a.kind === kind);
}

/**
 * Assemble + write the run's contested-only decision record (RCRD-01, RSLV-01). Reads the artifact
 * trail off disk (filesystem-as-truth, A3), collects CONTESTED items only (D-46) — response
 * reject-with-reason/refine verdicts, integration `dropped`/`merged-with-change` additions (the
 * shipped 04-03/04-04 vocabulary for a conflicting/rejected or altered addition), and convergence
 * concessions — each as a `resolvedDecisions` entry WITH its agent-supplied rationale and
 * per-decision artifact lineage (D-47). Unanimous accepts collapse to a one-line `unanimousTally`
 * (D-46), escalations become `openDecisions` (D-42), and a compact `runChain` (input → base → final)
 * is recorded — no duplicate full lineage graph (the manifest already indexes every artifact, D-47).
 * The assembled object is validated against `DecisionRecordFrontmatter` (T-04-14: every resolved
 * decision must carry a rationale) BEFORE it is written atomically (temp-then-rename, T-04-15) using
 * the injection-safe serializer — gray-matter is READ-only.
 */
export async function writeDecisionRecord(
  runDir: string,
  convergence?: ConvergenceResult,
): Promise<{ path: string; record: DecisionRecordFrontmatter }> {
  const manifest = await readManifest(runDir);

  const resolvedDecisions: ResolvedDecision[] = [];
  const openDecisions: OpenDecision[] = [];
  let unanimousTally = 0;

  // ---- Response-round contested verdicts (REVW-02). reject-with-reason / refine are CONTESTED
  // (each carries the agent's reason/refinement = its rationale). `accept` is unanimous agreement →
  // it collapses into the tally, never an individual entry (D-46).
  for (const art of artifactsOfKind(manifest.artifacts, "response")) {
    const data = await readAgentFrontmatter(join(runDir, art.path));
    if (data === null) continue;
    const parsed = ResponseFrontmatter.safeParse(data);
    if (!parsed.success) continue;
    const response = parsed.data;
    for (const v of response.responses) {
      if (v.verdict === "accept") {
        unanimousTally += 1;
        continue;
      }
      // Contested: per-decision lineage points back at THIS response artifact + the review it
      // answers (compact per-decision trail, D-47 — not a duplicate full graph).
      const lineage = [
        `${art.path} issue ${v.issueRef}`,
        `${response.reviewOf} issue ${v.issueRef}`,
      ];
      if (v.verdict === "reject-with-reason") {
        resolvedDecisions.push({
          id: `response-${response.author}-issue-${v.issueRef}`,
          summary: `${response.author} rejected issue ${v.issueRef}`,
          rationale: v.reason,
          lineage,
        });
      } else {
        // refine
        resolvedDecisions.push({
          id: `response-${response.author}-issue-${v.issueRef}`,
          summary: `${response.author} refined issue ${v.issueRef}`,
          rationale: v.refinement,
          lineage,
        });
      }
    }
  }

  // ---- Integration per-addition verdicts (REVW-04). `dropped` is CONTESTED (the integrator
  // rejected an addition WITH a reason — the 04-04 vocabulary for "conflicts-with-resolved").
  // `merged-with-change` is a recorded concession (the integrator altered the addition → contested,
  // its `change` is the rationale). `merged` is unanimous acceptance → tally only (D-46).
  for (const art of artifactsOfKind(manifest.artifacts, "integration")) {
    const data = await readAgentFrontmatter(join(runDir, art.path));
    if (data === null) continue;
    const parsed = IntegrationFrontmatter.safeParse(data);
    if (!parsed.success) continue;
    const integration = parsed.data;
    for (const add of integration.additions) {
      const lineage = [`${art.path} addition ${add.additionRef}`, `base: ${integration.base}`];
      if (add.verdict === "merged") {
        unanimousTally += 1;
      } else if (add.verdict === "merged-with-change") {
        resolvedDecisions.push({
          id: `integration-${add.additionRef}`,
          summary: `integrator merged ${add.additionRef} with a change`,
          rationale: add.change,
          lineage,
        });
      } else {
        // dropped (conflicts-with-resolved / rejected addition) — contested with a reason.
        resolvedDecisions.push({
          id: `integration-${add.additionRef}`,
          summary: `integrator dropped ${add.additionRef}`,
          rationale: add.reason,
          lineage,
        });
      }
    }
  }

  // ---- Convergence concessions (RSLV-01): disagreements conceded across evaluation rounds. Each is
  // a logged resolution. Lineage points at the evaluation round trail (the manifest indexes the
  // per-round evaluation-r<n> artifacts; we reference them compactly, D-47).
  if (convergence) {
    for (let i = 0; i < convergence.concessions.length; i++) {
      const disagreement = convergence.concessions[i];
      resolvedDecisions.push({
        id: `concession-${i + 1}`,
        summary: `disagreement conceded during convergence: ${disagreement}`,
        rationale: `conceded across ${convergence.rounds} evaluation round(s); converged on base "${convergence.base}"`,
        lineage: [`evaluation rounds 1..${convergence.rounds}`, `base: ${convergence.base}`],
      });
    }

    // ---- Escalation → open decision (D-42). An unresolved fork the run could not settle.
    if (convergence.openDecision) {
      openDecisions.push({
        id: "convergence-escalation",
        summary: `convergence escalated without unanimous agreement (fallback base "${convergence.base}")`,
        reason: convergence.openDecision.reason,
      });
    }
  }

  // ---- Compact run chain (D-47): input → base → final. NOT a duplicate full lineage graph — the
  // manifest already indexes every artifact; this is the one-line run-level lineage.
  const base = convergence?.base;
  const integrationArtifact = artifactsOfKind(manifest.artifacts, "integration")[0];
  const runChain: string[] = ["input document"];
  if (base) runChain.push(`base draft: ${base}`);
  if (integrationArtifact) runChain.push(`final: ${integrationArtifact.path}`);

  // ---- ASSEMBLE FROM THE ROLLING LEDGER (D-63). The ledger is the authoritative settled-fork trail
  // appended as forks resolved (response/convergence/majority/integrator/human). We source the
  // `resolver` from it (Open Q1 recommendation: ADDITIVE — the trail re-derivation above stays as a
  // cross-check, the ledger supplies provenance + any human ruling the trail can't see). Overlay the
  // resolver onto matching trail entries by id; APPEND ledger-only entries (e.g. the human ruling,
  // majority resolution) not present in the trail. The ledger entry's resolver/rationale win.
  const ledger = await readLedger(runDir);
  const ledgerById = new Map(ledger.decisions.map((d) => [d.id, d]));
  const trailIds = new Set(resolvedDecisions.map((d) => d.id));
  for (const d of resolvedDecisions) {
    const led = ledgerById.get(d.id);
    if (led) d.resolver = led.resolver; // source the resolver (D-61) from the ledger.
  }
  for (const led of ledger.decisions) {
    if (!trailIds.has(led.id)) {
      resolvedDecisions.push({
        id: led.id,
        summary: led.summary,
        rationale: led.rationale,
        lineage: led.lineage,
        resolver: led.resolver,
      });
    }
  }

  // ---- Re-litigation violations (D-64): note the dropped positions the guard caught during the run.
  const drops = await readRelitigationDrops(runDir);
  const relitigationViolations: RelitigationViolation[] = drops.map((dr) => ({
    artifactPath: dr.artifactPath,
    relitigatedIds: dr.relitigatedIds,
    reason: "re-litigation" as const,
  }));

  // Validate BEFORE writing (T-04-14: a resolved decision missing its rationale is malformed — the
  // schema requires a non-empty rationale, so parse throws rather than persisting it).
  const validated = DecisionRecordFrontmatter.parse({
    runId: manifest.runId,
    resolvedDecisions,
    openDecisions,
    unanimousTally,
    runChain,
    relitigationViolations,
  });

  // Human rationale narrative body (the record reads as "what was argued and why it landed").
  const content = `${serializeFrontmatter(validated)}\n${renderBody(validated)}\n`;

  // Atomic temp-then-rename (T-04-15): never write live in place (writeArtifact/writeManifestAtomic
  // discipline). A crash mid-write leaves no half-written record.
  await ensureDir(runDir);
  const finalPath = join(runDir, RECORD_FILE);
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, finalPath);

  return { path: finalPath, record: validated };
}

/** Render the human-readable decision narrative (the markdown body below the frontmatter). */
function renderBody(record: DecisionRecordFrontmatter): string {
  const lines: string[] = [`# Decision Record — ${record.runId}`, ""];

  lines.push("## Resolved decisions (contested)");
  if (record.resolvedDecisions.length === 0) {
    lines.push("None — every addition was unanimously accepted.");
  } else {
    for (const d of record.resolvedDecisions) {
      const by = d.resolver ? ` — resolved by ${d.resolver}` : "";
      lines.push(`- **${d.summary}** (${d.id})${by}`);
      lines.push(`  - rationale: ${d.rationale}`);
      if (d.lineage.length > 0) lines.push(`  - lineage: ${d.lineage.join(" → ")}`);
    }
  }
  lines.push("");

  lines.push("## Re-litigation violations (dropped)");
  if (record.relitigationViolations.length === 0) {
    lines.push("None — no settled decision was reopened.");
  } else {
    for (const v of record.relitigationViolations) {
      lines.push(
        `- **${v.artifactPath}** dropped (${v.reason}) — reopened: ${v.relitigatedIds.join(", ")}`,
      );
    }
  }
  lines.push("");

  lines.push("## Open decisions");
  if (record.openDecisions.length === 0) {
    lines.push("None — the run converged without escalation.");
  } else {
    for (const o of record.openDecisions) {
      lines.push(`- **${o.summary}** (${o.id})`);
      lines.push(`  - reason: ${o.reason}`);
    }
  }
  lines.push("");

  lines.push(`## Unanimous agreements: ${record.unanimousTally}`);
  lines.push("");
  lines.push("## Run chain");
  lines.push(record.runChain.join(" → "));

  return lines.join("\n");
}
