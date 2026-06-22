import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { TurnRequest } from "../src/adapters/adapter.js";
import { makeGrokAdapter } from "../src/adapters/grok.js";
import { GrokJson } from "../src/schema/turn.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-grok.mjs", import.meta.url));

function req(promptText: string, timeoutMs = 5000): TurnRequest {
  return { agent: "grok", promptText, runDir: "runs/test", seq: 1, timeoutMs };
}

describe("GrokJson schema (drift-safe, tolerates extra keys)", () => {
  it("accepts a happy response object", () => {
    const parsed = GrokJson.safeParse({ response: "pong", sessionId: "abc", extra: true });
    expect(parsed.success).toBe(true);
  });

  it("accepts a failure error object", () => {
    const parsed = GrokJson.safeParse({
      error: { message: "Authentication required" },
      session_id: "abc",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("makeGrokAdapter (against fake-grok fixture)", () => {
  it("happy path -> ok:true, text:'pong' from top-level response", async () => {
    const adapter = makeGrokAdapter(FIXTURE);
    const r = await adapter.invoke(req("ping"));
    expect(r.ok).toBe(true);
    expect(r.text).toBe("pong");
    expect(r.agent).toBe("grok");
    expect(r.sessionId).toBe("grok-session-1");
    expect(r.error).toBeUndefined();
  });

  it("--fail-auth JSON on stderr -> ok:false with parsed error", async () => {
    const adapter = makeGrokAdapter(FIXTURE);
    const r = await adapter.invoke(req("--fail-auth"));
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    expect(r.error).toContain("Authentication required");
  });

  it("--bad-json -> graceful ok:false 'unparseable', no throw", async () => {
    const adapter = makeGrokAdapter(FIXTURE);
    const r = await adapter.invoke(req("--bad-json"));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unparseable");
  });

  it("--hang with timeoutMs:200 -> ok:false, timedOut:true, error:'timeout'", async () => {
    const adapter = makeGrokAdapter(FIXTURE);
    const r = await adapter.invoke(req("--hang", 200));
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toBe("timeout");
  });

  it("flag-pinning: exact argv incl. --no-auto-update; --always-approve absent", async () => {
    const execaMock = vi.fn().mockResolvedValue({
      stdout: '{"response":"pong","session_id":"abc"}',
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
      isForcefullyTerminated: false,
    });
    vi.doMock("execa", () => ({ execa: execaMock }));
    vi.resetModules();
    const { makeGrokAdapter: fresh } = await import("../src/adapters/grok.js");

    const adapter = fresh("grok");
    await adapter.invoke(req("hello world"));

    expect(execaMock).toHaveBeenCalledTimes(1);
    const [bin, argv, opts] = execaMock.mock.calls[0];
    expect(bin).toBe("grok");
    expect(argv).toEqual([
      "-p",
      "hello world",
      "--output-format",
      "json",
      "--no-auto-update",
      "--permission-mode",
      "dontAsk",
      "--no-memory",
      "--no-subagents",
      "--disable-web-search",
    ]);
    expect(argv).not.toContain("--always-approve");
    expect(opts.reject).toBe(false);
    expect(opts.timeout).toBe(5000);

    vi.doUnmock("execa");
    vi.resetModules();
  });

  it("flag-pinning with model: makeGrokAdapter(bin, 'grok-build') appends ['-m','grok-build']", async () => {
    const execaMock = vi.fn().mockResolvedValue({
      stdout: '{"response":"pong"}',
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
      isForcefullyTerminated: false,
    });
    vi.doMock("execa", () => ({ execa: execaMock }));
    vi.resetModules();
    const { makeGrokAdapter: fresh } = await import("../src/adapters/grok.js");

    const adapter = fresh("grok", "grok-build");
    await adapter.invoke(req("hi"));

    const [, argv] = execaMock.mock.calls[0];
    expect(argv).toEqual([
      "-p",
      "hi",
      "--output-format",
      "json",
      "--no-auto-update",
      "--permission-mode",
      "dontAsk",
      "--no-memory",
      "--no-subagents",
      "--disable-web-search",
      "-m",
      "grok-build",
    ]);

    vi.doUnmock("execa");
    vi.resetModules();
  });
});
