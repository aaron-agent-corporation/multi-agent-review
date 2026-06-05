import { describe, expect, it } from "vitest";
import { EvaluationFrontmatter } from "../src/schema/evaluation.js";

const VALID = {
  phase: "evaluation",
  author: "gemini",
  round: 1,
  proposedBase: "claude",
  remainingDisagreements: [],
  citations: ["002-codex-review.md issue 3"],
};

describe("EvaluationFrontmatter schema (REVW-03)", () => {
  it("parses a valid evaluation round", () => {
    const r = EvaluationFrontmatter.safeParse(VALID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.round).toBe(1);
      expect(r.data.proposedBase).toBe("claude");
      expect(r.data.remainingDisagreements).toEqual([]);
    }
  });

  it("defaults citations to [] when omitted", () => {
    const { citations, ...rest } = VALID;
    const r = EvaluationFrontmatter.safeParse(rest);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.citations).toEqual([]);
  });

  it("rejects round 0", () => {
    expect(EvaluationFrontmatter.safeParse({ ...VALID, round: 0 }).success).toBe(false);
  });

  it("rejects a negative round", () => {
    expect(EvaluationFrontmatter.safeParse({ ...VALID, round: -1 }).success).toBe(false);
  });

  it("rejects a missing proposedBase", () => {
    const { proposedBase, ...rest } = VALID;
    expect(EvaluationFrontmatter.safeParse(rest).success).toBe(false);
  });

  it("rejects a wrong phase literal", () => {
    expect(EvaluationFrontmatter.safeParse({ ...VALID, phase: "review" }).success).toBe(false);
  });
});
