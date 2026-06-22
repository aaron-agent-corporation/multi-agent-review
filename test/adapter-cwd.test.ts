// Drift guard for the PROT-04 cwd seam (Phase 3, Plan 03-01). Mirrors test/adapter-stdin.test.ts:
// mock execa, capture the options object, assert the option at the call site. Every adapter must
// thread `req.cwd` into the execa options ONLY when set, and leave it ABSENT (undefined) when
// unset — preserving today's behavior. A non-repo scoped cwd must NOT disturb the pinned codex
// flags (--skip-git-repo-check / --ephemeral / -s read-only) or stdin:"ignore".

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

/** Request factory with an OPTIONAL cwd — omit it to exercise the unchanged (absent) path. */
const req = (promptText: string, cwd?: string) => ({
  agent: "x",
  promptText,
  runDir: "/tmp/x",
  seq: 0,
  timeoutMs: 1000,
  ...(cwd ? { cwd } : {}),
});

const SCOPED = "/tmp/work/a";

// Vendor-specific happy stdout so each adapter resolves ok under the mock.
const CLAUDE_OK = JSON.stringify({ is_error: false, result: "pong" });
const CODEX_OK = `${JSON.stringify({ type: "turn.completed" })}\n`;
const GEMINI_OK = JSON.stringify({ response: "pong" });
const GROK_OK = JSON.stringify({ response: "pong" });

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("execa");
});

describe("adapters thread req.cwd into execa only when set (PROT-04 seam)", () => {
  it("claude adapter passes cwd when set", async () => {
    const calls = mockExeca(CLAUDE_OK);
    const { makeClaudeAdapter } = await import("../src/adapters/claude.js");
    await makeClaudeAdapter("claude").invoke(req("ping", SCOPED));
    expect(calls[0].opts.cwd).toBe(SCOPED);
  });

  it("claude adapter omits cwd when unset (undefined)", async () => {
    const calls = mockExeca(CLAUDE_OK);
    const { makeClaudeAdapter } = await import("../src/adapters/claude.js");
    await makeClaudeAdapter("claude").invoke(req("ping"));
    expect(calls[0].opts.cwd).toBeUndefined();
  });

  it("codex adapter passes cwd when set", async () => {
    const calls = mockExeca(CODEX_OK);
    const { makeCodexAdapter } = await import("../src/adapters/codex.js");
    await makeCodexAdapter("codex").invoke(req("ping", SCOPED));
    expect(calls[0].opts.cwd).toBe(SCOPED);
  });

  it("codex adapter omits cwd when unset (undefined)", async () => {
    const calls = mockExeca(CODEX_OK);
    const { makeCodexAdapter } = await import("../src/adapters/codex.js");
    await makeCodexAdapter("codex").invoke(req("ping"));
    expect(calls[0].opts.cwd).toBeUndefined();
  });

  it("gemini adapter passes cwd when set", async () => {
    const calls = mockExeca(GEMINI_OK);
    const { makeGeminiAdapter } = await import("../src/adapters/gemini.js");
    await makeGeminiAdapter("gemini").invoke(req("ping", SCOPED));
    expect(calls[0].opts.cwd).toBe(SCOPED);
  });

  it("gemini adapter omits cwd when unset (undefined)", async () => {
    const calls = mockExeca(GEMINI_OK);
    const { makeGeminiAdapter } = await import("../src/adapters/gemini.js");
    await makeGeminiAdapter("gemini").invoke(req("ping"));
    expect(calls[0].opts.cwd).toBeUndefined();
  });

  it("grok adapter passes cwd when set", async () => {
    const calls = mockExeca(GROK_OK);
    const { makeGrokAdapter } = await import("../src/adapters/grok.js");
    await makeGrokAdapter("grok").invoke(req("ping", SCOPED));
    expect(calls[0].opts.cwd).toBe(SCOPED);
  });

  it("grok adapter omits cwd when unset (undefined)", async () => {
    const calls = mockExeca(GROK_OK);
    const { makeGrokAdapter } = await import("../src/adapters/grok.js");
    await makeGrokAdapter("grok").invoke(req("ping"));
    expect(calls[0].opts.cwd).toBeUndefined();
  });

  it("codex pinned flags + stdin survive a scoped cwd (Pitfall 4)", async () => {
    const calls = mockExeca(CODEX_OK);
    const { makeCodexAdapter } = await import("../src/adapters/codex.js");
    await makeCodexAdapter("codex").invoke(req("ping", SCOPED));
    const { argv, opts } = calls[0];
    expect(argv).toContain("--skip-git-repo-check");
    expect(argv).toContain("--ephemeral");
    expect(argv).toContain("-s");
    expect(argv).toContain("read-only");
    expect(opts.stdin).toBe("ignore");
    expect(opts.cwd).toBe(SCOPED);
  });
});
