// RED until Plan 03 wires the CLI.
//
// This is the MVP skeleton anchor: an end-to-end test that drives the (not-yet-built)
// `mar invoke` command against the fake-claude fixture and asserts the workspace
// side effects appear on disk — a normalized artifact, a manifest, and the
// invocations.ndjson log. It MUST FAIL now because src/cli.ts does not exist yet.
// Plan 03 turns it green by wiring the CLI to the workspace + adapter built in
// Plans 01 and 02.

import { execa } from "execa";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  // Drive the CLI end-to-end through tsx, pointing the adapter at the fake fixture.
  const result = await execa(
    "npx",
    [
      "tsx",
      cliEntry,
      "invoke",
      "--agent",
      "claude",
      "--prompt",
      "ping",
    ],
    {
      cwd: workdir,
      reject: false,
      env: {
        ...process.env,
        // The adapter must let the claude binary be injected (no hardcoded "claude").
        MAR_CLAUDE_BIN: `node ${fakeClaude}`,
      },
    },
  );

  // The CLI entry does not exist yet → this resolves to a non-zero exit / error.
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
