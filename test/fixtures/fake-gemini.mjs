#!/usr/bin/env node
// Fake `gemini` CLI fixture for adapter/e2e tests — never burns real credits.
// Gemini is FIXTURE-BUILT (D-32): real gemini headless auth is broken on this machine, so the
// adapter is built/tested ENTIRELY against this fixture. Encodes the docs success shape and the
// LIVE-VERIFIED failure shapes (RESEARCH.md), incl. the JSON-on-STDERR gotcha (Pitfall 3) and the
// undocumented exit codes 41/55. Modes (selected via argv flags):
//   (default/happy)  → {response:"pong", stats:{}} on STDOUT, exit 0
//   --fail-auth      → {session_id, error:{type,message:"Please set an Auth method...",code:41}}
//                      on STDERR, exit 41
//   --untrusted      → plain text "not running in a trusted directory" on STDERR, exit 55
//   --rate-limit     → {error:{code:429, message:"RESOURCE_EXHAUSTED"}} on STDERR, exit 1
//   --bad-json       → writes "not json" to STDOUT, exit 0 (no parseable JSON)
//   --emit <kind>    → happy success envelope whose `response` is a SCHEMA-VALID
//                      markdown+frontmatter artifact for <kind> (review/response/evaluation/
//                      integration per the 04-01 schemas); draft/validation/unknown fall back to the
//                      "gemini:<kind>" marker. Also triggered by a `[phase:<name>]` prompt tag from
//                      the engine so a hermetic run produces structured artifacts (D-49).
//   --emit-malformed <kind> → like --emit but the frontmatter VIOLATES the <kind> schema, to drive
//                      the D-38 validation one-retry path. (additive; default unchanged.)
//   MAR_EMIT_BASE=<agent> (env) → steer the proposedBase/base emitted by evaluation/integration.
//   --hang           → never exits (for timeout/kill tests)
// The prompt is read from argv but is not required.

import { resolveEmitBody } from "./structured-shared.mjs";

const args = process.argv.slice(2);

/**
 * The structured body this fixture should emit (D-49): a schema-valid (or, with --emit-malformed, a
 * deliberately invalid) markdown+frontmatter body for the requested kind / engine phase, or
 * undefined when no emit/phase mode applies. Shared with the other fixtures (structured-shared.mjs).
 */
const emitBody = resolveEmitBody("gemini", args);

if (args.includes("--hang")) {
  // Never exit — lets a wall-clock timeout test kill us.
  setInterval(() => {}, 1e9);
} else if (emitBody !== undefined) {
  // Structured-emit mode (D-49): docs success shape, `response` is the schema-valid (or
  // --emit-malformed) markdown+frontmatter body for the requested kind / engine phase.
  process.stdout.write(
    JSON.stringify({
      response: emitBody,
      stats: { models: {}, tools: {} },
    }),
  );
  process.exit(0);
} else if (args.includes("--fail-auth")) {
  // Auth method not selected: the {error} JSON came out on STDERR live, exit 41 (undocumented).
  process.stderr.write(
    JSON.stringify({
      session_id: "abc-123",
      error: {
        type: "Error",
        message:
          "Please set an Auth method in your ~/.gemini/settings.json or specify GEMINI_API_KEY",
        code: 41,
      },
    }),
  );
  process.exit(41);
} else if (args.includes("--untrusted")) {
  // Trusted-directory gate: plain colored text on STDERR, exit 55 (undocumented).
  process.stderr.write(
    "Gemini CLI is not running in a trusted directory. Use --skip-trust to proceed.",
  );
  process.exit(55);
} else if (args.includes("--rate-limit")) {
  process.stderr.write(
    JSON.stringify({
      error: { code: 429, message: "RESOURCE_EXHAUSTED: Too Many Requests" },
    }),
  );
  process.exit(1);
} else if (args.includes("--bad-json")) {
  process.stdout.write("not json");
  process.exit(0);
} else {
  // Happy path — docs success shape on STDOUT.
  process.stdout.write(
    JSON.stringify({
      response: "pong",
      stats: { models: {}, tools: {} },
    }),
  );
  process.exit(0);
}
