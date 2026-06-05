import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAgentFrontmatter, readAgentFrontmatter } from "../src/protocol/frontmatter.js";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "mar-frontmatter-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Build the on-disk artifact shape writeArtifact produces: the engine-metadata wrapper block FIRST,
 * then a blank line, then the agent's own body. `agentBody` is what the model emitted as its turn.
 */
function wrapped(agentBody: string): string {
  const engine = ['agent: "claude"', "seq: 1", 'kind: "evaluation"', 'runId: "r1"'].join("\n");
  return `---\n${engine}\n---\n\n${agentBody}\n`;
}

const CLEAN_AGENT = [
  "phase: evaluation",
  "author: claude",
  "round: 1",
  "proposedBase: claude",
].join("\n");

describe("shared tolerant frontmatter reader (Pitfall 4)", () => {
  it("reads the agent fields from a wrapper + clean-agent-frontmatter artifact", async () => {
    const p = join(work, "clean.md");
    writeFileSync(p, wrapped(`---\n${CLEAN_AGENT}\n---\n\n# Eval by claude\n`));
    const data = (await readAgentFrontmatter(p)) as Record<string, unknown>;
    expect(data).not.toBeNull();
    expect(data.phase).toBe("evaluation");
    expect(data.author).toBe("claude");
    expect(data.proposedBase).toBe("claude");
  });

  it("reads the agent fields when PREAMBLE PROSE precedes the agent frontmatter (tolerant path)", async () => {
    // The Pitfall-4 regression guard: a model emitted explanatory prose before its `---` block. The
    // OLD strict double-parse (matter → matter(content.trimStart())) sees prose at position 0, finds
    // no frontmatter there, and returns empty data — silently dropping a valid artifact the live gate
    // accepted. The tolerant reader falls back to the FIRST `---` delimiter and recovers the fields.
    const preamble = "Sure — here is my evaluation for this round:\n\n";
    const p = join(work, "preamble.md");
    writeFileSync(p, wrapped(`${preamble}---\n${CLEAN_AGENT}\n---\n\n# Eval by claude\n`));
    const data = (await readAgentFrontmatter(p)) as Record<string, unknown>;
    expect(data).not.toBeNull();
    expect(data.phase).toBe("evaluation");
    expect(data.author).toBe("claude");
    expect(data.proposedBase).toBe("claude");
  });

  it("a strict double-parse would have dropped the preamble artifact (contrast)", () => {
    // Documents WHY the tolerant path matters: parsing the inner body directly (no first-`---`
    // fallback) yields empty data when prose precedes the block. parseAgentFrontmatter recovers it.
    const preamble = "Some prose first.\n\n";
    const raw = wrapped(`${preamble}---\n${CLEAN_AGENT}\n---\n\n# body\n`);
    const data = parseAgentFrontmatter(raw) as Record<string, unknown>;
    expect(data.author).toBe("claude");
  });

  it("returns null for a missing file (non-signal semantics preserved)", async () => {
    expect(await readAgentFrontmatter(join(work, "nope.md"))).toBeNull();
  });
});
