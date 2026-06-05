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
//                      reliable per-run channel. The agent's output depends ON THE PHASE (parsed from
//                      the prompt positional `phase: <name>`, which DOES survive as a trailing argv
//                      element) AND on what it can SEE on the filesystem — independence becomes an
//                      observable fact:
//                        • draft   → body is "VALUE=<V>", where <V> is this agent's privately-held
//                                    value, looked up from the JSON env map MAR_PLANTED_VALUES keyed
//                                    by the agent name DERIVED FROM the scoped cwd basename
//                                    (work/<agent>/ — the draft phase is the only per-agent cwd).
//                        • review  → the agent reads every peer draft promoted into ./shared/,
//                                    collects their VALUE= lines, and emits "DISCREPANCY values=..."
//                                    when they DISAGREE or "AGREED value=..." when they all match.
//                                    A scoped (independent) draft phase lets a divergent value reach
//                                    shared/, so the discrepancy surfaces; a shared-consensus control
//                                    where every agent saw one consensus draft yields agreement and
//                                    MASKS the planted error.
//                        • other   → body is the phase-tagged marker "claude:<phase>".
//                      Hermetic: reads only local files under cwd + env, never a network/real model.
//   --hang           → never exits (for timeout/kill tests)
// The prompt is read from argv but is not required.

import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/**
 * This agent's privately-held draft value: MAR_PLANTED_VALUES (JSON map agent→value) looked up by
 * the agent name derived from the scoped cwd basename (work/<agent>/). Falls back to "none".
 */
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

/**
 * Locate the run's shared/ dir (where drafts are promoted at the draft->review boundary). At review
 * the agent's cwd is the WORKDIR (review is unscoped), so shared/ lives at runs/<id>/shared/; a
 * test may also point cwd straight at a run dir, where ./shared/ is a direct child. Probe both.
 */
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

/**
 * Distinct VALUE= tokens across every promoted peer draft under the run's shared/ dir. Independence
 * is observable here: a scoped draft phase lets a divergent value land in shared/, so a value
 * mismatch is detectable at review; a shared-consensus control yields one value and masks the
 * planted error. Returns [] when no shared/ drafts are present.
 */
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
  // A/B independence proof: phase- and filesystem-aware output (see header).
  const phase = phaseFromArgv();
  if (phase === "draft") {
    emitResult(`VALUE=${plantedValue()}`);
  } else if (phase === "review") {
    const vals = peerValues();
    emitResult(
      vals.length > 1
        ? `DISCREPANCY values=${vals.join(",")}`
        : `AGREED value=${vals[0] ?? "none"}`,
    );
  } else {
    emitResult(`claude:${phase ?? "unknown"}`);
  }
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
