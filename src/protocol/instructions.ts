import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The vendors whose native instruction file we seed. Mirrors the canonical preflight enum. */
export type Vendor = "claude" | "codex" | "gemini";

/**
 * Each vendor reads a different native instruction filename from its working directory
 * (D-37). We render ONE source-of-truth template into the right filename per vendor so
 * the format contract never diverges by vendor — only the filename does.
 */
export const VENDOR_FILE: Record<Vendor, string> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
};

// Resolve the template RELATIVE TO THIS MODULE, never relative to the process cwd: a run
// executes from `runs/<id>/work/<agent>/` (or wherever the orchestrator is launched), so a
// cwd-relative path would not find the template. import.meta.url is stable regardless of cwd.
const TEMPLATE_URL = new URL("../templates/agent-instructions.md.tmpl", import.meta.url);

/**
 * Seed `workdir` with the agent's vendor-native instruction file (D-36/D-37). The template is
 * the SINGLE source of truth for the format contract; it is rendered VERBATIM (identity render,
 * no per-vendor substitution) into `VENDOR_FILE[vendor]` inside `workdir`. After this call the
 * scoped working folder carries, e.g., `CLAUDE.md` for a claude agent, `AGENTS.md` for codex,
 * `GEMINI.md` for gemini — byte-identical content, vendor-specific filename only.
 *
 * Ancestor-inheritance note (Pitfall 1 / T-04-03, decision reaffirmed RESEARCH Q6b): all three
 * CLIs walk from the git project root down to cwd discovering instruction files. This repo's root
 * holds a `CLAUDE.md` (GSD workflow directives) and NO `AGENTS.md`/`GEMINI.md`. The seeded file is
 * the NEAREST instruction file in every agent's scoped cwd, so codex/gemini see only the seeded
 * contract (no ancestor AGENTS.md/GEMINI.md exists to merge in). Neutralization is achieved by TWO
 * mechanisms, NOT by claude `--bare`: (1) the seeded vendor file is the nearest instruction file in
 * the scoped cwd, and (2) the template carries an explicit "read THIS folder's contract as the sole
 * format contract; ignore any ancestor or global instructions" directive. claude `--bare` is
 * deliberately OMITTED on the live adapter (claude.ts) — it reads ONLY `ANTHROPIC_API_KEY` and
 * breaks subscription/OAuth auth; live run 20260605-MlhRzU measured ZERO GSD-language leakage
 * without it. Per-vendor config scoping that DOES apply where relevant: codex
 * `--ignore-user-config`; gemini config-trust scoping (folder-trust off / `--include-directories`
 * limited to the scoped cwd). The hermetic spike test (test/instructions.test.ts) proves the seeded
 * file is the effective nearest contract.
 */
export async function seedInstructions(workdir: string, vendor: Vendor): Promise<void> {
  const template = await readFile(fileURLToPath(TEMPLATE_URL), "utf8");
  await writeFile(join(workdir, VENDOR_FILE[vendor]), template, "utf8");
}
