// ============================================================================================
// PLANTED-ERROR A/B INDEPENDENCE PROOF — Phase 3 success criterion #4.
//
// This is the EMPIRICAL justification for the whole independence-enforcement design. A test that
// only asserts "the independent run caught the error" proves nothing about independence (RESEARCH
// Pitfall 2) — without a CONTROL showing a shared-context run MASKS the same error, the treatment
// is unfalsifiable. The two arms differ in the MECHANISM they exercise, not merely in injected
// constants (CR-02):
//
//   • CONTROL  — runs with MAR_SHARED_CONTEXT=1, which GENUINELY bypasses scoped isolation: during
//                drafting each fixture reads the shared, peer-visible work/_shared_drafts/ dir and
//                ANCHORS its emitted value onto the first peer draft already there. The promoted
//                value is therefore DERIVED FROM PEER WORK READ OFF DISK. Critically, the control is
//                handed DIVERGENT planted values (99 vs 42) — yet because context is shared, both
//                agents converge on the SAME consensus value and cross-review finds no discrepancy.
//                The planted error SURVIVES (is masked). If the shared-context path did NOT actually
//                override the divergent constants off disk, the control would surface a DISCREPANCY
//                and FAIL — so this control genuinely tests context sharing, not identical inputs.
//   • TREATMENT — keeps REAL scoped isolation (no MAR_SHARED_CONTEXT). Agents draft INDEPENDENTLY
//                from the SAME divergent values: one carries the planted error, the other (the
//                checker) drafts the correct value in isolation. Because the draft phase is scoped
//                (work/<agent>/ seeded with only input.md — PROT-04), neither can see the other's
//                draft, the divergent values reach shared/ at the promotion boundary, and
//                cross-review SURFACES the discrepancy. Same inputs as the control → the ONLY
//                difference between the arms is whether context is shared.
//
// FALSIFIABILITY HOOK (CR-02): in planted mode every drafting agent records what PEER drafts it
// could see in its OWN scoped cwd to work/<agent>/peer-visibility.json. The treatment arm asserts
// these are EMPTY — if scope.ts isolation ever broke and leaked a peer draft into work/<agent>/
// (the exact confidentiality failure this phase exists to prevent), the probe would be non-empty
// and the treatment test MUST fail. The discrepancy/agreement each arm reports likewise emerges
// from what the fixtures actually read off disk, so a regression in the mechanism is observable.
//
// BOTH arms run through the REAL engine (`mar run` → runProtocol). HERMETIC: both drive
// `node <fixture>` bins only — ZERO credits, no real claude/codex binary is ever invoked. Planted
// mode is activated by env (MAR_PLANTED_MODE=1); each agent's own value comes from the JSON env map
// MAR_PLANTED_VALUES; shared-context masking is activated by MAR_SHARED_CONTEXT=1 (control only).
// ============================================================================================

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// Cold `npx tsx` startup (~5s) under concurrent load can exceed the default 15s; a generous
// timeout absorbs harness startup, not a hang.
vi.setConfig({ testTimeout: 60_000 });

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..");
const fakeClaude = join(here, "fixtures", "fake-claude.mjs");
const fakeCodex = join(here, "fixtures", "fake-codex.mjs");
const cliEntry = join(repoRoot, "src", "cli.ts");

// The planted error and the correct value the independent checker draws when drafting in isolation.
const PLANTED_ERROR = "99";
const CORRECT_VALUE = "42";

let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "mar-planted-"));
});

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

interface ArmOptions {
  /** When true, run the control's shared-context (isolation-bypassing) draft path. */
  sharedContext?: boolean;
}

interface ArmResult {
  /** Concatenated bodies of every review-phase artifact (where AGREED/DISCREPANCY is reported). */
  reviews: string;
  /** The run dir, so the caller can inspect the per-agent peer-visibility probe files. */
  runDir: string;
}

/**
 * Run the full 6-phase protocol once under the env-activated planted-error fixture mode. A roster of
 * TWO DISTINCT vendors (claude + codex), each injecting its fake fixture bin → the assertReviewable
 * gate passes and zero credits are burned. `plantedValues` maps each agent name to the value it
 * privately holds at draft time; `opts.sharedContext` activates the control's shared-context path.
 */
async function runArm(
  armDir: string,
  plantedValues: Record<string, string>,
  opts: ArmOptions = {},
): Promise<ArmResult> {
  writeFileSync(
    join(armDir, "mar.config.json"),
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

  const inputPath = join(armDir, "input.md");
  writeFileSync(inputPath, "# document under review\n\nReport the value.\n", "utf8");

  const result = await execa("npx", ["tsx", cliEntry, "run", inputPath], {
    cwd: armDir,
    reject: false,
    env: {
      ...process.env,
      MAR_PLANTED_MODE: "1",
      MAR_PLANTED_VALUES: JSON.stringify(plantedValues),
      ...(opts.sharedContext ? { MAR_SHARED_CONTEXT: "1" } : {}),
    },
  });
  // A full protocol run must complete (the gate passes — every agent writes every phase).
  expect(result.exitCode).toBe(0);

  const runsDir = join(armDir, "runs");
  const runIds = readdirSync(runsDir);
  expect(runIds.length).toBe(1);
  const runDir = join(runsDir, runIds[0]);

  // Concatenate every review-phase artifact body — that is where each agent reports whether the
  // promoted peer drafts AGREED or carried a DISCREPANCY.
  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const reviewPaths = manifest.artifacts
    .filter((a: { kind: string }) => a.kind === "review")
    .map((a: { path: string }) => a.path);
  const reviews = reviewPaths
    .map((rel: string) => readFileSync(join(runDir, rel), "utf8"))
    .join("\n");
  return { reviews, runDir };
}

/**
 * Collect, per agent, the list of PEER drafts each drafting agent could see in its OWN scoped cwd
 * (recorded by the fixtures to work/<agent>/peer-visibility.json — CR-02 falsifiability hook).
 * Returns a map agent→peerDraftsVisible. Under PROT-04 every list must be empty.
 */
function readPeerVisibility(runDir: string): Record<string, string[]> {
  const workDir = join(runDir, "work");
  const out: Record<string, string[]> = {};
  if (!existsSync(workDir)) return out;
  for (const agent of readdirSync(workDir)) {
    const probe = join(workDir, agent, "peer-visibility.json");
    if (!existsSync(probe)) continue;
    const parsed = JSON.parse(readFileSync(probe, "utf8"));
    out[agent] = Array.isArray(parsed.peerDraftsVisible) ? parsed.peerDraftsVisible : [];
  }
  return out;
}

// ── CONTROL ARM ────────────────────────────────────────────────────────────────────────────────
// GENUINELY shared context (MAR_SHARED_CONTEXT=1). The agents are handed DIVERGENT values (99 vs
// 42) — the SAME inputs the treatment uses — but the shared-context draft path makes each agent
// anchor onto the first peer draft it reads off disk, so both converge on ONE consensus value.
// Cross-review then finds no divergence and the planted error is MASKED. Were the shared path not
// actually overriding the divergent constants, this arm would surface a DISCREPANCY and fail.
it("control (shared context): divergent values converge off disk and the error is MASKED", async () => {
  const armDir = mkdtempSync(join(tmpdir(), "mar-planted-control-"));
  try {
    const { reviews } = await runArm(
      armDir,
      {
        claude: PLANTED_ERROR,
        codex: CORRECT_VALUE, // DIVERGENT on purpose — only context-sharing makes them converge.
      },
      { sharedContext: true },
    );

    // The error survives: context sharing collapsed the divergent values to one → no discrepancy.
    expect(reviews).not.toContain("DISCREPANCY");
    expect(reviews).toContain("AGREED");
  } finally {
    rmSync(armDir, { recursive: true, force: true });
  }
});

// ── TREATMENT ARM ────────────────────────────────────────────────────────────────────────────────
// Independent drafts (REAL scoped isolation). The SAME divergent inputs as the control — claude
// carries the planted error, codex drafts the correct value in ISOLATION (scoped work/<agent>/ —
// PROT-04). With context NOT shared, both values reach shared/ at promotion and cross-review
// SURFACES the discrepancy. The only difference from the control is whether context is shared.
it("treatment (independent drafts): an independent draft SURFACES the planted error a control masks", async () => {
  const armDir = mkdtempSync(join(tmpdir(), "mar-planted-treatment-"));
  try {
    const { reviews, runDir } = await runArm(armDir, {
      claude: PLANTED_ERROR, // one agent carries the planted error
      codex: CORRECT_VALUE, // the independent checker draws the correct value in isolation
    });

    // Independence works: the divergent values collide at cross-review → discrepancy surfaced.
    expect(reviews).toContain("DISCREPANCY");
    // The surfaced discrepancy names BOTH the planted error and the correcting value.
    expect(reviews).toContain(PLANTED_ERROR);
    expect(reviews).toContain(CORRECT_VALUE);

    // FALSIFIABILITY (CR-02): during drafting NEITHER agent could see a peer draft in its scoped
    // cwd. If scope.ts isolation leaked a peer draft into work/<agent>/, the probe would be
    // non-empty here and this assertion would FAIL — tying the test directly to the mechanism.
    const visibility = readPeerVisibility(runDir);
    expect(Object.keys(visibility).sort()).toEqual(["claude", "codex"]);
    for (const [agent, peers] of Object.entries(visibility)) {
      expect(peers, `${agent} must see ZERO peer drafts while drafting in isolation`).toEqual([]);
    }
  } finally {
    rmSync(armDir, { recursive: true, force: true });
  }
});
