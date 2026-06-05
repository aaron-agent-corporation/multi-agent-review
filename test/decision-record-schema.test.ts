import { describe, expect, it } from "vitest";
import { DecisionRecordFrontmatter } from "../src/schema/decision-record.js";

const VALID = {
  runId: "20260605-x7Kp2a",
  resolvedDecisions: [
    {
      id: "D-1",
      summary: "Bound the timeout at 600s",
      rationale: "Unbounded hangs starve the run; 600s matches roster default.",
      lineage: ["002-codex-review.md issue 3", "004-claude-response.md"],
    },
  ],
  openDecisions: [{ id: "D-2", summary: "Pick a debate arbiter", reason: "no majority reached" }],
  unanimousTally: 5,
  runChain: ["input.md", "claude-draft", "final.md"],
};

describe("DecisionRecordFrontmatter schema (RCRD-01, RSLV-01)", () => {
  it("parses a full decision record", () => {
    const r = DecisionRecordFrontmatter.safeParse(VALID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.resolvedDecisions).toHaveLength(1);
      expect(r.data.resolvedDecisions[0].lineage).toHaveLength(2);
      expect(r.data.openDecisions).toHaveLength(1);
      expect(r.data.unanimousTally).toBe(5);
    }
  });

  it("defaults resolvedDecisions/openDecisions/unanimousTally/runChain when omitted (additive forward-compat)", () => {
    const r = DecisionRecordFrontmatter.safeParse({ runId: "r1" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.resolvedDecisions).toEqual([]);
      expect(r.data.openDecisions).toEqual([]);
      expect(r.data.unanimousTally).toBe(0);
      expect(r.data.runChain).toEqual([]);
    }
  });

  it("defaults a resolvedDecision lineage to [] when omitted", () => {
    const r = DecisionRecordFrontmatter.safeParse({
      runId: "r1",
      resolvedDecisions: [{ id: "D-1", summary: "s", rationale: "r" }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.resolvedDecisions[0].lineage).toEqual([]);
  });

  it("rejects a resolvedDecision missing rationale", () => {
    const r = DecisionRecordFrontmatter.safeParse({
      runId: "r1",
      resolvedDecisions: [{ id: "D-1", summary: "s" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an openDecision missing reason", () => {
    const r = DecisionRecordFrontmatter.safeParse({
      runId: "r1",
      openDecisions: [{ id: "D-2", summary: "s" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing runId", () => {
    expect(DecisionRecordFrontmatter.safeParse({}).success).toBe(false);
  });

  it("rejects a negative unanimousTally", () => {
    expect(DecisionRecordFrontmatter.safeParse({ runId: "r1", unanimousTally: -1 }).success).toBe(
      false,
    );
  });
});
