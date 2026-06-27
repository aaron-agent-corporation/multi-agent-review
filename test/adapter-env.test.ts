import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

function mockExeca(stdout: string) {
  const calls: Array<{ cmd: string; argv: string[]; opts: Record<string, unknown> }> = [];
  vi.doMock("execa", () => ({
    execa: (cmd: string, argv: string[], opts: Record<string, unknown>) => {
      calls.push({ cmd, argv, opts });
      return Promise.resolve({
        stdout,
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        isForcefullyTerminated: false,
      });
    },
  }));
  return calls;
}

const grokSourceHome = mkdtempSync(join(tmpdir(), "mar-grok-env-source-"));
const grokHome = join(grokSourceHome, "runtime");

const req = {
  agent: "x",
  promptText: "ping",
  runDir: "/tmp/x",
  seq: 0,
  timeoutMs: 1000,
  env: {
    ANTHROPIC_API_KEY: "secret",
    HOME: grokSourceHome,
    MAR_CODEX_HOME: "/tmp/codex-home",
    MAR_GROK_HOME: grokHome,
  },
};

afterAll(() => {
  rmSync(grokSourceHome, { recursive: true, force: true });
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("execa");
});

describe("adapter env threading", () => {
  it("claude adapter passes repo-local env overlay", async () => {
    const calls = mockExeca(JSON.stringify({ is_error: false, result: "pong" }));
    const { makeClaudeAdapter } = await import("../src/adapters/claude.js");
    await makeClaudeAdapter("claude").invoke(req);
    expect(calls[0].opts.env).toMatchObject({ ANTHROPIC_API_KEY: "secret" });
  });

  it("codex adapter preserves CODEX_HOME while honoring MAR_CODEX_HOME", async () => {
    const calls = mockExeca(`${JSON.stringify({ type: "turn.completed" })}\n`);
    const { makeCodexAdapter } = await import("../src/adapters/codex.js");
    await makeCodexAdapter("codex").invoke(req);
    expect(calls[0].opts.env).toMatchObject({
      ANTHROPIC_API_KEY: "secret",
      MAR_CODEX_HOME: "/tmp/codex-home",
      CODEX_HOME: "/tmp/codex-home",
    });
  });

  it("gemini adapter passes repo-local env overlay", async () => {
    const calls = mockExeca(JSON.stringify({ response: "pong" }));
    const { makeGeminiAdapter } = await import("../src/adapters/gemini.js");
    await makeGeminiAdapter("gemini").invoke(req);
    expect(calls[0].opts.env).toMatchObject({ ANTHROPIC_API_KEY: "secret" });
  });

  it("grok adapter passes repo-local env overlay", async () => {
    const calls = mockExeca(JSON.stringify({ response: "pong" }));
    const { makeGrokAdapter } = await import("../src/adapters/grok.js");
    await makeGrokAdapter("grok").invoke(req);
    expect(calls[0].opts.env).toMatchObject({
      ANTHROPIC_API_KEY: "secret",
      MAR_GROK_HOME: grokHome,
      GROK_HOME: grokHome,
    });
  });
});
