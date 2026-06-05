#!/usr/bin/env node
// Fake `claude` CLI fixture for adapter/e2e tests — never burns real credits.
// Mirrors the VERIFIED `claude -p --output-format json` shape (claude 2.1.162, RESEARCH.md).
// Modes (selected via argv flags):
//   (default/happy)  → is_error:false, result:"pong", exit 0
//   --fail-auth      → is_error:true (misleading subtype:"success"), exit 1
//   --bad-json       → writes "not json" to stdout, exit 0
//   --emit <kind>    → happy success envelope, but result body is the kind-tagged marker
//                      "claude:<kind>" so a multi-phase run yields distinct per-phase artifacts
//                      while preserving the verified output shape. (additive; default unchanged.)
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

const args = process.argv.slice(2);

/** Value following `--emit` (e.g. "draft"), or undefined when the flag is absent. */
function emitKind() {
  const i = args.indexOf("--emit");
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

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
} else if (emitKind() !== undefined) {
  // Per-phase marker mode: same verified success shape, body tagged by phase kind.
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: `claude:${emitKind()}`,
      session_id: "4eea0b0a",
      total_cost_usd: 0.19,
      duration_ms: 2588,
      usage: { input_tokens: 10058, output_tokens: 4 },
      modelUsage: {},
    }),
  );
  process.exit(0);
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
