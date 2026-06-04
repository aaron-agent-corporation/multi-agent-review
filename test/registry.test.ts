import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { TurnRequest } from "../src/adapters/adapter.js";
// Module implemented in Task 3 (the ORCH-03 seam) — import stays RED until then.
import { makeAdapter } from "../src/adapters/registry.js";

const CODEX_FIXTURE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));

function req(promptText: string, timeoutMs = 5000): TurnRequest {
  return { agent: "codex", promptText, runDir: "runs/test", seq: 1, timeoutMs };
}

describe("makeAdapter registry (ORCH-03 seam)", () => {
  it("returns a correctly-named adapter for each vendor", () => {
    expect(makeAdapter("claude").name).toBe("claude");
    expect(makeAdapter("codex").name).toBe("codex");
    expect(makeAdapter("gemini").name).toBe("gemini");
  });

  it("threads a bin override through to the factory", async () => {
    const adapter = makeAdapter("codex", CODEX_FIXTURE);
    const r = await adapter.invoke(req("ping"));
    expect(r.ok).toBe(true);
    expect(r.text).toBe("pong");
  });

  it("threads BOTH bin and model through to the factory (model flag in spawned argv)", async () => {
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
    const { makeAdapter: fresh } = await import("../src/adapters/registry.js");

    const adapter = fresh("codex", "/custom/bin", "o4");
    await adapter.invoke(req("hi"));

    const [bin, argv] = execaMock.mock.calls[0];
    expect(bin).toBe("/custom/bin");
    expect(argv).toContain("-m");
    expect(argv).toContain("o4");

    vi.doUnmock("execa");
    vi.resetModules();
  });

  it("FACTORIES exposes exactly the three vendor keys (adding a vendor = one map entry)", async () => {
    const mod = await import("../src/adapters/registry.js");
    expect(Object.keys(mod.FACTORIES).sort()).toEqual(["claude", "codex", "gemini"]);
  });
});
