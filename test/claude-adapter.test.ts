import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { TurnRequest } from "../src/adapters/adapter.js";
import { makeClaudeAdapter, splitBin } from "../src/adapters/claude.js";

// Absolute path to the executable fake-claude fixture (node shebang, chmod +x).
// Spawning the fixture directly as `bin` means the adapter's argv (`-p <prompt> --output-format json`)
// is passed straight to it; the fixture selects its mode from argv via `args.includes(...)`,
// so a prompt of "--fail-auth"/"--bad-json"/"--hang" drives the corresponding failure mode.
const FIXTURE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

describe("splitBin (WR-01: single split keeps spaced paths intact)", () => {
  it("returns the bare bin with no preArgs for a plain executable name", () => {
    expect(splitBin("claude")).toEqual({ cmd: "claude", preArgs: [] });
  });

  it("splits a launcher form on the FIRST whitespace only", () => {
    // The remainder (a script path) stays a SINGLE arg even when it contains spaces.
    expect(splitBin("node /home/Active Projects/fake-claude.mjs")).toEqual({
      cmd: "node",
      preArgs: ["/home/Active Projects/fake-claude.mjs"],
    });
  });

  it("treats a whole existing spaced path as the executable, never splitting it", () => {
    // The fixture path itself contains no spaces, but it IS an existing file, so it must be
    // returned verbatim as the executable with no preArgs.
    expect(splitBin(FIXTURE)).toEqual({ cmd: FIXTURE, preArgs: [] });
  });
});

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
    // WR-04: the adapter reports the redacted argv it actually spawned (prompt → placeholder).
    expect(r.redactedCommand).toEqual(["-p", "<prompt>", "--output-format", "json"]);
  });

  it("WR-04: redactedCommand replaces the prompt body with a placeholder, never leaking it", async () => {
    const adapter = makeClaudeAdapter(FIXTURE);
    const secret = "ping super-secret-prompt-body";
    const r = await adapter.invoke(req(secret));
    expect(r.redactedCommand).not.toContain(secret);
    expect(r.redactedCommand).toContain("<prompt>");
    // The flag set is the real one the adapter spawns — one source of truth with the spawn.
    expect(r.redactedCommand).toEqual(["-p", "<prompt>", "--output-format", "json"]);
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
