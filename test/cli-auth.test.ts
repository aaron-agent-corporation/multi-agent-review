import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildProgram } from "../src/cli.js";

vi.setConfig({ testTimeout: 30_000 });

let workdir: string;
const originalCwd = process.cwd();

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-cli-auth-"));
  process.chdir(workdir);
  process.exitCode = undefined;
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  rmSync(workdir, { recursive: true, force: true });
});

it("mar auth init creates repo-local env files without printing secret values", async () => {
  let stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });

  await buildProgram().parseAsync(["node", "mar", "auth", "init"], { from: "node" });

  expect(process.exitCode).toBe(0);
  const envPath = join(workdir, ".mar", "MAR.env");
  expect(existsSync(envPath)).toBe(true);
  expect(existsSync(join(workdir, ".mar", "MAR.env.example"))).toBe(true);
  expect(readFileSync(join(workdir, ".gitignore"), "utf8")).toContain(".mar/MAR.env");
  expect(statSync(envPath).mode & 0o777).toBe(0o600);
  expect(stdout).not.toContain("ANTHROPIC_API_KEY=<redacted>");
  expect(stdout).not.toContain("secret");
});
