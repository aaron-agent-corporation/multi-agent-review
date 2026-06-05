import { describe, expect, it } from "vitest";
import { ReviewFrontmatter, ReviewIssue } from "../src/schema/review.js";

const VALID = {
  phase: "review",
  author: "codex",
  targets: "claude",
  issues: [
    { n: 1, severity: "P1", question: "Why is the timeout unbounded?" },
    { n: 2, severity: "P3", question: "Should this be configurable?" },
  ],
};

describe("ReviewFrontmatter schema (REVW-01)", () => {
  it("parses a well-formed review with numbered issues", () => {
    const r = ReviewFrontmatter.safeParse(VALID);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.issues).toHaveLength(2);
      expect(r.data.targets).toBe("claude");
    }
  });

  it("ReviewIssue accepts P1/P2/P3 severities", () => {
    for (const severity of ["P1", "P2", "P3"]) {
      expect(ReviewIssue.safeParse({ n: 1, severity, question: "q?" }).success).toBe(true);
    }
  });

  it("rejects a severity outside P1|P2|P3", () => {
    const r = ReviewFrontmatter.safeParse({
      ...VALID,
      issues: [{ n: 1, severity: "P4", question: "q?" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty issues array (min 1)", () => {
    const r = ReviewFrontmatter.safeParse({ ...VALID, issues: [] });
    expect(r.success).toBe(false);
  });

  it("rejects an issue missing its question", () => {
    const r = ReviewFrontmatter.safeParse({
      ...VALID,
      issues: [{ n: 1, severity: "P1" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-positive issue number", () => {
    const r = ReviewFrontmatter.safeParse({
      ...VALID,
      issues: [{ n: 0, severity: "P1", question: "q?" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate issue n values via superRefine, flagging the issues path", () => {
    const r = ReviewFrontmatter.safeParse({
      ...VALID,
      issues: [
        { n: 1, severity: "P1", question: "first?" },
        { n: 1, severity: "P2", question: "dup?" },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join(" ");
      expect(msg).toContain("duplicate");
      expect(r.error.issues.some((i) => i.path[0] === "issues")).toBe(true);
    }
  });

  it("rejects a wrong phase literal", () => {
    expect(ReviewFrontmatter.safeParse({ ...VALID, phase: "response" }).success).toBe(false);
  });
});
