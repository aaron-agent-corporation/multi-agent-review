import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectVendors, writeStarterConfig } from "../src/init.js";
import { MarConfig } from "../src/schema/config.js";

let work: string;
let binDir: string;
const realPath = process.env.PATH;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "mar-init-"));
  binDir = join(work, "bin");
  // fresh empty bin dir per test; created lazily by stub()
});

afterEach(() => {
  process.env.PATH = realPath;
  vi.restoreAllMocks();
  rmSync(work, { recursive: true, force: true });
});

/** Drop a fake executable named `name` into an injected PATH dir (no real binary spawned). */
function stub(name: string): void {
  mkdirSync(binDir, { recursive: true });
  const p = join(binDir, name);
  writeFileSync(p, "#!/bin/sh\necho fake\n");
  chmodSync(p, 0o755);
}

describe("detectVendors (PATH walk, no shell)", () => {
  it("returns only the vendors whose binary is on the injected PATH", () => {
    stub("codex");
    stub("gemini");
    stub("grok");
    process.env.PATH = binDir; // ONLY our temp dir — real claude/codex/gemini invisible
    const vendors = detectVendors();
    expect(vendors).toEqual(["codex", "gemini", "grok"]);
    expect(vendors).not.toContain("claude");
  });

  it("returns an empty list when PATH holds none of the supported vendors", () => {
    process.env.PATH = join(work, "empty"); // nonexistent dir
    expect(detectVendors()).toEqual([]);
  });
});

describe("writeStarterConfig (atomic, MarConfig-valid)", () => {
  it("writes one agent per vendor with deterministic names + defaults, re-parsing through MarConfig", async () => {
    const p = join(work, "mar.config.json");
    await writeStarterConfig(p, ["claude", "codex", "gemini", "grok"]);
    const raw = readFileSync(p, "utf8");
    const cfg = MarConfig.parse(JSON.parse(raw));
    expect(cfg.agents.map((x) => x.name)).toEqual(["claude-1", "codex-1", "gemini-1", "grok-1"]);
    expect(cfg.agents.map((x) => x.vendor)).toEqual(["claude", "codex", "gemini", "grok"]);
    expect(cfg.defaults.timeoutMs).toBe(600_000);
    expect(cfg.defaults.retries).toBe(2);
  });

  it("formats JSON as `JSON.stringify(x,null,2)+\\n` and leaves no temp file (atomic)", async () => {
    const p = join(work, "mar.config.json");
    await writeStarterConfig(p, ["claude", "codex"]);
    const raw = readFileSync(p, "utf8");
    const obj = JSON.parse(raw);
    expect(raw).toBe(`${JSON.stringify(obj, null, 2)}\n`);
    const leftover = readdirSync(work).filter((f) => f.includes(".tmp"));
    expect(leftover).toEqual([]);
  });
});
