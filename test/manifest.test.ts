import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Manifest } from "../src/schema/manifest.js";
import { isDone, writeArtifact } from "../src/workspace/artifacts.js";
import {
  addArtifact,
  createRun,
  readManifest,
  setStatus,
  writeManifestAtomic,
} from "../src/workspace/manifest.js";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "mar-manifest-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("manifest (filesystem-as-truth)", () => {
  it("createRun writes a parseable manifest with status created + empty artifacts", async () => {
    const rd = join(work, "runs", "r1");
    const m = await createRun({ runDir: rd, runId: "r1", cliVersions: { claude: "2.1.162" } });
    expect(m.status).toBe("created");
    expect(m.artifacts).toEqual([]);
    expect(existsSync(join(rd, "manifest.json"))).toBe(true);
    const onDisk = JSON.parse(readFileSync(join(rd, "manifest.json"), "utf8"));
    expect(Manifest.safeParse(onDisk).success).toBe(true);
  });

  it("readManifest round-trips what was written", async () => {
    const rd = join(work, "runs", "r2");
    const m = await createRun({ runDir: rd, runId: "r2", cliVersions: {} });
    const back = await readManifest(rd);
    expect(back).toEqual(m);
  });

  it("writeManifestAtomic leaves no temp file behind", async () => {
    const rd = join(work, "runs", "r3");
    await createRun({ runDir: rd, runId: "r3", cliVersions: {} });
    const m = await readManifest(rd);
    await writeManifestAtomic(rd, { ...m, status: "running" });
    const leftover = readdirSync(rd).filter((f) => f.includes(".tmp"));
    expect(leftover).toEqual([]);
  });

  it("addArtifact appends, bumps updatedAt, and re-reads identically from disk (PROT-07)", async () => {
    const rd = join(work, "runs", "r4");
    await createRun({ runDir: rd, runId: "r4", cliVersions: {} });
    const before = await readManifest(rd);
    await new Promise((r) => setTimeout(r, 5));
    const updated = await addArtifact(rd, {
      path: "001-claude-output.md",
      agent: "claude",
      seq: 1,
      kind: "output",
      createdAt: new Date().toISOString(),
    });
    expect(updated.artifacts.length).toBe(1);
    expect(updated.updatedAt).not.toBe(before.updatedAt);
    const onDisk = await readManifest(rd);
    expect(onDisk).toEqual(updated);
    expect(onDisk.artifacts[0].seq).toBe(1);
  });

  it("setStatus updates status on disk", async () => {
    const rd = join(work, "runs", "r5");
    await createRun({ runDir: rd, runId: "r5", cliVersions: {} });
    const m = await setStatus(rd, "completed");
    expect(m.status).toBe("completed");
    expect((await readManifest(rd)).status).toBe("completed");
  });
});

describe("artifacts (atomic write + done-detection)", () => {
  it("writeArtifact creates the .md (frontmatter + body) and sibling .raw.json", async () => {
    const rd = join(work, "runs", "a1");
    const { path, rawPath } = await writeArtifact(rd, 1, "claude", {
      text: "pong",
      raw: { is_error: false, result: "pong" },
      frontmatter: { vendor: "claude", runId: "a1" },
    });
    const md = readFileSync(path, "utf8");
    expect(md).toContain("---"); // frontmatter fence
    expect(md).toContain("agent: claude");
    expect(md).toContain("pong");
    const raw = JSON.parse(readFileSync(rawPath, "utf8"));
    expect(raw.result).toBe("pong");
    // no temp leftovers
    const leftover = readdirSync(rd).filter((f) => f.includes(".tmp"));
    expect(leftover).toEqual([]);
  });

  it("isDone is false for missing, false for empty, true for non-empty (PROT-02)", () => {
    const missing = join(work, "nope.md");
    expect(isDone(missing)).toBe(false);

    const empty = join(work, "empty.md");
    writeFileSync(empty, "");
    expect(isDone(empty)).toBe(false);

    const full = join(work, "full.md");
    writeFileSync(full, "content");
    expect(isDone(full)).toBe(true);
  });
});
