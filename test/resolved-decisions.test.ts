import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendResolved,
  detectRelitigation,
  enforceDrop,
  LEDGER_FILE,
  readLedger,
} from "../src/protocol/resolved-decisions.js";
import { ResolvedDecisionsLedger } from "../src/schema/resolved-decisions.js";

let work: string;
let runDir: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "mar-resolved-decisions-"));
  runDir = join(work, "runs", "20260605-resolved");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function entry(over: Partial<Parameters<typeof appendResolved>[2][number]> = {}) {
  return {
    id: over.id ?? "response-claude-issue-1",
    summary: over.summary ?? "claude rejected issue 1",
    rationale: over.rationale ?? "evidence shows the empty-input case is already handled",
    lineage: over.lineage ?? ["001-claude-response.md issue 1"],
    resolver: over.resolver ?? ("convergence" as const),
  };
}

describe("resolved-decisions ledger (D-63)", () => {
  it("writes the ledger to runs/<id>/shared/resolved-decisions.md", async () => {
    await appendResolved(runDir, "20260605-resolved", [entry()]);
    const raw = readFileSync(join(runDir, LEDGER_FILE), "utf8");
    expect(LEDGER_FILE).toBe(join("shared", "resolved-decisions.md"));
    expect(raw).toContain("Resolved decisions");
    const ledger = await readLedger(runDir);
    expect(ledger.runId).toBe("20260605-resolved");
    expect(ledger.decisions).toHaveLength(1);
    expect(ledger.decisions[0].resolver).toBe("convergence");
  });

  it("two same-phase appends both land (race-safe via serializeWrite, Pitfall 7)", async () => {
    // Fire both appends without awaiting in sequence — the per-runDir serializeWrite chain must
    // serialize the read-modify-write so neither clobbers the other.
    await Promise.all([
      appendResolved(runDir, "20260605-resolved", [entry({ id: "fork-a", summary: "fork a" })]),
      appendResolved(runDir, "20260605-resolved", [entry({ id: "fork-b", summary: "fork b" })]),
    ]);
    const ledger = await readLedger(runDir);
    const ids = ledger.decisions.map((d) => d.id).sort();
    expect(ids).toEqual(["fork-a", "fork-b"]);
  });

  it("re-appending the same id is idempotent (settled fork stays settled)", async () => {
    await appendResolved(runDir, "20260605-resolved", [
      entry({ id: "dup", summary: "first settlement", rationale: "original" }),
    ]);
    await appendResolved(runDir, "20260605-resolved", [
      entry({ id: "dup", summary: "DIFFERENT", rationale: "should be ignored" }),
    ]);
    const ledger = await readLedger(runDir);
    expect(ledger.decisions).toHaveLength(1);
    // First-write-wins: the recorded resolution is NOT mutated by a later re-append.
    expect(ledger.decisions[0].summary).toBe("first settlement");
    expect(ledger.decisions[0].rationale).toBe("original");
  });

  it("an injection-laden rationale is serialized so the on-disk ledger re-parses (T-05-17 / CR-01)", async () => {
    const malicious = entry({
      id: "inject",
      summary: "normal summary",
      rationale: 'broken\n---\ninjected: "key"\nmaliciousResolver: human\n# end',
    });
    await appendResolved(runDir, "20260605-resolved", [malicious]);
    const raw = readFileSync(join(runDir, LEDGER_FILE), "utf8");
    // The injected newline/`---` must NOT have escaped the scalar — re-parsing the on-disk file via
    // the tolerant reader yields a single, schema-valid ledger with the rationale intact (flattened).
    const reparsed = ResolvedDecisionsLedger.parse(matter(raw).data);
    expect(reparsed.decisions).toHaveLength(1);
    expect(reparsed.decisions[0].id).toBe("inject");
    // No phantom injected key reached the parsed object.
    expect((reparsed as Record<string, unknown>).injected).toBeUndefined();
    // The frontmatter still has exactly one closing delimiter pair (no premature break).
    const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n/);
    expect(fmMatch).not.toBeNull();
  });

  it("empty entries is a no-op (no ledger written for zero settled forks)", async () => {
    await appendResolved(runDir, "20260605-resolved", []);
    // readLedger returns the empty default keyed by the dir basename.
    const ledger = await readLedger(runDir);
    expect(ledger.decisions).toHaveLength(0);
  });
});

describe("re-litigation detection + enforcement (D-64)", () => {
  const settled = new Set(["response-claude-issue-1", "integration-issue-7"]);

  it("detectRelitigation flags a reopened settled response id", () => {
    const fm = {
      phase: "response",
      author: "claude",
      responses: [{ issueRef: 1, verdict: "reject-with-reason", reason: "reopening" }],
    };
    expect(detectRelitigation(settled, fm).relitigatedIds).toEqual(["response-claude-issue-1"]);
  });

  it("detectRelitigation flags a reopened settled integration id", () => {
    const fm = {
      phase: "integration",
      author: "codex",
      additions: [{ additionRef: "issue-7", verdict: "merged" }],
    };
    expect(detectRelitigation(settled, fm).relitigatedIds).toEqual(["integration-issue-7"]);
  });

  it("detectRelitigation reopens nothing for an unrelated/unsettled id", () => {
    const fm = {
      phase: "response",
      author: "gemini",
      responses: [{ issueRef: 99, verdict: "accept" }],
    };
    expect(detectRelitigation(settled, fm).relitigatedIds).toEqual([]);
  });

  it("detectRelitigation is tolerant of a non-object / malformed frontmatter", () => {
    expect(detectRelitigation(settled, null).relitigatedIds).toEqual([]);
    expect(detectRelitigation(settled, "garbage").relitigatedIds).toEqual([]);
    expect(detectRelitigation(settled, { phase: "review" }).relitigatedIds).toEqual([]);
  });

  it("enforceDrop yields a re-litigation-reason drop when a settled id is reopened", () => {
    const fm = {
      phase: "response",
      author: "claude",
      responses: [{ issueRef: 1, verdict: "refine", refinement: "reopen it" }],
    };
    const drop = enforceDrop("004-claude-response.md", settled, fm);
    expect(drop).not.toBeNull();
    expect(drop?.reason).toBe("re-litigation");
    expect(drop?.relitigatedIds).toEqual(["response-claude-issue-1"]);
    expect(drop?.artifactPath).toBe("004-claude-response.md");
  });

  it("enforceDrop returns null when nothing was reopened (no false drop, run continues)", () => {
    const fm = {
      phase: "response",
      author: "claude",
      responses: [{ issueRef: 2, verdict: "accept" }],
    };
    expect(enforceDrop("004-claude-response.md", settled, fm)).toBeNull();
  });
});
