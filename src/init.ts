import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import fsExtra from "fs-extra";
import { type MarConfig, MarConfig as MarConfigSchema } from "./schema/config.js";

const { rename, writeFile } = fsExtra;

/** The vendors `mar init` probes for, in deterministic order. */
const VENDORS = ["claude", "codex", "gemini"] as const;
type Vendor = (typeof VENDORS)[number];

/**
 * Resolve `bin` against PATH WITHOUT spawning a shell (RESEARCH Pattern 5) — consistent with the
 * no-shell-injection posture (T-02-11). Walks `process.env.PATH`, honoring PATHEXT on win32.
 */
function onPath(bin: string): string | undefined {
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, bin + ext);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

/** Detect which of the supported vendor CLIs are installed on PATH (D-21). */
export function detectVendors(): Vendor[] {
  return VENDORS.filter((v) => onPath(v) !== undefined);
}

/**
 * Write a starter `mar.config.json` (D-21) listing one agent per detected vendor (name `<vendor>-1`)
 * plus the defaults block. Validates via MarConfig.parse before persisting, then writes atomically
 * (temp + rename, mirroring writeManifestAtomic) with the manifest writer's
 * `JSON.stringify(x, null, 2) + "\n"` formatting. `mar.config.json` is a tracked project file (D-34).
 */
export async function writeStarterConfig(path: string, vendors: Vendor[]): Promise<void> {
  const cfg: MarConfig = MarConfigSchema.parse({
    agents: vendors.map((vendor) => ({ name: `${vendor}-1`, vendor })),
  });
  const tmpPath = `${path}.tmp-${process.pid}`;
  await writeFile(tmpPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}
