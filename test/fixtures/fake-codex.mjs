#!/usr/bin/env node
// Fake `codex` CLI fixture for adapter/e2e tests — never burns real credits.
// Mirrors the VERIFIED `codex exec --json` NDJSON shape (codex-cli 0.128.0, RESEARCH.md):
// one JSON object per stdout line. Modes (selected via argv flags):
//   (default/happy)  → thread.started, turn.started, item.completed{agent_message,"pong"},
//                      turn.completed{usage}; exit 0
//   --fail-auth      → repeated error{401 Unauthorized} events + turn.failed; exit 1
//   --rate-limit     → turn.failed with a 429/RESOURCE_EXHAUSTED message; exit 1 (retry test)
//   --rate-limit-once→ STATEFUL: first invocation 429/turn.failed (exit 1), every later
//                      invocation succeeds. State is a marker file under MAR_FIXTURE_STATE_DIR
//                      (the test injects a fresh temp dir), so the SAME fixture exercises the
//                      transient-then-ok retry path across separate adapter spawns (D-25).
//   --bad-json       → writes "not json" to stdout, exit 0 (no parseable terminal event)
//   --emit <kind>    → happy NDJSON envelope, but the agent_message text is the kind-tagged
//                      marker "codex:<kind>" so a multi-phase run yields distinct per-phase
//                      artifacts while preserving the verified NDJSON shape. (additive.)
//   MAR_PLANTED_MODE=1 (env) → A/B INDEPENDENCE PROOF mode (test/planted-error.test.ts), codex twin
//                      of the fake-claude logic. Env-activated (the injectable `bin` is split on the
//                      first whitespace only, so extra bin flags can't survive). Output depends on
//                      the phase (parsed from the prompt positional `phase: <name>`) AND on what the
//                      agent can SEE on the filesystem:
//                        • draft  → agent_message "VALUE=<V>", <V> = this agent's value from the JSON
//                                   env map MAR_PLANTED_VALUES keyed by the scoped cwd basename
//                                   (work/<agent>/).
//                        • review → reads peer drafts promoted into ./shared/, collects VALUE=
//                                   tokens, and emits "DISCREPANCY values=..." on disagreement or
//                                   "AGREED value=..." when they match. Independence (a scoped draft
//                                   phase) is what lets a divergent value reach shared/ and surface
//                                   the discrepancy a shared-consensus control would mask.
//                        • other  → "codex:<phase>".
//                      Hermetic: reads only local files under cwd + env.
//   --hang           → never exits (for timeout/kill tests)
// The prompt is read from argv but is not required.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);

/** Value following `--emit` (e.g. "draft"), or undefined when the flag is absent. */
function emitKind() {
  const i = args.indexOf("--emit");
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** True when the A/B independence-proof mode is active (env-activated; see header). */
function plantedMode() {
  return process.env.MAR_PLANTED_MODE === "1";
}

/** This agent's privately-held draft value from MAR_PLANTED_VALUES keyed by scoped cwd basename. */
function plantedValue() {
  try {
    const map = JSON.parse(process.env.MAR_PLANTED_VALUES ?? "{}");
    return map[basename(process.cwd())] ?? "none";
  } catch {
    return "none";
  }
}

/** The protocol phase, parsed from the engine's prompt positional `phase: <name>` in argv. */
function phaseFromArgv() {
  for (const a of args) {
    const m = /phase:\s*(\w+)/.exec(a);
    if (m) return m[1];
  }
  return undefined;
}

/** Locate the run's shared/ dir; probe ./shared then runs/<id>/shared (see fake-claude). */
function sharedDir() {
  const direct = join(process.cwd(), "shared");
  if (existsSync(direct)) return direct;
  const runsDir = join(process.cwd(), "runs");
  if (existsSync(runsDir)) {
    for (const id of readdirSync(runsDir)) {
      const candidate = join(runsDir, id, "shared");
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Distinct VALUE= tokens across every promoted peer draft under the run's shared/ (see fake-claude). */
function peerValues() {
  const dir = sharedDir();
  if (!dir) return [];
  const values = new Set();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith("-draft.md")) continue;
    const body = readFileSync(join(dir, name), "utf8");
    const m = /VALUE=(\S+)/.exec(body);
    if (m) values.add(m[1]);
  }
  return [...values];
}

/** Write one NDJSON event line to stdout. */
function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** Emit a verified NDJSON success sequence whose agent_message text is `body`, then exit 0. */
function emitMessage(body) {
  emit({ type: "thread.started", thread_id: "019e941a-ok" });
  emit({ type: "turn.started" });
  emit({
    type: "item.completed",
    item: { id: "item_0", type: "agent_message", text: body },
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

/** Emit the happy-path NDJSON sequence ("pong") and exit 0. */
function emitHappy() {
  emitMessage("pong");
}

if (args.includes("--hang")) {
  // Never exit — lets a wall-clock timeout test kill us.
  setInterval(() => {}, 1e9);
} else if (plantedMode()) {
  // A/B independence proof: phase- and filesystem-aware output (see header).
  const phase = phaseFromArgv();
  if (phase === "draft") {
    emitMessage(`VALUE=${plantedValue()}`);
  } else if (phase === "review") {
    const vals = peerValues();
    emitMessage(
      vals.length > 1
        ? `DISCREPANCY values=${vals.join(",")}`
        : `AGREED value=${vals[0] ?? "none"}`,
    );
  } else {
    emitMessage(`codex:${phase ?? "unknown"}`);
  }
} else if (emitKind() !== undefined) {
  // Per-phase marker mode: same verified NDJSON success sequence, agent_message tagged by kind.
  emit({ type: "thread.started", thread_id: "019e941a-ok" });
  emit({ type: "turn.started" });
  emit({
    type: "item.completed",
    item: { id: "item_0", type: "agent_message", text: `codex:${emitKind()}` },
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
} else if (args.includes("--rate-limit-once")) {
  // Stateful: fail transiently on the FIRST spawn, succeed on every spawn after. The marker
  // lives under MAR_FIXTURE_STATE_DIR so the test controls isolation and the retry wrapper sees
  // attempt 1 fail (429) then attempt 2 succeed across separate processes.
  const stateDir = process.env.MAR_FIXTURE_STATE_DIR;
  const marker = stateDir ? join(stateDir, "fake-codex-rate-limit-once.flag") : undefined;
  if (marker && !existsSync(marker)) {
    if (stateDir && !existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    writeFileSync(marker, "1");
    emit({ type: "thread.started", thread_id: "019e941a-rate-once" });
    emit({ type: "turn.started" });
    emit({
      type: "turn.failed",
      error: { message: "429 Too Many Requests: RESOURCE_EXHAUSTED" },
    });
    process.exit(1);
  }
  emitHappy();
} else if (args.includes("--bad-json")) {
  process.stdout.write("not json");
  process.exit(0);
} else {
  // Happy path — verified NDJSON shape.
  emitHappy();
}
