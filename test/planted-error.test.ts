// ============================================================================================
// PLANTED-ERROR A/B INDEPENDENCE PROOF — Phase 3 success criterion #4.
//
// This is the EMPIRICAL justification for the whole independence-enforcement design. A test that
// only asserts "the independent run caught the error" proves nothing about independence (RESEARCH
// Pitfall 2) — without a CONTROL showing a shared-context run MASKS the same error, the treatment
// is unfalsifiable. So this file asserts BOTH arms:
//
//   • CONTROL  — every agent holds the SAME consensus value (the planted error). This models the
//                manual case study's failure mode: all agents anchored on one consensus draft. The
//                drafts agree, so cross-review finds no discrepancy and the planted error SURVIVES
//                (is masked). We assert NO review artifact flags a discrepancy.
//   • TREATMENT — agents draft INDEPENDENTLY: one carries the planted error, the other (the checker)
//                drafts the correct value in isolation. Because the draft phase is scoped
//                (work/<agent>/ seeded with only input.md — PROT-04), the divergent value reaches
//                shared/ at the promotion boundary, and cross-review SURFACES the discrepancy. We
//                assert at least one review artifact flags it.
//
// BOTH arms run through the REAL engine (`mar run` → runProtocol) — the only difference is whether
// the agents' privately-held draft values agree (control: shared consensus) or differ (treatment:
// independent drafts). The independence MECHANISM (scoped draft dirs + boundary promotion) is
// identical in both; the control's identical values faithfully reproduce what a true shared-context
// run yields (every agent echoes the one consensus draft → identical values → no divergence).
//
// HERMETIC: both arms drive `node <fixture>` bins only — ZERO credits, no real claude/codex binary
// is ever invoked. The planted-error mode is activated by env (MAR_PLANTED_MODE=1) and each agent's
// value comes from the JSON env map MAR_PLANTED_VALUES; the fixtures compute the
// discrepancy/agreement purely from files on disk under the run dir.
// ============================================================================================

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Run the full 6-phase protocol once under the env-activated planted-error fixture mode and return
 * the concatenated bodies of every review artifact (where the discrepancy/agreement is reported).
 * A roster of TWO DISTINCT vendors (claude + codex), each injecting its fake fixture bin → the
 * assertReviewable gate passes and zero credits are burned. `plantedValues` maps each agent name to
 * the value it privately holds at draft time.
 */
async function runArm(armDir: string, plantedValues: Record<string, string>): Promise<string> {
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
  return reviewPaths.map((rel: string) => readFileSync(join(runDir, rel), "utf8")).join("\n");
}

// ── CONTROL ARM ────────────────────────────────────────────────────────────────────────────────
// Shared consensus: BOTH agents hold the SAME planted-error value. Their drafts agree, so
// cross-review finds no divergence and the planted error is MASKED — exactly the case study's
// shared-context failure mode. Assert NO discrepancy is surfaced.
it("control (shared consensus): a planted error every agent shares is MASKED at cross-review", async () => {
  const armDir = mkdtempSync(join(tmpdir(), "mar-planted-control-"));
  try {
    const reviews = await runArm(armDir, {
      claude: PLANTED_ERROR,
      codex: PLANTED_ERROR, // both anchored on the same (wrong) consensus value
    });

    // The error survives: every agent saw the same value, so no review flags a discrepancy.
    expect(reviews).not.toContain("DISCREPANCY");
    expect(reviews).toContain("AGREED");
    // And the masked value present in the agreed reviews is the planted error itself.
    expect(reviews).toContain(`value=${PLANTED_ERROR}`);
  } finally {
    rmSync(armDir, { recursive: true, force: true });
  }
});

// ── TREATMENT ARM ────────────────────────────────────────────────────────────────────────────────
// Independent drafts: claude carries the planted error; codex, drafting in ISOLATION (scoped
// work/<agent>/ — PROT-04), reports the correct value. The divergence reaches shared/ at promotion
// and cross-review SURFACES the discrepancy. Assert it IS flagged.
it("treatment (independent drafts): an independent draft SURFACES the planted error a control masks", async () => {
  const armDir = mkdtempSync(join(tmpdir(), "mar-planted-treatment-"));
  try {
    const reviews = await runArm(armDir, {
      claude: PLANTED_ERROR, // one agent carries the planted error
      codex: CORRECT_VALUE, // the independent checker draws the correct value in isolation
    });

    // Independence works: the divergent values collide at cross-review → discrepancy surfaced.
    expect(reviews).toContain("DISCREPANCY");
    // The surfaced discrepancy names BOTH the planted error and the correcting value.
    expect(reviews).toContain(PLANTED_ERROR);
    expect(reviews).toContain(CORRECT_VALUE);
  } finally {
    rmSync(armDir, { recursive: true, force: true });
  }
});
