import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePrompt } from "../src/cli.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mar-prompt-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolvePrompt (WR-05: bounded file read, literal fallback)", () => {
  it("treats a non-existent value as a literal inline prompt", () => {
    const r = resolvePrompt("write me a haiku");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.promptText).toBe("write me a haiku");
    expect(r.promptRef).toBe("inline:write me a haiku");
  });

  it("reads an existing regular file under the size cap and references it by path", () => {
    const p = join(dir, "prompt.txt");
    writeFileSync(p, "file prompt body");
    const r = resolvePrompt(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.promptText).toBe("file prompt body");
    expect(r.promptRef).toBe(p);
  });

  it("rejects an oversize prompt file rather than streaming it (WR-05 size cap)", () => {
    const p = join(dir, "huge.txt");
    // One byte over the 10 MB cap.
    writeFileSync(p, Buffer.alloc(10 * 1024 * 1024 + 1, 0x61));
    const r = resolvePrompt(p);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("exceeds");
    expect(r.error).toContain("cap");
  });

  it("falls through to literal handling when the value names a directory, not a file", () => {
    // `dir` exists but is not a regular file → treated as a literal string, not read.
    const r = resolvePrompt(dir);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.promptText).toBe(dir);
    expect(r.promptRef.startsWith("inline:")).toBe(true);
  });
});
