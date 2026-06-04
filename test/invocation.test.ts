import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type InvocationRecord, logInvocation } from "../src/log/invocation.js";

let runDir: string;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "mar-inv-"));
});

afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
});

function rec(overrides: Partial<InvocationRecord> = {}): InvocationRecord {
  return {
    command: ["-p", "promptRef:prompt-001.txt", "--output-format", "json"],
    promptRef: "prompt-001.txt",
    exitCode: 0,
    durationMs: 2588,
    timedOut: false,
    artifactPath: "runs/x/001-claude-output.md",
    attempt: 1,
    ...overrides,
  };
}

function readLines(): string[] {
  const raw = readFileSync(join(runDir, "invocations.ndjson"), "utf8");
  return raw.split("\n").filter((l) => l.trim().length > 0);
}

describe("logInvocation", () => {
  it("appends one parseable NDJSON line per call; line count === call count", () => {
    logInvocation(runDir, rec({ promptRef: "p1" }));
    logInvocation(runDir, rec({ promptRef: "p2", exitCode: 1 }));
    logInvocation(runDir, rec({ promptRef: "p3", timedOut: true }));

    const lines = readLines();
    expect(lines).toHaveLength(3);
    // Every line is independently JSON-parseable.
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("each record carries all six required fields", () => {
    logInvocation(runDir, rec());
    const parsed = JSON.parse(readLines()[0]);
    for (const field of [
      "command",
      "promptRef",
      "exitCode",
      "durationMs",
      "timedOut",
      "artifactPath",
    ]) {
      expect(parsed).toHaveProperty(field);
    }
    expect(parsed.command).toEqual(["-p", "promptRef:prompt-001.txt", "--output-format", "json"]);
  });

  it("stores only a prompt reference, never the full multi-line prompt body", () => {
    const fullPrompt = "line one of a sensitive prompt\nline two\nline three with secrets";
    // The caller is responsible for passing a reference, not the body. Assert the logger does
    // not somehow capture multi-line content, and that promptRef stays a short reference.
    logInvocation(runDir, rec({ promptRef: "prompt-042.txt" }));
    const fileText = readFileSync(join(runDir, "invocations.ndjson"), "utf8");
    expect(fileText).not.toContain(fullPrompt);
    const parsed = JSON.parse(readLines()[0]);
    expect(parsed.promptRef).toBe("prompt-042.txt");
    expect(parsed.promptRef).not.toContain("\n");
  });

  it("writes to a file named invocations.ndjson", () => {
    logInvocation(runDir, rec());
    expect(() => readFileSync(join(runDir, "invocations.ndjson"), "utf8")).not.toThrow();
  });

  it("round-trips the attempt field (D-25): a record with attempt:2 carries attempt:2", () => {
    logInvocation(runDir, rec({ attempt: 2 }));
    const parsed = JSON.parse(readLines()[0]);
    expect(parsed.attempt).toBe(2);
    // The original six audit fields remain present and unchanged.
    for (const field of [
      "command",
      "promptRef",
      "exitCode",
      "durationMs",
      "timedOut",
      "artifactPath",
    ]) {
      expect(parsed).toHaveProperty(field);
    }
  });
});
