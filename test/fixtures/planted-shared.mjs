// ============================================================================================
// Shared planted-error fixture mechanics for the A/B independence proof (CR-02).
//
// Both fake CLIs (fake-claude.mjs, fake-codex.mjs) import these helpers so the control and
// treatment arms are driven by IDENTICAL, falsifiable disk behaviour rather than per-fixture
// copies that could drift. The whole point of the A/B is that the discrepancy/agreement each arm
// reports must EMERGE FROM WHAT THE FIXTURES ACTUALLY READ OFF DISK — never from an injected
// constant alone — so a regression in the isolation mechanism (scope.ts) is observable.
//
// Two orthogonal axes, both env-activated (the injectable `bin` is split on the first whitespace
// only, so extra bin flags can't survive — env is the reliable per-run channel):
//
//   • DRAFT-PHASE PEER VISIBILITY PROBE (always on in planted mode). Before drafting, the agent
//     lists its OWN scoped cwd (work/<agent>/) and records every peer draft it can see there to
//     work/<agent>/peer-visibility.json. PROT-04 guarantees this is EMPTY: a scoped draft dir is
//     seeded with only input.md, so a peer draft can never appear. The treatment test asserts the
//     probe is empty — if scope.ts ever leaked a peer draft into work/<agent>/ (the exact
//     confidentiality failure the phase exists to prevent), the probe would be NON-empty and the
//     treatment test MUST fail. This is the falsifiability hook the original A/B lacked.
//
//   • SHARED-CONTEXT CONTROL (MAR_SHARED_CONTEXT=1). The control arm GENUINELY bypasses isolation:
//     during drafting each agent reads peer drafts from a shared, peer-visible location
//     (work/_shared_drafts/) and ANCHORS its emitted value onto the first peer draft already
//     present there (the consensus). The value it promotes is therefore DERIVED FROM PEER WORK READ
//     OFF DISK, not from its own env constant — modelling the case study's shared-context failure
//     mode where every agent echoes one consensus draft. Cross-review then sees a single value →
//     AGREED → the planted error is MASKED, and that masking is a real consequence of context
//     sharing, not of two fixtures handed identical constants. The treatment arm sets no such env,
//     keeps real scoped isolation, and its divergent values surface the discrepancy.
//
// Hermetic: reads/writes only local files under the run dir; never a network/real model.
// ============================================================================================

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Busy-wait `ms` milliseconds synchronously (the fixtures are tiny, synchronous CLIs). */
function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // spin — bounded by the caller's retry budget.
  }
}

/** The agent names participating in this run, from the MAR_PLANTED_VALUES map keys. */
function plantedAgents() {
  try {
    return Object.keys(JSON.parse(process.env.MAR_PLANTED_VALUES ?? "{}"));
  } catch {
    return [];
  }
}

/** True when the A/B independence-proof mode is active (env-activated). */
export function plantedMode() {
  return process.env.MAR_PLANTED_MODE === "1";
}

/** True when the control's shared-context (isolation-bypassing) draft path is active. */
export function sharedContextMode() {
  return process.env.MAR_SHARED_CONTEXT === "1";
}

/** This agent's name, derived from the scoped cwd basename (work/<agent>/). */
export function agentName() {
  return basename(process.cwd());
}

/** The protocol phase, parsed from the engine's prompt positional `phase: <name>` in argv. */
export function phaseFromArgv(args) {
  for (const a of args) {
    const m = /phase:\s*(\w+)/.exec(a);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * This agent's privately-held draft value: MAR_PLANTED_VALUES (JSON map agent→value) looked up by
 * the agent name derived from the scoped cwd basename. Falls back to "none".
 */
export function plantedValue() {
  try {
    const map = JSON.parse(process.env.MAR_PLANTED_VALUES ?? "{}");
    return map[agentName()] ?? "none";
  } catch {
    return "none";
  }
}

/**
 * The run dir, derived from the scoped draft cwd. During the draft phase cwd is
 * runs/<id>/work/<agent>/, so the run dir is two levels up. Returns undefined if the layout does
 * not match (e.g. an unscoped phase), in which case the caller skips the disk-coupled behaviour.
 */
export function runDirFromDraftCwd() {
  const cwd = process.cwd();
  const work = dirname(cwd); // runs/<id>/work
  if (basename(work) !== "work") return undefined;
  return dirname(work); // runs/<id>
}

/** Parse the agent prefix from a draft filename `<seq>-<agent>-draft.md`, or null if it doesn't match. */
function agentFromDraftName(name) {
  const m = /^\d+-(.+)-draft\.md$/.exec(name);
  return m ? m[1] : null;
}

/**
 * Falsifiability probe (CR-02). List the agent's OWN scoped cwd and record every PEER draft visible
 * there (a draft whose agent prefix is not this agent) to work/<agent>/peer-visibility.json. Under
 * PROT-04 this is always empty; a non-empty probe means isolation leaked a peer draft into the
 * scoped dir. The treatment test reads these files and asserts zero peer visibility.
 */
export function recordPeerVisibilityProbe() {
  const self = agentName();
  let peers = [];
  try {
    peers = readdirSync(process.cwd())
      .filter((n) => n.endsWith("-draft.md"))
      .map(agentFromDraftName)
      .filter((a) => a !== null && a !== self);
  } catch {
    peers = [];
  }
  const runDir = runDirFromDraftCwd();
  if (!runDir) return peers;
  try {
    const probePath = join(runDir, "work", self, "peer-visibility.json");
    writeFileSync(probePath, JSON.stringify({ agent: self, peerDraftsVisible: peers }), "utf8");
  } catch {
    // Best-effort; the probe file is a test observability aid, not load-bearing for the run.
  }
  return peers;
}

/**
 * Resolve the draft value to EMIT for this agent.
 *
 *   • Treatment (default): emit the agent's own privately-held value. Real scoped isolation means
 *     the agent cannot see any peer draft while drafting (recordPeerVisibilityProbe proves it),
 *     so divergent values survive to promotion and surface the discrepancy at review.
 *   • Control (MAR_SHARED_CONTEXT=1): GENUINELY share context. Every agent deposits its own draft
 *     into the shared, peer-visible work/_shared_drafts/ dir, then waits (bounded) until every
 *     participating agent's draft is present and ANCHORS on a deterministic CONSENSUS: the value of
 *     the lexicographically-first agent's deposited draft. Because the draft phase fans out
 *     concurrently, the wait makes the consensus race-independent — every agent converges on the
 *     SAME value READ OFF DISK from a peer, so divergent inputs collapse to one and the planted
 *     error is masked at cross-review. This is a real shared-context path, not identical constants.
 */
export function resolveDraftValue() {
  const own = plantedValue();
  if (!sharedContextMode()) return own;

  const runDir = runDirFromDraftCwd();
  if (!runDir) return own; // can't share context without a run dir layout — fall back.

  const sharedDraftDir = join(runDir, "work", "_shared_drafts");
  try {
    if (!existsSync(sharedDraftDir)) mkdirSync(sharedDraftDir, { recursive: true });
    // Deposit our own draft so peers can read it (shared context — isolation bypassed).
    writeFileSync(join(sharedDraftDir, `${agentName()}.draft`), `VALUE=${own}`, "utf8");

    // Wait (bounded) until every participant has deposited, so the consensus is race-independent.
    const expected = plantedAgents();
    const expectedFiles = new Set(expected.map((a) => `${a}.draft`));
    const deadline = Date.now() + 3000;
    let present = [];
    do {
      present = readdirSync(sharedDraftDir).filter((n) => expectedFiles.has(n));
      if (present.length >= expectedFiles.size) break;
      sleepSync(25);
    } while (Date.now() < deadline);

    // Deterministic consensus: the lexicographically-first agent's deposited value, read off disk.
    const leader = [...present].sort()[0];
    if (leader) {
      const body = readFileSync(join(sharedDraftDir, leader), "utf8").trim();
      const m = /^VALUE=(\S+)$/.exec(body);
      if (m) return m[1];
    }
  } catch {
    // If the shared write/read fails, degrade to the own value (still a valid run).
  }
  return own;
}

/** Distinct VALUE= tokens across every promoted peer draft under the run's shared/ dir. */
export function peerValues() {
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

/**
 * Locate the run's shared/ dir (where drafts are promoted at the draft->review boundary). At review
 * the agent's cwd is the WORKDIR (review is unscoped), so shared/ lives at runs/<id>/shared/; a
 * test may also point cwd straight at a run dir, where ./shared/ is a direct child. Probe both.
 */
export function sharedDir() {
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
 * Compute the planted-mode body for a given phase, running the shared disk-coupled mechanics:
 *   • draft  → record the peer-visibility probe, then emit "VALUE=<resolved>".
 *   • review → read promoted peer drafts, emit DISCREPANCY (disagree) or AGREED (match).
 *   • other  → a phase-tagged marker "<vendor>:<phase>".
 */
export function plantedBody(vendor, args) {
  const phase = phaseFromArgv(args);
  if (phase === "draft") {
    recordPeerVisibilityProbe();
    return `VALUE=${resolveDraftValue()}`;
  }
  if (phase === "review") {
    const vals = peerValues();
    return vals.length > 1
      ? `DISCREPANCY values=${vals.join(",")}`
      : `AGREED value=${vals[0] ?? "none"}`;
  }
  return `${vendor}:${phase ?? "unknown"}`;
}
