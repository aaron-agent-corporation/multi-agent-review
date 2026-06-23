// D-36/D-37 + Pitfall 1 (T-04-03) — instruction-file seeding and the ancestor-inheritance
// neutralization SPIKE. The format contract is delivered by seeding each agent's scoped cwd with
// its vendor-native instruction file rendered from ONE source-of-truth template. The load-bearing
// risk (success criterion #2): all three CLIs walk from the git project root down to cwd
// discovering instruction files, so this repo's own root CLAUDE.md (GSD workflow directives) could
// dilute/override the seeded format contract. These tests are hermetic (filesystem only, no live
// CLI): they prove the seeded file is the EFFECTIVE NEAREST contract despite a planted ancestor.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VENDOR_FILE, type Vendor } from "../src/protocol/instructions.js";
import { scopedWorkdir } from "../src/workspace/scope.js";

// The source-of-truth template content, read directly so assertions compare against the contract.
const TEMPLATE = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "templates",
    "agent-instructions.md.tmpl",
  ),
  "utf8",
);

let runDir: string;
let inputPath: string;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "mar-instr-"));
  inputPath = join(runDir, "source.md");
  writeFileSync(inputPath, "# the document under review\n", "utf8");
});

afterEach(() => {
  if (runDir) rmSync(runDir, { recursive: true, force: true });
});

describe("scopedWorkdir seeds each agent's vendor-native instruction file (D-37)", () => {
  const cases: Array<[Vendor, string]> = [
    ["claude", "CLAUDE.md"],
    ["codex", "AGENTS.md"],
    ["gemini", "GEMINI.md"],
    ["grok", "AGENTS.md"],
  ];

  for (const [vendor, filename] of cases) {
    it(`${vendor} → ${filename} seeded with the template content (read back)`, async () => {
      const dir = await scopedWorkdir(runDir, vendor, inputPath, vendor);
      const seeded = join(dir, filename);
      expect(existsSync(seeded)).toBe(true);
      // Identity render (D-37): byte-identical to the single source-of-truth template.
      expect(readFileSync(seeded, "utf8")).toBe(TEMPLATE);
      // The contract's load-bearing tokens reached the agent's cwd.
      const body = readFileSync(seeded, "utf8");
      for (const token of ["P1", "P2", "P3", "accept", "reject-with-reason", "refine"]) {
        expect(body).toContain(token);
      }
    });
  }

  it("the integration contract uses the schema vocabulary, not response verdict vocabulary", () => {
    const integrationSection = TEMPLATE.slice(TEMPLATE.indexOf("## INTEGRATION artifacts"));
    expect(integrationSection).toContain("additionRef");
    expect(integrationSection).toContain('verdict: "merged"');
    expect(integrationSection).toContain('verdict: "merged-with-change"');
    expect(integrationSection).toContain("change:");
    expect(integrationSection).toContain('verdict: "dropped"');
    expect(integrationSection).not.toContain("source:");
    expect(integrationSection).not.toContain("verdict: accept");
    expect(integrationSection).not.toContain("reject-with-reason");
    expect(integrationSection).not.toContain("refinement:");
  });

  it("VENDOR_FILE maps the supported vendors to their native filenames", () => {
    expect(VENDOR_FILE).toEqual({
      claude: "CLAUDE.md",
      codex: "AGENTS.md",
      gemini: "GEMINI.md",
      grok: "AGENTS.md",
    });
  });
});

describe("SPIKE: ancestor instruction-file inheritance is neutralized (Pitfall 1 / T-04-03)", () => {
  // Plant a conflicting instruction file in an ANCESTOR of the scoped cwd, mimicking this repo's
  // own root CLAUDE.md (GSD workflow directives). The CLIs walk root→cwd; the neutralization must
  // make the SEEDED file the effective contract, not the planted ancestor.
  const POISON_MARKER = "DO-NOT-MAKE-DIRECT-REPO-EDITS-ANCESTOR-POISON";
  const GSD_POISON = `# Ancestor workflow directives\n${POISON_MARKER}: Start work through a workflow command.\n`;

  function nearestInstructionFile(startDir: string, filename: string): string | undefined {
    // Mirror the vendors' root→cwd walk: the NEAREST matching instruction file from cwd upward
    // is the one that wins (codex/gemini honor nearest; claude under --bare ignores the root).
    let cur = startDir;
    for (;;) {
      const candidate = join(cur, filename);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(cur);
      if (parent === cur) return undefined;
      cur = parent;
    }
  }

  it("the seeded contract is the NEAREST instruction file, not the planted ancestor", async () => {
    // Ancestor poison: a CLAUDE.md two levels above the scoped cwd.
    writeFileSync(join(runDir, "CLAUDE.md"), GSD_POISON, "utf8");

    const dir = await scopedWorkdir(runDir, "alice", inputPath, "claude");
    const nearest = nearestInstructionFile(dir, "CLAUDE.md");

    // Neutralization assertion: the nearest CLAUDE.md is the SEEDED one in the scoped cwd, and it
    // carries the format contract — NOT the ancestor GSD directives. If seeding were removed, the
    // nearest CLAUDE.md would be the planted ancestor and this would FAIL.
    expect(nearest).toBe(join(dir, "CLAUDE.md"));
    const effective = readFileSync(nearest as string, "utf8");
    expect(effective).toBe(TEMPLATE);
    expect(effective).not.toContain(POISON_MARKER);
    expect(effective).toContain("reject-with-reason");
  });

  it("no ancestor AGENTS.md/GEMINI.md leaks into a codex/gemini agent's nearest contract", async () => {
    // This repo's root has ONLY CLAUDE.md today (no AGENTS.md/GEMINI.md), so for codex/gemini the
    // seeded file is the sole instruction file on the walk. Prove the seeded file is the nearest
    // (and only) one even when a sibling CLAUDE.md is present in an ancestor.
    writeFileSync(join(runDir, "CLAUDE.md"), GSD_POISON, "utf8");

    const codexDir = await scopedWorkdir(runDir, "codexbot", inputPath, "codex");
    const geminiDir = await scopedWorkdir(runDir, "gembot", inputPath, "gemini");

    expect(nearestInstructionFile(codexDir, "AGENTS.md")).toBe(join(codexDir, "AGENTS.md"));
    expect(nearestInstructionFile(geminiDir, "GEMINI.md")).toBe(join(geminiDir, "GEMINI.md"));
    // The codex agent's cwd does not carry a leaked GSD CLAUDE.md sibling that overrides its
    // AGENTS.md (its OWN dir holds only input.md + AGENTS.md).
    expect(readdirSync(codexDir).sort()).toEqual(["AGENTS.md", "input.md"]);
    expect(readdirSync(geminiDir).sort()).toEqual(["GEMINI.md", "input.md"]);
  });

  it("FALSIFIABILITY: without seeding, the planted ancestor would be the nearest contract", async () => {
    // This documents WHY the seeding step is the neutralization: with no seeded file in the scoped
    // cwd, the nearest CLAUDE.md is the poisoned ancestor. (We don't call scopedWorkdir here.)
    writeFileSync(join(runDir, "CLAUDE.md"), GSD_POISON, "utf8");
    const unseededCwd = join(runDir, "work", "noseed");
    // create the empty cwd WITHOUT seeding
    rmSync(unseededCwd, { recursive: true, force: true });
    mkdirSync(unseededCwd, { recursive: true });

    const nearest = nearestInstructionFile(unseededCwd, "CLAUDE.md");
    // Proves the risk is real: absent seeding, the ancestor poison is what an agent would discover.
    expect(nearest).toBe(join(runDir, "CLAUDE.md"));
    expect(readFileSync(nearest as string, "utf8")).toContain(POISON_MARKER);
  });
});
