// End-to-end anchor: drives the `mar invoke` command against the fake-claude fixture and asserts
// the workspace side effects appear on disk — a normalized artifact, a manifest, and the
// invocations.ndjson log. Phase 1 wired this with a hardcoded claude path + MAR_CLAUDE_BIN; Plan
// 02-05 switched invoke to ROSTER-NAME resolution, so the test now supplies a mar.config.json
// whose claude entry injects the fake bin (D-19) — the env-var hardcode is gone.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterAll, beforeAll, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-e2e-"));
});

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

it("mar invoke produces a normalized artifact, manifest, and invocation log on disk", async () => {
  // Supply a roster whose claude entry injects the fake bin (D-19) — invoke resolves the adapter
  // by roster NAME, no MAR_CLAUDE_BIN env hardcode.
  writeFileSync(
    join(workdir, "mar.config.json"),
    `${JSON.stringify({ agents: [{ name: "claude", vendor: "claude", bin: `node ${fakeClaude}` }] }, null, 2)}\n`,
  );

  // Drive the CLI end-to-end through tsx, pointing the adapter at the fake fixture via the roster.
  const result = await execa(
    "npx",
    ["tsx", cliEntry, "invoke", "--agent", "claude", "--prompt", "ping"],
    {
      cwd: workdir,
      reject: false,
      env: { ...process.env },
    },
  );

  expect(result.exitCode).toBe(0);

  const runsDir = join(workdir, "runs");
  expect(existsSync(runsDir)).toBe(true);

  const runIds = readdirSync(runsDir);
  expect(runIds.length).toBe(1);
  const runDir = join(runsDir, runIds[0]);

  // manifest.json exists and indexes the run + the artifact.
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  expect(manifest.runId).toBeTruthy();
  expect(manifest.artifacts.length).toBe(1);

  // normalized artifact + sibling raw json.
  const artifactRel = manifest.artifacts[0].path;
  const artifactPath = join(runDir, artifactRel);
  expect(existsSync(artifactPath)).toBe(true);
  expect(readFileSync(artifactPath, "utf8")).toContain("pong");
  expect(existsSync(artifactPath.replace(/\.md$/, ".raw.json"))).toBe(true);

  // invocation log appended.
  expect(existsSync(join(runDir, "invocations.ndjson"))).toBe(true);
});
