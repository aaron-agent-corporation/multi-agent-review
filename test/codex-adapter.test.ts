import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { TurnRequest } from "../src/adapters/adapter.js";
// Module implemented in Task 2 (GREEN) — import stays RED until then.
import { makeCodexAdapter } from "../src/adapters/codex.js";
import { CodexEvent } from "../src/schema/turn.js";

// Absolute path to the executable fake-codex fixture (node shebang, chmod +x). Spawning the
// fixture directly as `bin` passes the adapter's argv straight to it; the fixture selects its mode
// from argv via `args.includes(...)`, so a prompt of "--fail-auth"/"--rate-limit"/"--bad-json"/
// "--hang" drives the corresponding mode.
const FIXTURE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));

function req(promptText: string, timeoutMs = 5000): TurnRequest {
  return { agent: "codex", promptText, runDir: "runs/test", seq: 1, timeoutMs };
}

describe("CodexEvent schema (drift-safe, tolerates extra keys)", () => {
  it("accepts a happy item.completed agent_message event", () => {
    const parsed = CodexEvent.safeParse({
      type: "item.completed",
      item: { id: "item_0", type: "agent_message", text: "pong" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a turn.failed event with an error message", () => {
    const parsed = CodexEvent.safeParse({
      type: "turn.failed",
      error: { message: "401 Unauthorized" },
    });
    expect(parsed.success).toBe(true);
  });

  it("tolerates unknown extra keys via passthrough", () => {
    const parsed = CodexEvent.safeParse({ type: "thread.started", thread_id: "x", brand_new: 1 });
    expect(parsed.success).toBe(true);
  });
});

describe("makeCodexAdapter (against fake-codex fixture)", () => {
  it("happy path → ok:true, text:'pong' from agent_message, exit 0", async () => {
    const adapter = makeCodexAdapter(FIXTURE);
    const r = await adapter.invoke(req("ping"));
    expect(r.ok).toBe(true);
    expect(r.text).toBe("pong");
    expect(r.agent).toBe("codex");
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(0);
    expect(r.error).toBeUndefined();
  });

  it("--fail-auth → ok:false, text:'', error contains 401, not timedOut", async () => {
    const adapter = makeCodexAdapter(FIXTURE);
    const r = await adapter.invoke(req("--fail-auth"));
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    expect(r.error).toContain("401");
    expect(r.timedOut).toBe(false);
  });

  it("--bad-json / no terminal event → graceful ok:false 'unparseable', no throw", async () => {
    const adapter = makeCodexAdapter(FIXTURE);
    const r = await adapter.invoke(req("--bad-json"));
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    expect(r.error).toContain("unparseable");
    expect(r.timedOut).toBe(false);
  });

  it("--hang with timeoutMs:200 → ok:false, timedOut:true, error:'timeout'", async () => {
    const adapter = makeCodexAdapter(FIXTURE);
    const r = await adapter.invoke(req("--hang", 200));
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toBe("timeout");
  });

  it("WR-04: redactedCommand swaps the prompt body for the placeholder, never leaking it", async () => {
    const adapter = makeCodexAdapter(FIXTURE);
    const secret = "ping super-secret-prompt-body";
    const r = await adapter.invoke(req(secret));
    expect(r.redactedCommand).not.toContain(secret);
    expect(r.redactedCommand).toContain("<prompt>");
  });

  it("flag-pinning: exact argv incl. --skip-git-repo-check, --ephemeral, -s read-only; prompt trailing", async () => {
    const execaMock = vi.fn().mockResolvedValue({
      stdout: '{"type":"turn.completed"}',
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
      isForcefullyTerminated: false,
    });
    vi.doMock("execa", () => ({ execa: execaMock }));
    vi.resetModules();
    const { makeCodexAdapter: fresh } = await import("../src/adapters/codex.js");

    const adapter = fresh("codex");
    await adapter.invoke(req("hello world"));

    expect(execaMock).toHaveBeenCalledTimes(1);
    const [bin, argv, opts] = execaMock.mock.calls[0];
    expect(bin).toBe("codex");
    expect(argv).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "-s",
      "read-only",
      "hello world",
    ]);
    expect(argv).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(opts.reject).toBe(false);
    expect(opts.timeout).toBe(5000);

    vi.doUnmock("execa");
    vi.resetModules();
  });

  it("flag-pinning with model: makeCodexAdapter(bin, 'o4') adds ['-m','o4'] before the prompt", async () => {
    const execaMock = vi.fn().mockResolvedValue({
      stdout: '{"type":"turn.completed"}',
      stderr: "",
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
      isForcefullyTerminated: false,
    });
    vi.doMock("execa", () => ({ execa: execaMock }));
    vi.resetModules();
    const { makeCodexAdapter: fresh } = await import("../src/adapters/codex.js");

    const adapter = fresh("codex", "o4");
    await adapter.invoke(req("hi"));

    const [, argv] = execaMock.mock.calls[0];
    expect(argv).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "-s",
      "read-only",
      "-m",
      "o4",
      "hi",
    ]);

    vi.doUnmock("execa");
    vi.resetModules();
  });
});
