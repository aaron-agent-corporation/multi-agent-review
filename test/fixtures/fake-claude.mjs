#!/usr/bin/env node
// Fake `claude` CLI fixture for adapter/e2e tests — never burns real credits.
// Mirrors the VERIFIED `claude -p --output-format json` shape (claude 2.1.162, RESEARCH.md).
// Modes (selected via argv flags):
//   (default/happy)  → is_error:false, result:"pong", exit 0
//   --fail-auth      → is_error:true (misleading subtype:"success"), exit 1
//   --bad-json       → writes "not json" to stdout, exit 0
//   --emit <kind>    → happy success envelope whose result body is a SCHEMA-VALID
//                      markdown+frontmatter artifact for <kind> (review/response/evaluation/
//                      integration per the 04-01 schemas); draft/validation/unknown fall back to the
//                      "claude:<kind>" marker. Also triggered by a `[phase:<name>]` prompt tag from
//                      the engine so a hermetic run produces structured artifacts (D-49).
//   --emit-malformed <kind> → like --emit but the frontmatter VIOLATES the <kind> schema, to drive
//                      the D-38 validation one-retry path. (additive; default unchanged.)
//   MAR_EMIT_BASE=<agent> (env) → steer the proposedBase/base emitted by evaluation/integration so a
//                      convergence test (04-04) can make fixtures agree on one base.
//   MAR_PLANTED_MODE=1 (env) → A/B INDEPENDENCE PROOF mode (test/planted-error.test.ts). Activated
//                      by ENV (not an argv flag) because the injectable `bin` is split on the first
//                      whitespace only (splitBin), so extra `bin` flags can't survive — env is the
//                      reliable per-run channel. The phase- and filesystem-aware body is computed by
//                      the SHARED helper planted-shared.mjs (plantedBody), so fake-claude and
//                      fake-codex stay in lock-step. In brief: draft emits "VALUE=<V>" and records a
//                      peer-visibility probe (falsifiability); review reports DISCREPANCY/AGREED from
//                      the promoted peer drafts in ./shared/; MAR_SHARED_CONTEXT=1 (control) makes the
//                      draft genuinely share context off disk. See planted-shared.mjs for the full
//                      mechanics. Hermetic: reads only local files under cwd + env.
//   --hang           → never exits (for timeout/kill tests)
// The prompt is read from argv but is not required.

import { plantedBody, plantedMode } from "./planted-shared.mjs";
import { resolveEmitBody } from "./structured-shared.mjs";

const args = process.argv.slice(2);

/**
 * The structured body this fixture should emit (D-49): a schema-valid (or, with --emit-malformed, a
 * deliberately invalid) markdown+frontmatter body for the requested kind / engine phase, or
 * undefined when no emit/phase mode applies. Lives in structured-shared.mjs so all three fixtures
 * stay byte-aligned.
 */
const emitBody = resolveEmitBody("claude", args);

/** Emit a claude success envelope carrying `body` as `.result`, then exit 0. */
function emitResult(body) {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: body,
      session_id: "4eea0b0a",
      total_cost_usd: 0.19,
      duration_ms: 2588,
      usage: { input_tokens: 10058, output_tokens: 4 },
      modelUsage: {},
    }),
  );
  process.exit(0);
}

if (args.includes("--hang")) {
  // Never exit — lets a wall-clock timeout test kill us.
  setInterval(() => {}, 1e9);
} else if (plantedMode()) {
  // A/B independence proof: phase- and filesystem-aware output computed from disk (see
  // planted-shared.mjs). Draft records the peer-visibility probe (falsifiability), control shares
  // context off disk, review reports DISCREPANCY/AGREED from promoted peer drafts.
  emitResult(plantedBody("claude", args));
} else if (emitBody !== undefined) {
  // Structured-emit mode (D-49): same verified success shape, `.result` is the schema-valid (or
  // --emit-malformed) markdown+frontmatter body for the requested kind / engine phase.
  emitResult(emitBody);
} else if (args.includes("--fail-auth")) {
  // Not-logged-in: exit 1 AND is_error:true, but subtype stays the misleading "success".
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Not logged in · Please run /login",
      session_id: "x",
      total_cost_usd: 0,
      duration_ms: 10,
      usage: {},
      modelUsage: {},
    }),
  );
  process.exit(1);
} else if (args.includes("--bad-json")) {
  process.stdout.write("not json");
  process.exit(0);
} else {
  // Happy path — verified shape.
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "pong",
      session_id: "4eea0b0a",
      total_cost_usd: 0.19,
      duration_ms: 2588,
      usage: { input_tokens: 10058, output_tokens: 4 },
      modelUsage: {},
    }),
  );
  process.exit(0);
}
