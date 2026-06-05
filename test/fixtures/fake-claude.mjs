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
//   --hang           → never exits (for timeout/kill tests)
// The prompt is read from argv but is not required.

const args = process.argv.slice(2);

/** Value following `--emit` (e.g. "draft"), or undefined when the flag is absent. */
function emitKind() {
  const i = args.indexOf("--emit");
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

if (args.includes("--hang")) {
  // Never exit — lets a wall-clock timeout test kill us.
  setInterval(() => {}, 1e9);
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
