import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type EnvMap = Record<string, string>;

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_EXAMPLE = [
  "# Repo-local MAR environment.",
  "# Values in MAR.env are local secrets and must not be committed.",
  "ANTHROPIC_API_KEY=",
  "GEMINI_API_KEY=",
  "GOOGLE_CLOUD_PROJECT=",
  "XAI_API_KEY=",
  "GROK_API_KEY=",
  "MAR_CODEX_HOME=",
  "MAR_GROK_HOME=",
  "MAR_CLAUDE_CONFIG_DIR=",
  "MAR_GEMINI_CONFIG_DIR=",
  "",
].join("\n");

export interface MarEnvPaths {
  marDir: string;
  envPath: string;
  examplePath: string;
  gitignorePath: string;
}

export interface EnsureMarEnvResult extends MarEnvPaths {
  createdEnv: boolean;
  createdExample: boolean;
  updatedGitignore: boolean;
}

export function marEnvPaths(repoRoot = process.cwd()): MarEnvPaths {
  const root = resolve(repoRoot);
  const marDir = join(root, ".mar");
  return {
    marDir,
    envPath: join(marDir, "MAR.env"),
    examplePath: join(marDir, "MAR.env.example"),
    gitignorePath: join(root, ".gitignore"),
  };
}

function stripOptionalQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseMarEnv(text: string): EnvMap {
  const out: EnvMap = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const line = original.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) {
      throw new Error(`invalid MAR.env line ${i + 1}: expected KEY=value`);
    }
    const key = body.slice(0, eq).trim();
    if (!ENV_NAME_RE.test(key)) {
      throw new Error(`invalid MAR.env line ${i + 1}: invalid variable name "${key}"`);
    }
    out[key] = stripOptionalQuotes(body.slice(eq + 1).trim());
  }
  return out;
}

export async function loadMarEnv(repoRoot = process.cwd()): Promise<EnvMap> {
  const { envPath } = marEnvPaths(repoRoot);
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    Object.entries(parseMarEnv(await readFile(envPath, "utf8"))).filter(
      ([, value]) => value.length > 0,
    ),
  );
}

export function mergeEnv(base: NodeJS.ProcessEnv, overlay: EnvMap): NodeJS.ProcessEnv {
  return { ...base, ...overlay };
}

export function redactedEnvReport(env: EnvMap): string[] {
  return Object.keys(env)
    .sort()
    .map((key) => `${key}=<redacted>`);
}

async function appendGitignoreEntry(path: string, entry: string): Promise<boolean> {
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(entry)) return false;
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${existing}${prefix}${entry}\n`, "utf8");
  return true;
}

export async function ensureMarEnv(repoRoot = process.cwd()): Promise<EnsureMarEnvResult> {
  const paths = marEnvPaths(repoRoot);
  await mkdir(paths.marDir, { recursive: true });

  const createdExample = !existsSync(paths.examplePath);
  if (createdExample) {
    await writeFile(paths.examplePath, DEFAULT_EXAMPLE, "utf8");
  }

  const createdEnv = !existsSync(paths.envPath);
  if (createdEnv) {
    await writeFile(paths.envPath, DEFAULT_EXAMPLE, { encoding: "utf8", mode: 0o600 });
  }
  await chmod(paths.envPath, 0o600);

  const updatedGitignore = await appendGitignoreEntry(paths.gitignorePath, ".mar/MAR.env");
  return { ...paths, createdEnv, createdExample, updatedGitignore };
}
