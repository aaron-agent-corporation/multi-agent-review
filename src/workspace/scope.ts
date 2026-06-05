import { join } from "node:path";
import fsExtra from "fs-extra";
import { artifactName } from "./layout.js";

const { ensureDir, copy } = fsExtra;

// Agent names become a directory segment under work/<agent>/ and shared/. They MUST match the
// same charset as RUN_ID_RE (cli.ts) so a name can never contain "/" or ".." and escape runDir
// (T-03-01 tampering mitigation). join() then only ever resolves under runDir.
const AGENT_NAME_RE = /^[A-Za-z0-9_-]+$/;

function assertSafeAgent(agent: string): void {
  if (!AGENT_NAME_RE.test(agent)) {
    throw new Error(
      `unsafe agent name "${agent}": must match ${AGENT_NAME_RE} (no path separators or "..")`,
    );
  }
}

/**
 * The deterministic draft artifact name for an agent (PROT-04). Single naming source so the
 * engine that writes the draft, the listing-independence check, and {@link promoteDrafts} all
 * agree: `001-<agent>-draft.md`.
 */
export function draftFileName(agent: string): string {
  assertSafeAgent(agent);
  return artifactName(1, agent, "draft");
}

/**
 * Create an isolated per-agent draft working directory and return its path (PROT-04 — the
 * project's highest-stakes invariant). The dir is `runDir/work/<agent>/` and is seeded with ONLY
 * `input.md` (a copy of the document under review). It deliberately contains NO peer draft, so
 * `readdirSync` of one agent's workdir can never reveal another agent's draft — independence is a
 * filesystem fact, not a prompt request. The returned path is meant to be passed as the adapter's
 * scoped `cwd` for the draft phase.
 */
export async function scopedWorkdir(
  runDir: string,
  agent: string,
  inputPath: string,
): Promise<string> {
  assertSafeAgent(agent);
  const dir = join(runDir, "work", agent);
  await ensureDir(dir);
  await copy(inputPath, join(dir, "input.md"));
  return dir;
}

/**
 * Promote each agent's draft from its scoped `work/<agent>/` dir into the shared workspace, at
 * the draft->cross-review (phase 1->2) boundary ONLY (PROT-04). This is the SINGLE writer of
 * drafts into `shared/` — drafts are never written there during the drafting phase. After this
 * call, every agent can read every peer's draft from `shared/` for cross-review.
 */
export async function promoteDrafts(runDir: string, agents: string[]): Promise<void> {
  const sharedDir = join(runDir, "shared");
  await ensureDir(sharedDir);
  for (const agent of agents) {
    assertSafeAgent(agent);
    const name = draftFileName(agent);
    await copy(join(runDir, "work", agent, name), join(sharedDir, name));
  }
}
