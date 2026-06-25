import { describe, expect, it, vi } from "vitest";
import { assertTerminalModeSupported, tmuxSessionName } from "../src/execution/tmux.js";

describe("tmux execution seam", () => {
  it("builds a safe session name from a run id", () => {
    expect(tmuxSessionName("20260625-Abc_12")).toBe("mar-20260625-Abc_12");
    expect(() => tmuxSessionName("../bad")).toThrow(/unsafe/);
  });

  it("headless mode is supported without probing tmux", async () => {
    await expect(assertTerminalModeSupported("headless", "r1")).resolves.toEqual({});
  });

  it("tmux mode fails clearly when the pane-backed runner is not implemented", async () => {
    vi.doMock("execa", () => ({
      execa: () =>
        Promise.resolve({
          stdout: "tmux 3.4",
          stderr: "",
          exitCode: 0,
        }),
    }));
    vi.resetModules();
    const { assertTerminalModeSupported: fresh } = await import("../src/execution/tmux.js");
    await expect(fresh("tmux", "r1")).rejects.toThrow(/pane-backed reviewer execution/);
    vi.doUnmock("execa");
    vi.resetModules();
  });
});
