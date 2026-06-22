import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import fsExtra from "fs-extra";
import { splitBin } from "./adapters/common.js";
import { makeAdapter } from "./adapters/registry.js";
import {
  type Classify,
  classifyClaude,
  classifyCodex,
  classifyGemini,
  classifyGrok,
  withRetry,
} from "./retry.js";
import type { AgentEntry } from "./schema/config.js";
import { PreflightCache, type PreflightResult } from "./schema/preflight.js";

const { ensureDir, pathExists, readFile, rename, writeFile } = fsExtra;

/** Cache directory + file (D-27): machine state, NOT run lineage — lives OUTSIDE runs/. */
const CACHE_DIR = ".mar";
const CACHE_FILE = "preflight.json";

/** ~10-minute TTL for the pre-flight cache (D-27). */
export const CACHE_TTL_MS = 600_000;

function cachePath(): string {
  return join(CACHE_DIR, CACHE_FILE);
}

/**
 * Per-vendor version extraction (Pitfall 2). The three `--version` formats differ:
 *   claude --version  -> "2.1.162 (Claude Code)"   (first token IS the semver)
 *   codex --version   -> "codex-cli 0.128.0"       (semver is the SECOND token)
 *   gemini --version  -> "0.45.0"                  (bare)
 * `split(/\s+/)[0]` is claude-ONLY and yields "codex-cli" for codex — WRONG. A semver regex match
 * is vendor-agnostic: it finds the `\d+\.\d+\.\d+` token wherever it sits. Returns "unknown" when no
 * semver is present (empty/garbage), so a missing version never masquerades as a real one.
 */
export function extractVersion(versionStdout: string): string {
  const m = versionStdout.match(/\d+\.\d+\.\d+/);
  return m ? m[0] : "unknown";
}

/**
 * Whether a cache `checkedAt` (ISO) is within the TTL window relative to `now`. A cache older than
 * `ttlMs` (~10 min) is stale and must be re-probed at run-start (Phase 3) — this bounds how long a
 * poisoned/stale cache could gate an unhealthy roster (T-02-14).
 */
export function isFresh(
  checkedAt: string,
  now: number = Date.now(),
  ttlMs = CACHE_TTL_MS,
): boolean {
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return false;
  return now - t < ttlMs;
}

/**
 * Persist the pre-flight results to `.mar/preflight.json` via temp-file-then-rename (D-16/D-27).
 * `rename(2)` is atomic on the same filesystem, so a crash mid-write leaves the prior complete cache,
 * never a corrupt/partial one (T-02-14). Validated by `PreflightCache.parse` before persisting — we
 * never write a cache that won't parse back. `checkedAt` is stamped at write time (drives the TTL).
 */
export async function writeCache(results: PreflightResult[]): Promise<void> {
  const cache: PreflightCache = {
    checkedAt: new Date().toISOString(),
    results,
  };
  const valid = PreflightCache.parse(cache);
  await ensureDir(CACHE_DIR);
  const finalPath = cachePath();
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  await rename(tmpPath, finalPath);
}

/**
 * Load + validate the cache from disk, or `undefined` when absent. Validation on read is a tampering
 * mitigation (T-02-14): a hand-edited/corrupt cache fails `PreflightCache.parse` and is treated as a
 * miss, forcing a fresh probe rather than trusting poisoned state.
 */
export async function readCache(): Promise<PreflightCache | undefined> {
  const p = cachePath();
  if (!(await pathExists(p))) return undefined;
  const raw = await readFile(p, "utf8");
  const parsed = PreflightCache.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : undefined;
}

/** Options for {@link runPreflight}. */
export interface RunPreflightOptions {
  /** Probe wall-clock timeout (default ~30s — codex retries auth 5x internally, Pitfall 5). */
  probeTimeoutMs?: number;
  /** Probe prompt (default "Reply with exactly: pong"). Tests inject fixture mode flags here. */
  probePrompt?: string;
}

/** Default probe prompt + timeout (D-33). */
const DEFAULT_PROBE_PROMPT = "Reply with exactly: pong";
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

/** Per-vendor classifier for the probe's single attempt (retries:0 means it never actually retries). */
const CLASSIFY: Record<AgentEntry["vendor"], Classify> = {
  claude: classifyClaude,
  codex: classifyCodex,
  gemini: classifyGemini,
  grok: classifyGrok,
};

/**
 * FIXED, actionable failure hints keyed off the failure CLASS, never raw stderr (T-02-15). Env vars
 * are NAMED, never their values. The gemini hint surfaces the auth/Antigravity-transition guidance
 * (D-31): point at the settings.json auth method / GEMINI_API_KEY / GOOGLE_CLOUD_PROJECT and the
 * June 18 2026 Antigravity CLI cutoff — gemini correctly reporting ✗ here is expected (D-32).
 */
function hintFor(vendor: AgentEntry["vendor"], stage: "install" | "probe"): string {
  if (stage === "install") {
    return `binary not found on PATH — install the ${vendor} CLI (or set \`bin\` in mar.config.json) and re-run preflight`;
  }
  switch (vendor) {
    case "gemini":
      return "gemini probe failed (auth/responsiveness): set an Auth method in ~/.gemini/settings.json, or export GEMINI_API_KEY / GOOGLE_CLOUD_PROJECT. NOTE: the free Gemini CLI tier ends 2026-06-18 (transition to Antigravity CLI) — a paid tier or API key may be required";
    case "codex":
      return "codex probe failed (auth/responsiveness): run: codex login";
    case "claude":
      return "claude probe failed (auth/responsiveness): run: claude /login";
    case "grok":
      return "grok probe failed (auth/responsiveness): run: grok login, or export XAI_API_KEY / GROK_API_KEY";
  }
}

/**
 * The ONE `<bin> --version` probe shared by both the preflight install-check and the invoke-path
 * version capture (WR-05). Previously `checkInstalled` (here) and `detectVersion` (cli.ts) ran two
 * separate probes with DIFFERENT success rules — `checkInstalled` required `exitCode === 0` while
 * `detectVersion` keyed off non-empty stdout — so a CLI that prints its version but exits non-zero
 * was recorded `installed:true` by `invoke` yet `installed:false` by preflight (contradictory
 * machine state). This single helper applies ONE rule for both sites.
 *
 * Single agreed rule: a binary is INSTALLED iff the spawn succeeds (no ENOENT) AND its `--version`
 * produced NON-EMPTY stdout. The EXIT CODE is deliberately NOT part of the rule — some tools print
 * `--version` and exit non-zero — so the two call sites can never disagree again. `version` is the
 * extracted semver ("unknown" when the stdout has no `\d+.\d+.\d+` token).
 */
export async function probeVersion(bin: string): Promise<{ installed: boolean; version: string }> {
  try {
    const { cmd, preArgs } = splitBin(bin);
    const r = await execa(cmd, [...preArgs, "--version"], { reject: false, timeout: 10_000 });
    const out = (r.stdout ?? "").trim();
    // Installed iff the bin actually responded with output (not a bare spawn-then-empty line).
    return { installed: out.length > 0, version: out.length > 0 ? extractVersion(out) : "unknown" };
  } catch {
    // ENOENT / spawn failure → not on PATH.
    return { installed: false, version: "unknown" };
  }
}

/** Tier-1: is the binary on PATH and does `--version` parse? Delegates to the shared probe (WR-05). */
async function checkInstalled(bin: string): Promise<{ installed: boolean; version?: string }> {
  const { installed, version } = await probeVersion(bin);
  return installed ? { installed: true, version } : { installed: false };
}

/**
 * Tiered pre-flight (ORCH-05 / D-26). For each roster agent:
 *   tier-1 — `--version` on the (injectable) bin → installed + extractVersion (Pitfall-2-safe);
 *   tier-2 — if installed, a SINGLE tiny live probe via the SAME adapter the run uses
 *            (`makeAdapter` + `withRetry(retries:0)`), proving auth + responsiveness in one shot.
 * The probe is a single "pong" invocation with `retries:0` (never burns the retry budget — D-33),
 * `read-only` adapter argv (no write perms — T-02-16), and a ~30s timeout (codex retries auth 5x
 * internally — Pitfall 5). On any failure a vendor-appropriate FIXED hint is attached (D-28/D-31).
 * Results are written to the gitignored cache (D-27) and `allPass` reports the all-pass/any-fail
 * signal Plan 05 maps to a process exit (0 = all pass, 1 = any fail / D-28).
 */
export async function runPreflight(
  roster: AgentEntry[],
  opts?: RunPreflightOptions,
): Promise<{ results: PreflightResult[]; allPass: boolean }> {
  const probePrompt = opts?.probePrompt ?? DEFAULT_PROBE_PROMPT;
  const probeTimeoutMs = opts?.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const probeDir = tmpdir(); // probe writes nothing persistent; never inside runs/

  const results: PreflightResult[] = [];

  for (const agent of roster) {
    const bin = agent.bin ?? agent.vendor; // production default = bare vendor name
    const { installed, version } = await checkInstalled(bin);

    if (!installed) {
      results.push({
        name: agent.name,
        vendor: agent.vendor,
        installed: false,
        responsive: false,
        hint: hintFor(agent.vendor, "install"),
      });
      continue;
    }

    // tier-2 probe: compose the SAME adapter the run uses (never re-implement the CLI call).
    const adapter = makeAdapter(agent.vendor, agent.bin, agent.model);
    const probe = await withRetry(
      () =>
        adapter.invoke({
          agent: agent.name,
          promptText: probePrompt,
          runDir: probeDir,
          seq: 0,
          timeoutMs: probeTimeoutMs,
        }),
      { retries: 0, classify: CLASSIFY[agent.vendor], onAttempt: () => {} },
    );

    results.push({
      name: agent.name,
      vendor: agent.vendor,
      installed: true,
      version,
      responsive: probe.ok,
      latencyMs: probe.durationMs,
      hint: probe.ok ? undefined : hintFor(agent.vendor, "probe"),
    });
  }

  await writeCache(results);
  const allPass = results.every((r) => r.installed && r.responsive);
  return { results, allPass };
}

/**
 * Render the approved per-agent status table (D-28): one line per agent with installed ✓/✗ +version
 * and probe ✓/✗ +latency, a hint line under any failure, and a trailing summary line. Example:
 *   `claude-1  claude 2.1.162  ✓ installed  ✓ responsive (2.1s)`
 */
export function formatStatusLines(results: PreflightResult[]): string[] {
  const lines: string[] = [];
  for (const r of results) {
    const ver = r.version ? ` ${r.version}` : "";
    const inst = r.installed ? "✓ installed" : "✗ installed";
    const resp = r.responsive
      ? `✓ responsive (${((r.latencyMs ?? 0) / 1000).toFixed(1)}s)`
      : "✗ responsive";
    lines.push(`${r.name}  ${r.vendor}${ver}  ${inst}  ${resp}`);
    if (r.hint) lines.push(`  → ${r.hint}`);
  }
  const passed = results.filter((r) => r.installed && r.responsive).length;
  lines.push(`${passed}/${results.length} agents ready`);
  return lines;
}
