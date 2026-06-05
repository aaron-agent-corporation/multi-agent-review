import { describe, expect, it } from "vitest";
import { ResponseFrontmatter } from "../src/schema/response.js";

const base = {
  phase: "response",
  author: "claude",
  reviewOf: "002-codex-review.md",
};

describe("ResponseFrontmatter schema (REVW-02, discriminated on verdict)", () => {
  it("parses an accept response", () => {
    const r = ResponseFrontmatter.safeParse({
      ...base,
      responses: [{ verdict: "accept", issueRef: 1 }],
    });
    expect(r.success).toBe(true);
  });

  it("parses a reject-with-reason response carrying a reason", () => {
    const r = ResponseFrontmatter.safeParse({
      ...base,
      responses: [{ verdict: "reject-with-reason", issueRef: 2, reason: "out of scope for v1" }],
    });
    expect(r.success).toBe(true);
  });

  it("parses a refine response carrying a refinement", () => {
    const r = ResponseFrontmatter.safeParse({
      ...base,
      responses: [{ verdict: "refine", issueRef: 3, refinement: "bound the timeout at 600s" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects reject-with-reason WITHOUT a reason", () => {
    const r = ResponseFrontmatter.safeParse({
      ...base,
      responses: [{ verdict: "reject-with-reason", issueRef: 2 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects refine WITHOUT a refinement", () => {
    const r = ResponseFrontmatter.safeParse({
      ...base,
      responses: [{ verdict: "refine", issueRef: 3 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown verdict via the discriminated union", () => {
    const r = ResponseFrontmatter.safeParse({
      ...base,
      responses: [{ verdict: "maybe", issueRef: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty responses array (min 1)", () => {
    expect(ResponseFrontmatter.safeParse({ ...base, responses: [] }).success).toBe(false);
  });

  it("rejects a non-positive issueRef", () => {
    const r = ResponseFrontmatter.safeParse({
      ...base,
      responses: [{ verdict: "accept", issueRef: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a wrong phase literal", () => {
    const r = ResponseFrontmatter.safeParse({
      ...base,
      phase: "review",
      responses: [{ verdict: "accept", issueRef: 1 }],
    });
    expect(r.success).toBe(false);
  });
});
