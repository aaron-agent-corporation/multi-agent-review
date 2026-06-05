// PROT-04 independence-as-a-filesystem-fact tests (Phase 3, Plan 03-01). The project's
// highest-stakes invariant: during drafting, each agent runs in its own work/<agent>/ dir whose
// listing physically CANNOT contain a peer's draft (no anchoring). Drafts reach shared/ ONLY via
// an explicit promotion step at the 1->2 phase boundary, never written there during drafting.
//
// These tests use mkdtempSync for an isolated runDir so they touch no real workspace.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artifactName } from "../src/workspace/layout.js";
import { draftFileName, promoteDrafts, scopedWorkdir } from "../src/workspace/scope.js";

let runDir: string;
let inputPath: string;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "mar-scope-"));
  inputPath = join(runDir, "source.md");
  writeFileSync(inputPath, "# the document under review\n", "utf8");
});

afterEach(() => {
  if (runDir) rmSync(runDir, { recursive: true, force: true });
});

/** Simulate an agent finishing its draft inside its scoped workdir. */
function writeDraft(dir: string, agent: string, body: string): void {
  writeFileSync(join(dir, draftFileName(agent)), body, "utf8");
}

describe("scopedWorkdir gives each agent an isolated draft dir (PROT-04)", () => {
  it("creates work/<agent>/, copies the input as input.md, returns that dir", async () => {
    const dir = await scopedWorkdir(runDir, "alice", inputPath, "claude");
    expect(dir).toBe(join(runDir, "work", "alice"));
    expect(existsSync(join(dir, "input.md"))).toBe(true);
  });

  it("a scoped workdir seeds input.md + the vendor instruction file — no peer artifacts", async () => {
    const dir = await scopedWorkdir(runDir, "alice", inputPath, "claude");
    // The seeded contract (CLAUDE.md for a claude agent) is expected; a PEER's draft is not.
    expect(readdirSync(dir).sort()).toEqual(["CLAUDE.md", "input.md"]);
  });

  it("alice's workdir does NOT contain bob's draft (cross-agent exclusion)", async () => {
    const aliceDir = await scopedWorkdir(runDir, "alice", inputPath, "claude");
    const bobDir = await scopedWorkdir(runDir, "bob", inputPath, "codex");
    // Both agents draft independently in their own dirs.
    writeDraft(aliceDir, "alice", "alice draft");
    writeDraft(bobDir, "bob", "bob draft");
    // The core confidentiality invariant: alice's listing cannot include bob's draft file.
    expect(readdirSync(aliceDir)).not.toContain(draftFileName("bob"));
    expect(readdirSync(bobDir)).not.toContain(draftFileName("alice"));
  });

  it("rejects an agent name with a path separator or '..' (no runDir escape)", async () => {
    await expect(scopedWorkdir(runDir, "../evil", inputPath, "claude")).rejects.toThrow();
    await expect(scopedWorkdir(runDir, "a/b", inputPath, "claude")).rejects.toThrow();
  });
});

describe("draftFileName is the single deterministic naming source", () => {
  it("returns the seq-1 draft artifact name so promotion and listing agree", () => {
    expect(draftFileName("alice")).toBe(artifactName(1, "alice", "draft"));
  });
});

describe("promoteDrafts is the ONLY writer to shared/ for drafts (boundary promotion)", () => {
  it("shared/ has no draft before promotion, both drafts after", async () => {
    const aliceDir = await scopedWorkdir(runDir, "alice", inputPath, "claude");
    const bobDir = await scopedWorkdir(runDir, "bob", inputPath, "codex");
    writeDraft(aliceDir, "alice", "alice draft");
    writeDraft(bobDir, "bob", "bob draft");

    const sharedDir = join(runDir, "shared");
    // Boundary assertion: nothing has been promoted yet.
    const beforeDraftCount = existsSync(sharedDir)
      ? readdirSync(sharedDir).filter((f) => f.endsWith("-draft.md")).length
      : 0;
    expect(beforeDraftCount).toBe(0);

    await promoteDrafts(runDir, ["alice", "bob"]);

    expect(existsSync(join(sharedDir, draftFileName("alice")))).toBe(true);
    expect(existsSync(join(sharedDir, draftFileName("bob")))).toBe(true);
  });

  it("WR-02: a missing/empty promotion source throws a descriptive error naming the agent + path", async () => {
    const aliceDir = await scopedWorkdir(runDir, "alice", inputPath, "claude");
    await scopedWorkdir(runDir, "bob", inputPath, "codex");
    writeDraft(aliceDir, "alice", "alice draft");
    // bob never wrote a draft → its promotion source is absent. The old code surfaced an opaque
    // ENOENT from fsExtra.copy; the guard now throws a message naming the agent + source path so
    // the engine can persist a meaningful failureReason.
    await expect(promoteDrafts(runDir, ["alice", "bob"])).rejects.toThrow(/bob/);
    await expect(promoteDrafts(runDir, ["alice", "bob"])).rejects.toThrow(/draft/i);
  });

  it("WR-02: an empty (0-byte) promotion source is treated as missing (isDone gate)", async () => {
    const aliceDir = await scopedWorkdir(runDir, "alice", inputPath, "claude");
    // 0-byte draft: exists but not "done".
    writeFileSync(join(aliceDir, draftFileName("alice")), "", "utf8");
    await expect(promoteDrafts(runDir, ["alice"])).rejects.toThrow(/alice/);
  });
});
