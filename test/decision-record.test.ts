import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConvergenceResult } from "../src/protocol/converge.js";
import { writeDecisionRecord } from "../src/protocol/decision-record.js";
import { DecisionRecordFrontmatter } from "../src/schema/decision-record.js";
import { writeArtifact } from "../src/workspace/artifacts.js";
import { addArtifact, createRun } from "../src/workspace/manifest.js";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "mar-decision-record-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Write a structured agent body through writeArtifact (so the on-disk .md carries the engine-metadata
 * wrapper FIRST, exactly like a real run) AND index it in the manifest. This forces the writer's
 * double-parse (strip wrapper, parse agent frontmatter) to be exercised, not bypassed.
 */
async function seedArtifact(
  runDir: string,
  seq: number,
  agent: string,
  kind: string,
  body: string,
): Promise<void> {
  const written = await writeArtifact(runDir, seq, agent, {
    text: body,
    raw: { ok: true },
    kind,
    frontmatter: { runId: "r-decision", phase: kind },
  });
  await addArtifact(runDir, {
    path: written.path.slice(runDir.length + 1),
    agent,
    seq,
    kind,
    createdAt: new Date().toISOString(),
  });
}

function responseBody(author: string, verdicts: string): string {
  return `---\nphase: response\nauthor: ${author}\nreviewOf: 002-codex-review.md\nresponses:\n${verdicts}\n---\n\nResponse body.\n`;
}

function integrationBody(author: string, additions: string): string {
  return `---\nphase: integration\nauthor: ${author}\nbase: claude\nadditions:\n${additions}\n---\n\nIntegrated document.\n`;
}

describe("decision-record writer (RCRD-01, RSLV-01, contested-only)", () => {
  it("assembles contested decisions with rationale + lineage, collapses unanimous accepts, and records escalation as an open decision", async () => {
    const runDir = join(work, "runs", "r-decision");
    await createRun({ runDir, runId: "r-decision", cliVersions: {} });

    // A contested REJECT-WITH-REASON + two unanimous ACCEPTs in one response artifact.
    await seedArtifact(
      runDir,
      1,
      "claude",
      "response",
      responseBody(
        "claude",
        [
          "  - verdict: reject-with-reason",
          "    issueRef: 3",
          "    reason: The proposed retry would mask a real transport fault.",
          "  - verdict: accept",
          "    issueRef: 1",
          "  - verdict: accept",
          "    issueRef: 2",
        ].join("\n"),
      ),
    );

    // An integration artifact: one MERGED (unanimous) + one DROPPED (contested, integrator reject).
    await seedArtifact(
      runDir,
      2,
      "claude",
      "integration",
      integrationBody(
        "claude",
        [
          "  - verdict: merged",
          "    additionRef: issue-1",
          "  - verdict: dropped",
          "    additionRef: issue-4",
          "    reason: conflicts-with-resolved decision on the retry policy.",
        ].join("\n"),
      ),
    );

    // An ESCALATED convergence with a conceded disagreement → resolved concession + an open decision.
    const convergence: ConvergenceResult = {
      base: "claude",
      integrator: "claude",
      rounds: 3,
      status: "escalated",
      concessions: ["whether to bound the retry budget"],
      openDecision: { reason: "convergence cap (10) reached without unanimous agreement" },
    };

    const { path, record } = await writeDecisionRecord(runDir, convergence);

    // ---- File written + frontmatter validates against the schema.
    const onDisk = readFileSync(path, "utf8");
    const parsed = DecisionRecordFrontmatter.safeParse(matter(onDisk).data);
    expect(parsed.success).toBe(true);

    // No temp leftover (atomic temp-then-rename).
    expect(readdirSync(runDir).filter((f) => f.includes(".tmp"))).toEqual([]);

    // ---- Contested items appear as resolvedDecisions, each WITH a non-empty rationale + lineage.
    const reject = record.resolvedDecisions.find((d) => d.id === "response-claude-issue-3");
    expect(reject).toBeDefined();
    expect(reject?.rationale).toContain("mask a real transport fault");
    expect(reject?.lineage.length).toBeGreaterThan(0);

    const dropped = record.resolvedDecisions.find((d) => d.id === "integration-issue-4");
    expect(dropped).toBeDefined();
    expect(dropped?.rationale).toContain("conflicts-with-resolved");
    expect(dropped?.lineage.length).toBeGreaterThan(0);

    const concession = record.resolvedDecisions.find((d) => d.id === "concession-1");
    expect(concession).toBeDefined();
    expect(concession?.rationale.length ?? 0).toBeGreaterThan(0);
    expect(concession?.summary).toContain("retry budget");

    // Every resolved decision carries a non-empty rationale (T-04-14).
    for (const d of record.resolvedDecisions) {
      expect(d.rationale.length).toBeGreaterThan(0);
    }

    // ---- Unanimous accepts/merges collapse into the tally, NOT individual entries (D-46): 2 accepts
    // + 1 merged = 3, and none of them are resolvedDecisions.
    expect(record.unanimousTally).toBe(3);
    expect(record.resolvedDecisions.some((d) => d.summary.includes("issue 1"))).toBe(false);
    expect(record.resolvedDecisions.some((d) => d.id === "integration-issue-1")).toBe(false);

    // ---- Escalation appears as an open decision (D-42).
    expect(record.openDecisions.length).toBe(1);
    expect(record.openDecisions[0].id).toBe("convergence-escalation");
    expect(record.openDecisions[0].reason).toContain("convergence cap");

    // ---- Compact run chain (input → base → final), not a duplicate full graph.
    expect(record.runChain[0]).toBe("input document");
    expect(record.runChain.some((s) => s.includes("base draft: claude"))).toBe(true);
    expect(record.runChain.some((s) => s.includes("final:"))).toBe(true);
  });

  it("a trivially-converged run (all unanimous, no concessions) still produces a parseable record with empty contested/open sets", async () => {
    const runDir = join(work, "runs", "r-decision");
    await createRun({ runDir, runId: "r-decision", cliVersions: {} });

    await seedArtifact(
      runDir,
      1,
      "codex",
      "response",
      responseBody("codex", ["  - verdict: accept", "    issueRef: 1"].join("\n")),
    );
    await seedArtifact(
      runDir,
      2,
      "claude",
      "integration",
      integrationBody("claude", ["  - verdict: merged", "    additionRef: issue-1"].join("\n")),
    );

    const convergence: ConvergenceResult = {
      base: "claude",
      integrator: "claude",
      rounds: 1,
      status: "agreed",
      concessions: [],
    };

    const { record, path } = await writeDecisionRecord(runDir, convergence);
    expect(record.resolvedDecisions).toEqual([]);
    expect(record.openDecisions).toEqual([]);
    expect(record.unanimousTally).toBe(2);

    // The on-disk record still validates.
    const parsed = DecisionRecordFrontmatter.safeParse(matter(readFileSync(path, "utf8")).data);
    expect(parsed.success).toBe(true);
  });
});
