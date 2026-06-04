import { describe, expect, it } from "vitest";
import { Manifest } from "../src/schema/manifest.js";
import { TurnResult } from "../src/schema/turn.js";
import { artifactName, artifactPath, newRunId, rawPath, runDir } from "../src/workspace/layout.js";

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
      costUsd: 0.19,
      sessionId: "4eea0b0a",
    });
    expect(r.success).toBe(true);
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
