import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { TurnRequest } from "../src/adapters/adapter.js";
import { makeClaudeAdapter } from "../src/adapters/claude.js";

// Absolute path to the executable fake-claude fixture (node shebang, chmod +x).
// Spawning the fixture directly as `bin` means the adapter's argv (`-p <prompt> --output-format json`)
// is passed straight to it; the fixture selects its mode from argv via `args.includes(...)`,
// so a prompt of "--fail-auth"/"--bad-json"/"--hang" drives the corresponding failure mode.
const FIXTURE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

function req(promptText: string, timeoutMs = 5000): TurnRequest {
  return { agent: "claude", promptText, runDir: "runs/test", seq: 1, timeoutMs };
}

describe("makeClaudeAdapter (against fake-claude fixture)", () => {
  it("happy path → ok:true, normalized text + cost", async () => {
    const adapter = makeClaudeAdapter(FIXTURE);
    const r = await adapter.invoke(req("ping"));
    expect(r.ok).toBe(true);
    expect(r.text).toBe("pong");
    expect(r.agent).toBe("claude");
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.costUsd).toBeCloseTo(0.19, 2);
    expect(r.sessionId).toBe("4eea0b0a");
    expect(r.error).toBeUndefined();
  });

  it("--fail-auth → ok:false despite misleading subtype 'success' (exit 1 AND is_error)", async () => {
    const adapter = makeClaudeAdapter(FIXTURE);
    const r = await adapter.invoke(req("--fail-auth"));
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    expect(r.exitCode).toBe(1);
    expect(r.error).toContain("Not logged in");
  });

  it("--bad-json → graceful ok:false 'unparseable', no throw", async () => {
    const adapter = makeClaudeAdapter(FIXTURE);
    const r = await adapter.invoke(req("--bad-json"));
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    expect(r.error).toContain("unparseable");
    expect(r.timedOut).toBe(false);
  });

  it("--hang with timeoutMs:200 → ok:false, timedOut:true, process killed", async () => {
    const adapter = makeClaudeAdapter(FIXTURE);
    const r = await adapter.invoke(req("--hang", 200));
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toBe("timeout");
  });

  it("flag-pinning: invokes with exactly ['-p', prompt, '--output-format', 'json'] and NEVER --bare", async () => {
    // Mock execa to capture argv without spawning anything.
    const execaMock = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ is_error: false, result: "pong" }),
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
      isForcefullyTerminated: false,
    });
    vi.doMock("execa", () => ({ execa: execaMock }));
    // Re-import the adapter so it binds the mocked execa.
    vi.resetModules();
    const { makeClaudeAdapter: freshAdapter } = await import("../src/adapters/claude.js");

    const adapter = freshAdapter("claude");
    await adapter.invoke(req("hello world"));

    expect(execaMock).toHaveBeenCalledTimes(1);
    const [bin, argv, opts] = execaMock.mock.calls[0];
    expect(bin).toBe("claude");
    expect(argv).toEqual(["-p", "hello world", "--output-format", "json"]);
    expect(argv).not.toContain("--bare");
    expect(opts.reject).toBe(false);
    expect(opts.timeout).toBe(5000);

    vi.doUnmock("execa");
    vi.resetModules();
  });
});
