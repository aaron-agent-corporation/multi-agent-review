import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { TurnRequest } from "../src/adapters/adapter.js";
// Module implemented in Task 2 (GREEN) — import stays RED until then.
import { makeGeminiAdapter } from "../src/adapters/gemini.js";
import { GeminiJson } from "../src/schema/turn.js";

// Gemini is FIXTURE-BUILT (D-32): real gemini headless auth is broken on this machine, so every
// test runs against fake-gemini.mjs. The fixture selects its mode from argv via args.includes(...),
// so a prompt of "--fail-auth"/"--untrusted"/"--rate-limit"/"--bad-json"/"--hang" drives the mode.
const FIXTURE = fileURLToPath(new URL("./fixtures/fake-gemini.mjs", import.meta.url));

function req(promptText: string, timeoutMs = 5000): TurnRequest {
  return { agent: "gemini", promptText, runDir: "runs/test", seq: 1, timeoutMs };
}

describe("GeminiJson schema (drift-safe, tolerates extra keys)", () => {
  it("accepts a happy {response, stats} object", () => {
    const parsed = GeminiJson.safeParse({ response: "pong", stats: {}, brand_new: 1 });
    expect(parsed.success).toBe(true);
  });

  it("accepts a failure {session_id, error} object", () => {
    const parsed = GeminiJson.safeParse({
      session_id: "x",
      error: { type: "Error", message: "Please set an Auth method", code: 41 },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("makeGeminiAdapter (against fake-gemini fixture)", () => {
  it("happy path → ok:true, text:'pong' from top-level response", async () => {
    const adapter = makeGeminiAdapter(FIXTURE);
    const r = await adapter.invoke(req("ping"));
    expect(r.ok).toBe(true);
    expect(r.text).toBe("pong");
    expect(r.agent).toBe("gemini");
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.error).toBeUndefined();
  });

  it("--fail-auth (JSON on STDERR, exit 41) → ok:false, error parsed from stderr not stdout", async () => {
    const adapter = makeGeminiAdapter(FIXTURE);
    const r = await adapter.invoke(req("--fail-auth"));
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    // Proves the error JSON was parsed from STDERR (the message lives only there).
    expect(r.error).toContain("Auth method");
  });

  it("--untrusted (exit 55) → ok:false, error mentions the trusted directory gate", async () => {
    const adapter = makeGeminiAdapter(FIXTURE);
    const r = await adapter.invoke(req("--untrusted"));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("trusted directory");
  });

  it("--bad-json → graceful ok:false 'unparseable', no throw", async () => {
    const adapter = makeGeminiAdapter(FIXTURE);
    const r = await adapter.invoke(req("--bad-json"));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unparseable");
    expect(r.timedOut).toBe(false);
  });

  it("--hang with timeoutMs:200 → ok:false, timedOut:true, error:'timeout'", async () => {
    const adapter = makeGeminiAdapter(FIXTURE);
    const r = await adapter.invoke(req("--hang", 200));
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toBe("timeout");
  });

  it("flag-pinning: exact argv incl. --skip-trust; --yolo / -y absent", async () => {
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
    const { makeGeminiAdapter: fresh } = await import("../src/adapters/gemini.js");

    const adapter = fresh("gemini");
    await adapter.invoke(req("hello world"));

    expect(execaMock).toHaveBeenCalledTimes(1);
    const [bin, argv, opts] = execaMock.mock.calls[0];
    expect(bin).toBe("gemini");
    expect(argv).toEqual(["-p", "hello world", "--output-format", "json", "--skip-trust"]);
    expect(argv).not.toContain("--yolo");
    expect(argv).not.toContain("-y");
    expect(opts.reject).toBe(false);
    expect(opts.timeout).toBe(5000);

    vi.doUnmock("execa");
    vi.resetModules();
  });

  it("flag-pinning with model: makeGeminiAdapter(bin, 'flash') appends ['-m','flash']", async () => {
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
    const { makeGeminiAdapter: fresh } = await import("../src/adapters/gemini.js");

    const adapter = fresh("gemini", "flash");
    await adapter.invoke(req("hi"));

    const [, argv] = execaMock.mock.calls[0];
    expect(argv).toEqual([
      "-p",
      "hi",
      "--output-format",
      "json",
      "--skip-trust",
      "-m",
      "flash",
    ]);

    vi.doUnmock("execa");
    vi.resetModules();
  });
});
