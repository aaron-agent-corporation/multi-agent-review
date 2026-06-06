// Phase-4 carry-over gap 1 (Pitfall 9 / T-05-02): `tsc` emits no non-TS assets, so the build did
// NOT copy `src/templates/*.tmpl` into `dist/`. The compiled `mar` binary resolves the instruction
// template RELATIVE TO THE COMPILED MODULE (instructions.ts TEMPLATE_URL → ../templates relative to
// dist/src/protocol/instructions.js → dist/src/templates/...), so a missing/misplaced copy makes the
// PACKAGED binary ENOENT at draft fan-out — invisible under `npm run dev` (tsx runs from source).
//
// UAT gap closure (05-07): the original build copied to `dist/templates/`, but tsc (rootDir ".") emits
// `dist/src/**`, so the resolver actually reads `dist/src/templates/`. The 05-01 guard asserted the
// WRONG path and passed while the compiled binary ENOENTed. This guard now (a) asserts at the
// resolver-true path `dist/src/templates/`, (b) derives that path FROM the compiled resolver itself so
// the test can never diverge from instructions.ts again, and (c) drives the COMPILED cli end-to-end
// against fake-CLI fixtures to prove the real reproduction (UAT Test-1) is closed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcTemplate = join(repoRoot, "src", "templates", "agent-instructions.md.tmpl");
const distTemplate = join(repoRoot, "dist", "src", "templates", "agent-instructions.md.tmpl");

// The fake-CLI fixtures (mirrors test/protocol-run.e2e.test.ts) — zero-credit hermetic roster.
const here = fileURLToPath(new URL(".", import.meta.url));
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const compiledCli = join(repoRoot, "dist", "src", "cli.js");

describe("npm run build copies the instruction template into dist (carry-over gap 1 / 05-07)", () => {
  beforeAll(() => {
    // Run the real build (tsc + cpSync copy step). Generous timeout — tsc is the slow part.
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
  }, 120000);

  it("emits dist/src/templates/agent-instructions.md.tmpl so the built binary can seed it", () => {
    expect(existsSync(distTemplate)).toBe(true);
  });

  it("the copied template is byte-identical to the source-of-truth template", () => {
    // Confirms the build copies the real contract, not a stale/empty placeholder. The compiled
    // seedInstructions (dist/src/protocol/instructions.js) reads THIS file via its module-relative URL.
    expect(readFileSync(distTemplate, "utf8")).toBe(readFileSync(srcTemplate, "utf8"));
  });

  it("the file the COMPILED resolver points at exists (resolver-truth: copy can never diverge again)", () => {
    // Derive the template path EXACTLY as the compiled module does — `new URL("../templates/...",
    // import.meta.url)` from dist/src/protocol/instructions.js — instead of hardcoding it. If the copy
    // destination and instructions.ts TEMPLATE_URL ever diverge, this assertion fails loudly, which is
    // precisely the failure mode the 05-01 hardcoded-path guard missed.
    const compiledModule = join(repoRoot, "dist", "src", "protocol", "instructions.js");
    const resolved = new URL(
      "../templates/agent-instructions.md.tmpl",
      pathToFileURL(compiledModule),
    );
    expect(existsSync(fileURLToPath(resolved))).toBe(true);
  });

  it("the COMPILED cli completes a hermetic 2-vendor fixture run with no template ENOENT (UAT Test-1)", () => {
    // The real reproduction: drive `node dist/src/cli.js run <doc> --autonomous` against a fake-CLI
    // roster (mirrors the e2e harness). Before 05-07 this ENOENTed at draft fan-out on
    // dist/src/templates/agent-instructions.md.tmpl. Now it must complete all 6 phases.
    const work = mkdtempSync(join(tmpdir(), "mar-dist-cli-"));
    try {
      writeFileSync(
        join(work, "mar.config.json"),
        `${JSON.stringify(
          {
            agents: [
              { name: "claude", vendor: "claude", bin: `node ${fakeClaude}` },
              { name: "codex", vendor: "codex", bin: `node ${fakeCodex}` },
            ],
          },
          null,
          2,
        )}\n`,
      );
      const inputPath = join(work, "input.md");
      writeFileSync(inputPath, "# document under review\n\nA proposal to evaluate.\n", "utf8");

      // Run the COMPILED binary (not tsx) — this is the packaged-binary path the UAT exercised.
      // MAR_EMIT_BASE pins convergence to round 1; stdin /dev/null so --autonomous never blocks.
      execFileSync("node", [compiledCli, "run", inputPath, "--autonomous"], {
        cwd: work,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, MAR_EMIT_BASE: "claude" },
      });

      // The run completed: exactly one run dir, manifest marked completed (no ENOENT would have thrown
      // a nonzero exit above, failing execFileSync before we reach here).
      const runsDir = join(work, "runs");
      expect(existsSync(runsDir)).toBe(true);
      const runIds = readdirSync(runsDir);
      expect(runIds.length).toBe(1);
      const manifest = JSON.parse(
        readFileSync(join(runsDir, runIds[0], "manifest.json"), "utf8"),
      );
      expect(manifest.status).toBe("completed");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);
});
