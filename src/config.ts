import { existsSync } from "node:fs";
import fsExtra from "fs-extra";
import type { z } from "zod";
import { type AgentEntry, MarConfig } from "./schema/config.js";

const { readFile } = fsExtra;

/**
 * Load + validate the roster from disk (D-18). Mirrors readManifest (read -> JSON.parse ->
 * schema.parse) but with a CLEAR missing-file error (D-20) and actionable per-field validation
 * messages on a malformed roster.
 */
export async function loadConfig(path = "mar.config.json"): Promise<MarConfig> {
  if (!existsSync(path)) {
    throw new Error(`no roster: ${path} not found (run \`mar init\`)`);
  }
  const raw = await readFile(path, "utf8");
  const parsed = MarConfig.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`invalid roster ${path}:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * The SINGLE name-resolution path (D-20): `mar invoke --agent <name>` resolves against roster
 * entry NAMES only. On a miss, the error names every valid agent name so the caller can correct.
 */
export function resolveAgent(config: MarConfig, name: string): AgentEntry {
  const entry = config.agents.find((a) => a.name === name);
  if (!entry) {
    const valid = config.agents.map((a) => a.name).join(", ");
    throw new Error(`unknown agent: ${name} (valid: ${valid})`);
  }
  return entry;
}

/** Format zod issues as `path: message` lines (zod v4 `err.issues`). */
function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length > 0 ? i.path.join(".") : "(root)";
      return `  ${path}: ${i.message}`;
    })
    .join("\n");
}
