import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, resolveAgent } from "../src/config.js";
import { MarConfig } from "../src/schema/config.js";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "mar-config-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const TWO_AGENTS = {
  agents: [
    { name: "claude-1", vendor: "claude" },
    { name: "codex-1", vendor: "codex" },
  ],
};

describe("MarConfig schema (discriminated union + defaults)", () => {
  it("parses a valid 2-agent roster and applies defaults (retries=2, timeoutMs=600000)", () => {
    const cfg = MarConfig.parse(TWO_AGENTS);
    expect(cfg.agents).toHaveLength(2);
    expect(cfg.defaults.retries).toBe(2);
    expect(cfg.defaults.timeoutMs).toBe(600_000);
  });

  it("rejects an unknown vendor with a clear discriminated-union error", () => {
    const r = MarConfig.safeParse({ agents: [{ name: "g1", vendor: "grok" }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join(" ");
      expect(msg.toLowerCase()).toContain("discriminator");
    }
  });

  it("rejects duplicate agent names via superRefine, naming the dup", () => {
    const r = MarConfig.safeParse({
      agents: [
        { name: "claude-1", vendor: "claude" },
        { name: "claude-1", vendor: "codex" },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.map((i) => i.message).join(" ");
      expect(msg).toContain("duplicate agent name");
      expect(msg).toContain("claude-1");
    }
  });

  it("LOADS a single-vendor config (gate is run-start, not config-load — D-29 exemption)", () => {
    const cfg = MarConfig.parse({ agents: [{ name: "claude-1", vendor: "claude" }] });
    expect(cfg.agents).toHaveLength(1);
    expect(cfg.agents[0].vendor).toBe("claude");
  });

  it("types per-vendor optional fields (bin, model, timeoutMs, extraArgs[])", () => {
    const cfg = MarConfig.parse({
      agents: [
        {
          name: "codex-1",
          vendor: "codex",
          bin: "/usr/bin/codex",
          model: "gpt-5.5",
          timeoutMs: 30_000,
          extraArgs: ["--foo", "bar"],
        },
      ],
    });
    const a = cfg.agents[0];
    expect(a.bin).toBe("/usr/bin/codex");
    expect(a.model).toBe("gpt-5.5");
    expect(a.timeoutMs).toBe(30_000);
    expect(a.extraArgs).toEqual(["--foo", "bar"]);
  });

  it("rejects an empty agents array (min 1)", () => {
    expect(MarConfig.safeParse({ agents: [] }).success).toBe(false);
  });
});

describe("loadConfig + resolveAgent (single name-resolution path, D-20)", () => {
  it("loadConfig reads + validates a roster file", async () => {
    const p = join(work, "mar.config.json");
    writeFileSync(p, JSON.stringify(TWO_AGENTS));
    const cfg = await loadConfig(p);
    expect(cfg.agents.map((a) => a.name)).toEqual(["claude-1", "codex-1"]);
    expect(cfg.defaults.retries).toBe(2);
  });

  it("loadConfig on a missing file throws a clear missing-roster error mentioning the path and `mar init`", async () => {
    const p = join(work, "nope.config.json");
    await expect(loadConfig(p)).rejects.toThrow(/no roster/);
    await expect(loadConfig(p)).rejects.toThrow(p);
    await expect(loadConfig(p)).rejects.toThrow(/mar init/);
  });

  it("resolveAgent returns the matching entry by name", () => {
    const cfg = MarConfig.parse(TWO_AGENTS);
    const a = resolveAgent(cfg, "codex-1");
    expect(a.vendor).toBe("codex");
    expect(a.name).toBe("codex-1");
  });

  it("resolveAgent on an unknown name throws listing the valid names", () => {
    const cfg = MarConfig.parse(TWO_AGENTS);
    expect(() => resolveAgent(cfg, "nope")).toThrow(/nope/);
    expect(() => resolveAgent(cfg, "nope")).toThrow(/claude-1/);
    expect(() => resolveAgent(cfg, "nope")).toThrow(/codex-1/);
  });
});
