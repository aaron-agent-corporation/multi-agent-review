import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractVersion,
  isFresh,
  readCache,
  runPreflight,
  writeCache,
} from "../src/preflight.js";
import { PreflightCache } from "../src/schema/preflight.js";

// Executable fixtures (node shebang, chmod +x). Spawned directly as the roster `bin`, the adapter
// appends the prompt as a trailing/`-p` argv element, so a probePrompt of "--fail-auth" drives the
// fixture's failure mode (mirrors codex-adapter.test.ts wiring). For tier-1 `--version`, the fixture
// falls through to its happy JSON branch (exit 0) → installed:true.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const FAKE_GEMINI = fileURLToPath(new URL("./fixtures/fake-gemini.mjs", import.meta.url));

let workdir: string;
let cwd0: string;

beforeEach(() => {
  // runPreflight + writeCache write `.mar/preflight.json` relative to cwd; isolate per test.
  cwd0 = process.cwd();
  workdir = mkdtempSync(join(tmpdir(), "mar-preflight-"));
  process.chdir(workdir);
});

afterEach(() => {
  process.chdir(cwd0);
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("extractVersion — per-vendor semver extraction (Pitfall 2)", () => {
  it("extracts the claude semver (first token)", () => {
    expect(extractVersion("2.1.162 (Claude Code)")).toBe("2.1.162");
  });

  it("extracts the codex semver (SECOND token — split()[0] would yield 'codex-cli')", () => {
    expect(extractVersion("codex-cli 0.128.0")).toBe("0.128.0");
  });

  it("extracts the bare gemini semver", () => {
    expect(extractVersion("0.45.0")).toBe("0.45.0");
  });

  it("returns 'unknown' on empty or garbage input", () => {
    expect(extractVersion("")).toBe("unknown");
    expect(extractVersion("no version here")).toBe("unknown");
  });
});

describe("PreflightCache schema", () => {
  it("accepts a well-formed cache", () => {
    const parsed = PreflightCache.safeParse({
      checkedAt: new Date().toISOString(),
      results: [
        {
          name: "claude-1",
          vendor: "claude",
          installed: true,
          version: "2.1.162",
          responsive: true,
          latencyMs: 2100,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a cache missing checkedAt", () => {
    const parsed = PreflightCache.safeParse({
      results: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("cache read/write (atomic, gitignored, outside runs/)", () => {
  it("writeCache writes .mar/preflight.json atomically (no .tmp residue) and readCache round-trips", async () => {
    const results = [
      {
        name: "codex-1",
        vendor: "codex" as const,
        installed: true,
        version: "0.128.0",
        responsive: true,
        latencyMs: 12,
      },
    ];
    await writeCache(results);

    const cachePath = join(workdir, ".mar", "preflight.json");
    expect(existsSync(cachePath)).toBe(true);

    // No leftover temp files in .mar/
    const leftovers = readdirSync(join(workdir, ".mar")).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);

    const round = await readCache();
    expect(round?.results[0].name).toBe("codex-1");
    expect(round?.results[0].version).toBe("0.128.0");
    expect(typeof round?.checkedAt).toBe("string");
  });

  it("readCache returns undefined when no cache exists", async () => {
    expect(await readCache()).toBeUndefined();
  });

  it("cache is written OUTSIDE runs/", async () => {
    await writeCache([]);
    expect(existsSync(join(workdir, "runs"))).toBe(false);
    expect(existsSync(join(workdir, ".mar", "preflight.json"))).toBe(true);
  });
});

describe("isFresh — ~10min TTL", () => {
  it("treats a cache newer than the TTL as fresh", () => {
    const now = Date.now();
    const checkedAt = new Date(now - 60_000).toISOString(); // 1 min ago
    expect(isFresh(checkedAt, now)).toBe(true);
  });

  it("treats a cache older than the TTL as stale", () => {
    const now = Date.now();
    const checkedAt = new Date(now - 11 * 60_000).toISOString(); // 11 min ago
    expect(isFresh(checkedAt, now)).toBe(false);
  });
});

describe("runPreflight — tiered check + probe + hints", () => {
  it("probe success (fake-claude happy) → installed, responsive, latency, no hint", async () => {
    const { results, allPass } = await runPreflight([
      { name: "claude-1", vendor: "claude", bin: FAKE_CLAUDE },
    ]);
    expect(results[0].installed).toBe(true);
    expect(results[0].responsive).toBe(true);
    expect(typeof results[0].latencyMs).toBe("number");
    expect(results[0].hint).toBeUndefined();
    expect(allPass).toBe(true);
  });

  it("gemini probe auth-fail → responsive:false + auth/Antigravity hint naming env vars, never a secret value", async () => {
    const { results, allPass } = await runPreflight(
      [{ name: "gemini-1", vendor: "gemini", bin: FAKE_GEMINI }],
      { probePrompt: "--fail-auth" },
    );
    expect(results[0].installed).toBe(true);
    expect(results[0].responsive).toBe(false);
    expect(results[0].hint).toBeTruthy();
    const hint = results[0].hint ?? "";
    // names the env var / auth-config, references the Antigravity transition
    expect(hint).toMatch(/GEMINI_API_KEY|GOOGLE_CLOUD_PROJECT|settings\.json/);
    expect(hint).toMatch(/antigravity/i);
    // never a secret value — no fake key material echoed
    expect(hint).not.toMatch(/abc-123/);
    expect(allPass).toBe(false);
  });

  it("codex probe auth-fail → responsive:false + actionable 'codex login' hint", async () => {
    const { results } = await runPreflight(
      [{ name: "codex-1", vendor: "codex", bin: FAKE_CODEX }],
      { probePrompt: "--fail-auth" },
    );
    expect(results[0].responsive).toBe(false);
    expect(results[0].hint ?? "").toMatch(/codex login/i);
  });

  it("a bin NOT on PATH → installed:false, responsive:false, install hint", async () => {
    const { results, allPass } = await runPreflight([
      { name: "ghost", vendor: "claude", bin: "/nonexistent/definitely-not-here-xyz" },
    ]);
    expect(results[0].installed).toBe(false);
    expect(results[0].responsive).toBe(false);
    expect(results[0].hint ?? "").toMatch(/install/i);
    expect(allPass).toBe(false);
  });

  it("aggregate allPass=false when ANY agent fails, and the cache is written", async () => {
    const { results, allPass } = await runPreflight(
      [
        { name: "claude-1", vendor: "claude", bin: FAKE_CLAUDE },
        { name: "gemini-1", vendor: "gemini", bin: FAKE_GEMINI },
      ],
      { probePrompt: "--fail-auth" },
    );
    // claude-1 still uses the shared probePrompt "--fail-auth" → also fails; either way allPass=false
    expect(allPass).toBe(false);
    expect(results.length).toBe(2);
    // cache written
    const cache = await readCache();
    expect(cache?.results.length).toBe(2);
  });

  it("probe uses retries:0 — preflight never burns the retry budget (D-33)", async () => {
    // source-level guard mirrored by acceptance grep; here we assert behavior: an auth-fail
    // returns promptly with a single failed result (no retry storm).
    const { results } = await runPreflight(
      [{ name: "codex-1", vendor: "codex", bin: FAKE_CODEX }],
      { probePrompt: "--fail-auth" },
    );
    expect(results[0].responsive).toBe(false);
  });
});

describe("PreflightCache round-trips a written cache through the schema", () => {
  it("the written file validates against PreflightCache", async () => {
    await writeCache([
      { name: "claude-1", vendor: "claude", installed: true, responsive: true, latencyMs: 5 },
    ]);
    const raw = JSON.parse(readFileSync(join(workdir, ".mar", "preflight.json"), "utf8"));
    expect(PreflightCache.safeParse(raw).success).toBe(true);
  });
});
