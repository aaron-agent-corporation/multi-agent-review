import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeArtifact } from "../src/workspace/artifacts.js";
import { artifactName } from "../src/workspace/layout.js";

let runDir: string;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "mar-fm-"));
});

afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
});

/** Split a written artifact into its frontmatter block + body. */
function splitArtifact(seq: number, agent: string): { frontmatter: string; body: string } {
  const text = readFileSync(join(runDir, artifactName(seq, agent)), "utf8");
  // Frontmatter is the first `---\n...\n---\n` block; the body follows.
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`artifact has no well-formed frontmatter block:\n${text}`);
  return { frontmatter: m[1], body: m[2] };
}

describe("writeArtifact frontmatter sanitization (CR-01)", () => {
  it("writes a well-formed frontmatter block for a benign sessionId", async () => {
    await writeArtifact(runDir, 1, "claude", {
      text: "pong",
      raw: { ok: true },
      frontmatter: { runId: "20260604-x7Kp2a", sessionId: "4eea0b0a" },
    });
    const { frontmatter, body } = splitArtifact(1, "claude");
    expect(frontmatter).toContain('sessionId: "4eea0b0a"');
    expect(body).toContain("pong");
  });

  it("neutralizes a malicious sessionId that tries to break out of the frontmatter", async () => {
    // A value that, interpolated raw, would close the frontmatter early and inject a key.
    const malicious = "a\n---\ninjected: true\nsessionId-evil: pwned";
    await writeArtifact(runDir, 2, "claude", {
      text: "BODY-MARKER",
      raw: { ok: true },
      frontmatter: { runId: "20260604-x7Kp2a", sessionId: malicious },
    });

    const { frontmatter, body } = splitArtifact(2, "claude");

    // The injected keys must NOT appear as real frontmatter keys.
    expect(frontmatter).not.toMatch(/^injected:/m);
    expect(frontmatter).not.toMatch(/^sessionId-evil:/m);
    // The sessionId is on a single quoted line — no raw newline leaked into the block.
    const sessionLines = frontmatter.split("\n").filter((l) => l.startsWith("sessionId:"));
    expect(sessionLines).toHaveLength(1);
    expect(sessionLines[0]).not.toContain("\n");
    // The payload survives only as the *content* of a single quoted scalar (newlines collapsed
    // to spaces), never as frontmatter structure. It is double-quoted, so a parser reads it as
    // one string value, not a delimiter or a new key.
    expect(sessionLines[0]).toMatch(/^sessionId: ".*"$/);
    expect(sessionLines[0]).toContain("injected: true"); // present only as inert quoted text
    // The real body marker is intact and the body was not corrupted by an early `---`.
    expect(body).toContain("BODY-MARKER");
  });

  it("strips control characters from a scalar value", async () => {
    const withControls = `tab\there\x00null\x07bell`;
    await writeArtifact(runDir, 3, "claude", {
      text: "pong",
      raw: {},
      frontmatter: { sessionId: withControls },
    });
    const { frontmatter } = splitArtifact(3, "claude");
    const line = frontmatter.split("\n").find((l) => l.startsWith("sessionId:")) ?? "";
    // No raw control bytes survive in the frontmatter line.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting control chars are absent.
    expect(line).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
  });
});
