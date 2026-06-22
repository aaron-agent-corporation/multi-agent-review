#!/usr/bin/env node
// Fake `grok` CLI fixture for adapter/preflight tests. It mirrors the Grok CLI headless JSON
// contract used by the adapter: `grok -p <prompt> --output-format json`.

import { resolveEmitBody } from "./structured-shared.mjs";

const args = process.argv.slice(2);
const emitBody = resolveEmitBody("grok", args);

if (args.includes("--version")) {
  process.stdout.write("grok 0.1.0\n");
  process.exit(0);
} else if (args.includes("--hang")) {
  setInterval(() => {}, 1e9);
} else if (emitBody !== undefined) {
  process.stdout.write(
    JSON.stringify({
      response: emitBody,
      session_id: "grok-session-structured",
    }),
  );
  process.exit(0);
} else if (args.includes("--fail-auth")) {
  process.stderr.write(
    JSON.stringify({
      error: {
        message: "Authentication required: run grok login or set GROK_API_KEY",
      },
    }),
  );
  process.exit(1);
} else if (args.includes("--rate-limit")) {
  process.stderr.write(JSON.stringify({ error: { message: "429 Too Many Requests" } }));
  process.exit(1);
} else if (args.includes("--bad-json")) {
  process.stdout.write("not json");
  process.exit(0);
} else {
  process.stdout.write(
    JSON.stringify({
      response: "pong",
      session_id: "grok-session-1",
    }),
  );
  process.exit(0);
}
