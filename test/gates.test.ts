import { describe, expect, it } from "vitest";
import { applySkipFailed, assertReviewable, distinctVendors } from "../src/gates.js";
import type { AgentEntry } from "../src/schema/config.js";

const a = (name: string, vendor: AgentEntry["vendor"]): AgentEntry =>
  ({ name, vendor }) as AgentEntry;

describe("distinctVendors (pure)", () => {
  it("collapses same-vendor agents to a size-1 set", () => {
    const v = distinctVendors([a("claude-1", "claude"), a("claude-2", "claude")]);
    expect(v).toEqual(new Set(["claude"]));
    expect(v.size).toBe(1);
  });

  it("counts each distinct vendor once", () => {
    const v = distinctVendors([a("c", "claude"), a("x", "codex"), a("g", "gemini")]);
    expect(v.size).toBe(3);
  });
});

describe("assertReviewable (D-29 hard gate, no override)", () => {
  it("throws on a single distinct vendor, naming the vendors found", () => {
    expect(() => assertReviewable([a("c1", "claude"), a("c2", "claude")])).toThrow(
      /review needs >=2 distinct vendors; found: claude/,
    );
  });

  it("passes with claude + codex (two distinct vendors)", () => {
    expect(() => assertReviewable([a("c1", "claude"), a("x1", "codex")])).not.toThrow();
  });

  it("throws on an empty roster, naming 'none'", () => {
    expect(() => assertReviewable([])).toThrow(/found: none/);
  });
});

describe("applySkipFailed (D-30 — diversity invariant never compromised)", () => {
  it("drops failing agents and proceeds when >=2 distinct vendors remain", () => {
    const healthy = [a("claude-1", "claude"), a("codex-1", "codex")];
    const failed = [a("gemini-1", "gemini")];
    const remaining = applySkipFailed(healthy, failed);
    expect(remaining.map((x) => x.name)).toEqual(["claude-1", "codex-1"]);
    expect(remaining).not.toContainEqual(failed[0]);
  });

  it("throws when dropping failing agents leaves <2 distinct vendors", () => {
    const healthy = [a("claude-1", "claude")];
    const failed = [a("claude-2", "claude"), a("codex-1", "codex")];
    expect(() => applySkipFailed(healthy, failed)).toThrow(/review needs >=2 distinct vendors/);
  });
});
