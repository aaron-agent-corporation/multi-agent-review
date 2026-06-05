import { describe, expect, it } from "vitest";
import { Manifest } from "../src/schema/manifest.js";
import { TurnResult } from "../src/schema/turn.js";
import {
  artifactName,
  artifactPath,
  newRunId,
  nextSeq,
  rawPath,
  runDir,
  seqFromArtifactName,
} from "../src/workspace/layout.js";

describe("layout naming", () => {
  it("artifactName zero-pads seq to 3 and defaults kind to output", () => {
    expect(artifactName(1, "claude")).toBe("001-claude-output.md");
  });

  it("artifactName honors an explicit kind", () => {
    expect(artifactName(12, "claude", "draft")).toBe("012-claude-draft.md");
  });

  it("newRunId matches timestamp-prefix + nanoid and is unique per call", () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).toMatch(/^\d{8}-[A-Za-z0-9_-]{6,}$/);
    expect(b).toMatch(/^\d{8}-[A-Za-z0-9_-]{6,}$/);
    expect(a).not.toBe(b);
  });

  it("runDir composes runs/<id>", () => {
    expect(runDir("20260604-x7Kp2a")).toBe("runs/20260604-x7Kp2a");
  });

  it("artifactPath joins run dir + artifact name", () => {
    expect(artifactPath("runs/r1", 1, "claude")).toBe("runs/r1/001-claude-output.md");
  });

  it("rawPath replaces .md with .raw.json", () => {
    expect(rawPath("runs/r1", 1, "claude")).toBe("runs/r1/001-claude-output.raw.json");
  });
});

describe("seq derivation (WR-03: monotonic over all turns)", () => {
  it("seqFromArtifactName parses the leading zero-padded seq", () => {
    expect(seqFromArtifactName("001-claude-output.md")).toBe(1);
    expect(seqFromArtifactName("012-claude-draft.md")).toBe(12);
  });

  it("WR-05: seqFromArtifactName also counts the .raw.json sibling (orphan-safe)", () => {
    // A crash between writeArtifact's two atomic writes can leave a .raw.json with no .md. Seq
    // derivation MUST see it so a resumed run never reuses the seq and overwrites the orphan raw.
    expect(seqFromArtifactName("001-claude-output.raw.json")).toBe(1);
    expect(seqFromArtifactName("012-claude-draft.raw.json")).toBe(12);
  });

  it("seqFromArtifactName returns null for non-artifact names", () => {
    expect(seqFromArtifactName("manifest.json")).toBeNull();
    expect(seqFromArtifactName("invocations.ndjson")).toBeNull();
  });

  it("nextSeq is 1 for an empty run", () => {
    expect(nextSeq([], [])).toBe(1);
  });

  it("nextSeq advances past the max manifest seq even when artifact count is lower", () => {
    // Only one successful artifact recorded (seq 3), but it implies turns 1-2 happened/failed.
    // Deriving from length (1) would reuse seq 2; deriving from max seq (3) yields 4.
    expect(nextSeq(["003-claude-output.md"], [])).toBe(4);
  });

  it("nextSeq accounts for on-disk files not yet in the manifest (failed/partial turns)", () => {
    // Manifest only knows seq 1, but seq 2's file exists on disk → next must be 3, not 2.
    expect(
      nextSeq(["001-claude-output.md"], ["001-claude-output.md", "002-claude-output.md"]),
    ).toBe(3);
  });

  it("nextSeq tolerates relative paths in the manifest by taking the basename", () => {
    expect(nextSeq(["runs/r1/005-claude-output.md"], [])).toBe(6);
  });

  it("WR-05: nextSeq advances past an orphan .raw.json with no .md sibling", () => {
    // Manifest knows seq 1; on disk an orphan seq-2 .raw.json (no .md, no manifest entry) exists.
    // nextSeq must return 3 so the resumed turn never reuses seq 2 and clobbers the orphan raw.
    expect(nextSeq(["001-claude-output.md"], ["001-claude-output.md", "002-claude-draft.raw.json"])).toBe(3);
  });
});

describe("TurnResult schema (vendor-agnostic)", () => {
  it("rejects an object missing ok", () => {
    const r = TurnResult.safeParse({
      agent: "claude",
      text: "hi",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a full valid TurnResult", () => {
    const r = TurnResult.safeParse({
      ok: true,
      agent: "claude",
      text: "pong",
      exitCode: 0,
      durationMs: 2588,
      timedOut: false,
      redactedCommand: ["-p", "<prompt>", "--output-format", "json"],
      costUsd: 0.19,
      sessionId: "4eea0b0a",
    });
    expect(r.success).toBe(true);
  });

  it("requires redactedCommand (WR-04)", () => {
    const r = TurnResult.safeParse({
      ok: true,
      agent: "claude",
      text: "pong",
      exitCode: 0,
      durationMs: 2588,
      timedOut: false,
    });
    expect(r.success).toBe(false);
  });
});

describe("Manifest schema", () => {
  it("rejects a bogus status", () => {
    const r = Manifest.safeParse({
      runId: "r1",
      status: "bogus",
      createdAt: "now",
      updatedAt: "now",
      cliVersions: {},
      artifacts: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts status created", () => {
    const r = Manifest.safeParse({
      runId: "r1",
      status: "created",
      createdAt: "now",
      updatedAt: "now",
      cliVersions: { claude: "2.1.162" },
      artifacts: [],
    });
    expect(r.success).toBe(true);
  });
});
