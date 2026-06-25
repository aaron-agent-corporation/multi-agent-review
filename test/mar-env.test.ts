import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureMarEnv,
  loadMarEnv,
  marEnvPaths,
  parseMarEnv,
  redactedEnvReport,
} from "../src/env/mar-env.js";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-env-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("MAR.env parsing", () => {
  it("parses comments, export prefixes, blanks, and quoted values", () => {
    expect(
      parseMarEnv(`
# comment
ANTHROPIC_API_KEY=abc123
export GEMINI_API_KEY="gemini key"
GROK_API_KEY='grok key'
EMPTY=
`),
    ).toEqual({
      ANTHROPIC_API_KEY: "abc123",
      GEMINI_API_KEY: "gemini key",
      GROK_API_KEY: "grok key",
      EMPTY: "",
    });
  });

  it("rejects malformed lines and invalid names", () => {
    expect(() => parseMarEnv("NO_EQUALS")).toThrow(/line 1/);
    expect(() => parseMarEnv("1BAD=value")).toThrow(/invalid variable name/);
  });

  it("reports only key names, never values", () => {
    const report = redactedEnvReport({ ANTHROPIC_API_KEY: "secret-value" });
    expect(report).toEqual(["ANTHROPIC_API_KEY=<redacted>"]);
    expect(report.join("\n")).not.toContain("secret-value");
  });
});

describe("ensureMarEnv", () => {
  it("creates MAR.env, example file, and gitignore entry", async () => {
    const result = await ensureMarEnv(workdir);
    expect(existsSync(result.envPath)).toBe(true);
    expect(existsSync(result.examplePath)).toBe(true);
    expect(readFileSync(result.gitignorePath, "utf8")).toContain(".mar/MAR.env");
    expect(statSync(result.envPath).mode & 0o777).toBe(0o600);
  });

  it("loads the created env file and does not duplicate gitignore entries", async () => {
    const paths = marEnvPaths(workdir);
    await ensureMarEnv(workdir);
    writeFileSync(paths.envPath, "ANTHROPIC_API_KEY=\nXAI_API_KEY=secret\n", "utf8");
    await ensureMarEnv(workdir);
    const gitignore = readFileSync(paths.gitignorePath, "utf8");
    expect(gitignore.match(/\.mar\/MAR\.env/g)?.length).toBe(1);
    expect(await loadMarEnv(workdir)).toEqual({ XAI_API_KEY: "secret" });
  });
});
