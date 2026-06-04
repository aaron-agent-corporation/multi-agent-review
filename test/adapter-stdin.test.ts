// Regression guard for the 02-05 live-checkpoint fix: every adapter MUST pass `stdin: "ignore"`
// to execa. The codex CLI BLOCKS on an open stdin pipe (execa's default), hanging every
// invocation until the wall-clock timeout. The prompt is always an argv value, never stdin, so
// closing stdin is always correct — and required for codex to run at all. This guard asserts the
// option at the execa call site (behavioral mock) so a future edit that drops it fails loudly.

import { afterEach, describe, expect, it, vi } from "vitest";

/** Capture the options object passed to execa, then short-circuit with a happy result. */
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

const req = (promptText: string) => ({
  agent: "x",
  promptText,
  runDir: "/tmp/x",
  seq: 0,
  timeoutMs: 1000,
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("execa");
});

describe("adapter execa options pin stdin:'ignore' (02-05 codex-hang fix)", () => {
  it("codex adapter passes stdin:'ignore'", async () => {
    // A valid codex NDJSON terminal event so the adapter resolves ok.
    const ndjson = `${JSON.stringify({ type: "turn.completed" })}\n`;
    const calls = mockExeca(ndjson);
    const { makeCodexAdapter } = await import("../src/adapters/codex.js");
    await makeCodexAdapter("codex").invoke(req("ping"));
    expect(calls[0].opts.stdin).toBe("ignore");
  });

  it("gemini adapter passes stdin:'ignore'", async () => {
    const calls = mockExeca(JSON.stringify({ response: "pong" }));
    const { makeGeminiAdapter } = await import("../src/adapters/gemini.js");
    await makeGeminiAdapter("gemini").invoke(req("ping"));
    expect(calls[0].opts.stdin).toBe("ignore");
  });

  it("claude adapter passes stdin:'ignore'", async () => {
    const calls = mockExeca(JSON.stringify({ is_error: false, result: "pong" }));
    const { makeClaudeAdapter } = await import("../src/adapters/claude.js");
    await makeClaudeAdapter("claude").invoke(req("ping"));
    expect(calls[0].opts.stdin).toBe("ignore");
  });
});
