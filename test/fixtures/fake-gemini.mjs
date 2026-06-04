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
//   --hang           → never exits (for timeout/kill tests)
// The prompt is read from argv but is not required.

const args = process.argv.slice(2);

if (args.includes("--hang")) {
  // Never exit — lets a wall-clock timeout test kill us.
  setInterval(() => {}, 1e9);
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
