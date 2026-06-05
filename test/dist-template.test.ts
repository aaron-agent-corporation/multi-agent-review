// Phase-4 carry-over gap 1 (Pitfall 9 / T-05-02): `tsc` emits no non-TS assets, so the build did
// NOT copy `src/templates/*.tmpl` into `dist/`. The compiled `mar` binary resolves the instruction
// template RELATIVE TO THE COMPILED MODULE (instructions.ts TEMPLATE_URL → dist/templates/...), so a
// missing copy makes the PACKAGED binary ENOENT at draft fan-out — invisible under `npm run dev`
// (tsx runs from source). This guard runs the real `npm run build` and asserts the template lands in
// dist with byte-identical content, so a regression of the copy step fails loudly in CI.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcTemplate = join(repoRoot, "src", "templates", "agent-instructions.md.tmpl");
const distTemplate = join(repoRoot, "dist", "templates", "agent-instructions.md.tmpl");

describe("npm run build copies the instruction template into dist (carry-over gap 1)", () => {
  beforeAll(() => {
    // Run the real build (tsc + cpSync copy step). Generous timeout — tsc is the slow part.
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "pipe" });
  }, 120000);

  it("emits dist/templates/agent-instructions.md.tmpl so the built binary can seed it", () => {
    expect(existsSync(distTemplate)).toBe(true);
  });

  it("the copied template is byte-identical to the source-of-truth template", () => {
    // Confirms the build copies the real contract, not a stale/empty placeholder. The compiled
    // seedInstructions (dist/protocol/instructions.js) reads THIS file via its module-relative URL.
    expect(readFileSync(distTemplate, "utf8")).toBe(readFileSync(srcTemplate, "utf8"));
  });
});
