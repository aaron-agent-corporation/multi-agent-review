#!/usr/bin/env node
// Fake `codex` CLI fixture for adapter/e2e tests — never burns real credits.
// Mirrors the VERIFIED `codex exec --json` NDJSON shape (codex-cli 0.128.0, RESEARCH.md):
// one JSON object per stdout line. Modes (selected via argv flags):
//   (default/happy)  → thread.started, turn.started, item.completed{agent_message,"pong"},
//                      turn.completed{usage}; exit 0
//   --fail-auth      → repeated error{401 Unauthorized} events + turn.failed; exit 1
//   --rate-limit     → turn.failed with a 429/RESOURCE_EXHAUSTED message; exit 1 (retry test)
//   --bad-json       → writes "not json" to stdout, exit 0 (no parseable terminal event)
//   --hang           → never exits (for timeout/kill tests)
// The prompt is read from argv but is not required.

const args = process.argv.slice(2);

/** Write one NDJSON event line to stdout. */
function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

if (args.includes("--hang")) {
  // Never exit — lets a wall-clock timeout test kill us.
  setInterval(() => {}, 1e9);
} else if (args.includes("--fail-auth")) {
  // Codex retries the endpoint internally before giving up — emit the 401 error a few times,
  // then the terminal turn.failed. exit 1.
  emit({ type: "thread.started", thread_id: "019e941a-fail" });
  emit({ type: "turn.started" });
  for (let i = 0; i < 3; i++) {
    emit({
      type: "error",
      message:
        "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
    });
  }
  emit({
    type: "turn.failed",
    error: {
      message:
        "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header",
    },
  });
  process.exit(1);
} else if (args.includes("--rate-limit")) {
  emit({ type: "thread.started", thread_id: "019e941a-rate" });
  emit({ type: "turn.started" });
  emit({
    type: "turn.failed",
    error: { message: "429 Too Many Requests: RESOURCE_EXHAUSTED" },
  });
  process.exit(1);
} else if (args.includes("--bad-json")) {
  process.stdout.write("not json");
  process.exit(0);
} else {
  // Happy path — verified NDJSON shape.
  emit({ type: "thread.started", thread_id: "019e941a-ok" });
  emit({ type: "turn.started" });
  emit({
    type: "item.completed",
    item: { id: "item_0", type: "agent_message", text: "pong" },
  });
  emit({
    type: "turn.completed",
    usage: {
      input_tokens: 19484,
      cached_input_tokens: 3456,
      output_tokens: 20,
      reasoning_output_tokens: 13,
    },
  });
  process.exit(0);
}
