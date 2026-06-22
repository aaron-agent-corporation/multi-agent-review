// Roster-resolved CLI: `mar invoke --agent <name>` resolves by roster NAME (not a hardcoded
// vendor), wraps the adapter in withRetry, and logs EVERY attempt; plus the `mar init` and
// `mar preflight` subcommands. Driven end-to-end through tsx against the fake fixtures so the
// suite burns ZERO real credits (D-19 injects the fixture via the roster `bin` field).

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test spawns a COLD `npx tsx` (compile + run ~5s); under concurrent load several share the
// CPU. A generous per-test timeout absorbs the cold-start cost so the suite is not flaky. The
// fixtures themselves resolve in ~0.1s — this is harness startup, not a hang.
vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const cliEntry = join(repoRoot, "src", "cli.ts");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-cli-roster-"));
});

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

/** Write a mar.config.json into workdir; returns its path. */
function writeRoster(agents: unknown[], defaults?: unknown): string {
  const cfg = defaults ? { agents, defaults } : { agents };
  const p = join(workdir, "mar.config.json");
  writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
  return p;
}

/** Run the CLI through tsx in workdir; never reject so we can assert exit codes. */
function runCli(args: string[], env: Record<string, string> = {}) {
  const npmCache = join(workdir, ".npm-cache");
  return execa("npx", ["tsx", cliEntry, ...args], {
    cwd: workdir,
    reject: false,
    env: { ...process.env, NPM_CONFIG_CACHE: npmCache, npm_config_cache: npmCache, ...env },
  });
}

/** Read every NDJSON record from a run's invocations.ndjson. */
function readInvocations(runDir: string): Array<Record<string, unknown>> {
  const raw = readFileSync(join(runDir, "invocations.ndjson"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** The single run dir created under workdir/runs. */
function soleRunDir(): string {
  const runs = join(workdir, "runs");
  const ids = readdirSync(runs);
  expect(ids.length).toBe(1);
  return join(runs, ids[0]);
}

describe.sequential("mar invoke — roster-name resolution (no hardcoded vendor, D-20)", () => {
  it("resolves codex-1 to the codex adapter via roster bin and writes a completed artifact", async () => {
    writeRoster([{ name: "codex-1", vendor: "codex", bin: `node ${fakeCodex}` }]);
    const r = await runCli(["invoke", "--agent", "codex-1", "--prompt", "ping"]);
    expect(r.exitCode).toBe(0);

    const runDir = soleRunDir();
    const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
    expect(manifest.status).toBe("completed");
    expect(manifest.artifacts.length).toBe(1);
    // The codex adapter (not claude) produced the artifact → filename carries the codex agent name.
    expect(manifest.artifacts[0].agent).toBe("codex-1");
    const artifactRel = manifest.artifacts[0].path;
    expect(readFileSync(join(runDir, artifactRel), "utf8")).toContain("pong");
    // cliVersions captured the codex SEMVER, never the "codex-cli" token (Pitfall 2).
    expect(manifest.cliVersions.codex).not.toBe("codex-cli");
  });

  it("an unknown --agent name errors with the valid names and exits 2", async () => {
    writeRoster([{ name: "codex-1", vendor: "codex", bin: `node ${fakeCodex}` }]);
    const r = await runCli(["invoke", "--agent", "nope", "--prompt", "ping"]);
    expect(r.exitCode).toBe(2);
    expect(`${r.stderr}`).toMatch(/codex-1/);
    expect(`${r.stderr}`).toMatch(/nope/);
  });

  it("a missing mar.config.json errors pointing at `mar init` and exits 2", async () => {
    const r = await runCli(["invoke", "--agent", "codex-1", "--prompt", "ping"]);
    expect(r.exitCode).toBe(2);
    expect(`${r.stderr}`).toMatch(/mar init/);
  });

  it("invoke is EXEMPT from the >=2-vendor gate — a single-vendor roster still invokes (D-29)", async () => {
    writeRoster([{ name: "codex-1", vendor: "codex", bin: `node ${fakeCodex}` }]);
    const r = await runCli(["invoke", "--agent", "codex-1", "--prompt", "ping"]);
    // A single-vendor roster is legitimate for invoke → exit 0, never a >=2-vendor gate error.
    expect(r.exitCode).toBe(0);
    expect(`${r.stderr}`).not.toMatch(/2 distinct vendors|>=2/);
  });

  it("does NOT auto-preflight — no .mar/preflight.json is written by invoke (D-27)", async () => {
    writeRoster([{ name: "codex-1", vendor: "codex", bin: `node ${fakeCodex}` }]);
    const r = await runCli(["invoke", "--agent", "codex-1", "--prompt", "ping"]);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(workdir, ".mar", "preflight.json"))).toBe(false);
  });

  it("does not log the prompt body — the spawned command carries only a placeholder (D-15)", async () => {
    writeRoster([{ name: "codex-1", vendor: "codex", bin: `node ${fakeCodex}` }]);
    // A >32-char literal so the promptRef label truncates (never the full body), proving the
    // body appears nowhere in the audit record — neither in the command argv nor the promptRef.
    const body = "super-secret-prompt-body-that-is-long-enough-to-truncate";
    await runCli(["invoke", "--agent", "codex-1", "--prompt", body]);
    const records = readInvocations(soleRunDir());
    const blob = JSON.stringify(records);
    expect(blob).not.toContain(body);
    // command argv carries the <prompt> placeholder, never the body.
    expect((records[0].command as string[]).join(" ")).toContain("<prompt>");
    expect(records[0].promptRef).toBeTruthy();
  });
});

describe.sequential("mar invoke — withRetry wraps the adapter; every attempt logged (D-24/D-25)", () => {
  it("a transient-then-ok codex invoke is RETRIED and logs attempt 1 AND attempt 2", async () => {
    writeRoster(
      [{ name: "codex-1", vendor: "codex", bin: `node ${fakeCodex}` }],
      // near-zero backoff so the retry is fast; retries:2 gives budget for one retry.
      { timeoutMs: 600000, retries: 2 },
    );
    const stateDir = join(workdir, "fixture-state");
    // Drive the stateful fixture mode by passing its flag as the prompt (trailing positional).
    const r = await runCli(["invoke", "--agent", "codex-1", "--prompt", "--rate-limit-once"], {
      MAR_FIXTURE_STATE_DIR: stateDir,
      // near-zero backoff: the CLI honors these in test to keep the retry instant.
      MAR_RETRY_BASE_MS: "0",
      MAR_RETRY_MAX_MS: "0",
    });
    expect(r.exitCode).toBe(0);

    const runDir = soleRunDir();
    const records = readInvocations(runDir);
    // BOTH attempts logged: the failed attempt 1 and the successful attempt 2 (D-25).
    expect(records.length).toBe(2);
    expect(records.map((x) => x.attempt)).toEqual([1, 2]);
    // Final outcome is completed.
    const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
    expect(manifest.status).toBe("completed");
  });
});

describe.sequential("mar init — writes a starter roster from PATH detection (D-21)", () => {
  it("writes a mar.config.json that re-parses through MarConfig", async () => {
    // Inject a stub bin dir for claude+codex, PREPENDED to the real PATH (tsx/node still resolve).
    // Detection is a superset {claude, codex, ...possibly real gemini}; assert the stubs are
    // detected + the file is schema-shaped, credit-free (the stubs never run a real model).
    const binDir = join(workdir, "bin");
    const { mkdirSync, chmodSync } = await import("node:fs");
    mkdirSync(binDir, { recursive: true });
    for (const name of ["claude", "codex"]) {
      const p = join(binDir, name);
      writeFileSync(p, "#!/bin/sh\necho fake\n");
      chmodSync(p, 0o755);
    }
    const r = await runCli(["init"], { PATH: `${binDir}:${process.env.PATH}` });
    expect(r.exitCode).toBe(0);

    const cfgPath = join(workdir, "mar.config.json");
    expect(existsSync(cfgPath)).toBe(true);
    const raw = readFileSync(cfgPath, "utf8");
    const cfg = JSON.parse(raw);
    const vendors = cfg.agents.map((a: { vendor: string }) => a.vendor);
    // claude + codex are guaranteed detected (the stubs shadow them); deterministic ORDER.
    expect(vendors).toContain("claude");
    expect(vendors).toContain("codex");
    expect(cfg.defaults.retries).toBe(2);
    // one-line summary mentions the detected vendors
    expect(`${r.stdout}`).toMatch(/claude/);
    expect(`${r.stdout}`).toMatch(/codex/);
  });
});

describe.sequential("mar preflight — status table + exit code (D-28)", () => {
  it("all-pass roster prints status lines and exits 0; writes the cache", async () => {
    writeRoster([{ name: "claude-1", vendor: "claude", bin: `node ${fakeClaude}` }]);
    const r = await runCli(["preflight"]);
    expect(r.exitCode).toBe(0);
    expect(`${r.stdout}`).toMatch(/claude-1/);
    expect(`${r.stdout}`).toMatch(/responsive/);
    expect(existsSync(join(workdir, ".mar", "preflight.json"))).toBe(true);
  });

  it("loads an explicit --config path instead of requiring mar.config.json in cwd", async () => {
    const cfgPath = join(workdir, "external-mar.config.json");
    writeFileSync(
      cfgPath,
      `${JSON.stringify({ agents: [{ name: "claude-1", vendor: "claude", bin: `node ${fakeClaude}` }] }, null, 2)}\n`,
    );
    const r = await runCli(["preflight", "--config", cfgPath]);
    expect(r.exitCode).toBe(0);
    expect(`${r.stdout}`).toMatch(/claude-1/);
    expect(`${r.stderr}`).not.toMatch(/no roster|unknown option/);
    expect(existsSync(join(workdir, "mar.config.json"))).toBe(false);
  });

  it("any-fail roster (gemini auth-fail) exits 1 and surfaces a hint", async () => {
    writeRoster([
      { name: "claude-1", vendor: "claude", bin: `node ${fakeClaude}` },
      // gemini fixture in auth-fail mode → responsive:false. We drive its mode via extraArgs is
      // not wired into argv; instead point bin at a wrapper that always auth-fails. Simplest:
      // use the gemini fixture whose default is happy, but force failure with a bad bin.
      { name: "ghost", vendor: "gemini", bin: "/nonexistent/definitely-not-here-xyz" },
    ]);
    const r = await runCli(["preflight"]);
    expect(r.exitCode).toBe(1);
    expect(`${r.stdout}`).toMatch(/install|responsive/);
  });
});

describe.sequential("mar pr review — explicit config path", () => {
  it("loads --config before fetching PR context, so target repos do not need mar.config.json", async () => {
    const cfgPath = join(workdir, "external-mar.config.json");
    writeFileSync(
      cfgPath,
      `${JSON.stringify(
        {
          agents: [
            { name: "claude-1", vendor: "claude", bin: `node ${fakeClaude}` },
            { name: "codex-1", vendor: "codex", bin: `node ${fakeCodex}` },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const r = await runCli(["pr", "review", "not-a-real-pr", "--config", cfgPath, "--autonomous"]);
    expect(r.exitCode).toBe(1);
    expect(`${r.stderr}`).not.toMatch(/no roster|unknown option/);
    expect(existsSync(join(workdir, "mar.config.json"))).toBe(false);
  });
});
