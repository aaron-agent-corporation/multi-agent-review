// Shared structured-frontmatter bodies for the fake CLIs (D-49 hermetic mode). Keeping the body
// generators in ONE module guarantees fake-claude / fake-codex / fake-gemini stay byte-aligned in
// what they emit per phase. Each generator returns a markdown-plus-YAML-frontmatter STRING that the
// engine writes verbatim as the artifact body; gray-matter then parses the frontmatter and the
// 04-01 zod schema validates it.
//
// Phase detection: the engine sends a thin prompt prefixed with `[phase:<name>]` (see
// src/protocol/phases.ts thinPrompt). The fixtures parse that tag so the engine→fixture path emits
// the right structured artifact WITHOUT the prompt carrying the format contract. The explicit
// `--emit <kind>` / `--emit-malformed <kind>` flags drive the same generators directly for the
// validation-retry test and the Task-3 verify command.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * PROMPT-ECHO mechanism (PROT-05 gated-feedback test). When `MAR_ECHO_PROMPT_DIR` is set, append the
 * full prompt argv this fixture received to `<dir>/<author>.log` (one line per invocation). The gated
 * feedback test sets this dir then asserts the human steering note appears ONLY in the prompt for the
 * phase AFTER the feedback boundary — proving the note reached exactly the next phase's prompt (D-51)
 * and no other. A no-op when the env is unset, so every other test is unaffected.
 */
export function maybeEchoPrompt(author, args) {
  const dir = process.env.MAR_ECHO_PROMPT_DIR;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    // ONE physical line per invocation: flatten any newlines inside the prompt argv (the injected
    // feedback steering block spans lines) so the test can analyze the prompt per-invocation.
    const flat = args.join(" ").replace(/\r?\n/g, " ⏎ ");
    appendFileSync(join(dir, `${author}.log`), `${flat}\n`, "utf8");
  } catch {
    // best-effort: an echo failure must never crash a fixture.
  }
}

/** Extract the phase name from a `[phase:<name>]` prompt tag in argv, or undefined. */
export function phaseFromArgs(args) {
  for (const a of args) {
    const m = /\[phase:([a-z]+)\]/.exec(a);
    if (m) return m[1];
  }
  return undefined;
}

/** Value following a flag (e.g. `--emit review` → "review"), or undefined when absent. */
export function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/**
 * The agent this fixture proposes as the integration base (EvaluationFrontmatter.proposedBase,
 * IntegrationFrontmatter.base). Resolution order (RSLV-02, Open Q3):
 *   1. MAR_EMIT_BASES — a JSON map `{"<author>":"<base>", ...}`; when this author has an entry, use
 *      it. This is the PER-AUTHOR steering the majority tests need: a 2-1 split is produced by mapping
 *      different authors to different bases. A malformed/non-object value is ignored (falls through)
 *      rather than throwing, so a bad env never crashes a fixture.
 *   2. MAR_EMIT_BASE — the existing SINGLE shared base (04-04 convergence test): every fixture agrees
 *      on one base. Honored only when MAR_EMIT_BASES did not map this author, so existing tests using
 *      MAR_EMIT_BASE are unaffected.
 *   3. the fixture's own author — so an unsteered run is still schema-valid.
 */
export function proposedBase(author) {
  const basesJson = process.env.MAR_EMIT_BASES;
  if (basesJson) {
    try {
      const map = JSON.parse(basesJson);
      if (map && typeof map === "object" && typeof map[author] === "string") {
        return map[author];
      }
    } catch {
      // malformed MAR_EMIT_BASES → ignore, fall through to MAR_EMIT_BASE / author
    }
  }
  return process.env.MAR_EMIT_BASE || author;
}

/** Build a markdown artifact: YAML frontmatter block + a short human-readable body. */
function withFrontmatter(frontmatter, body) {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

/**
 * A SCHEMA-VALID structured body for `kind`, authored by `author`. Matches the 04-01 schemas
 * (review/response/evaluation/integration). For any other kind (draft/validation/unknown) returns a
 * plain tagged marker — those phases have no validate gate.
 */
export function structuredBody(kind, author) {
  switch (kind) {
    case "review":
      return withFrontmatter(
        [
          "phase: review",
          `author: ${author}`,
          "targets: peer-draft",
          "issues:",
          "  - n: 1",
          "    severity: P1",
          "    question: Does the proposal handle the empty-input case?",
        ].join("\n"),
        `# Review by ${author}\n\nOne concrete blocking question raised.`,
      );
    case "response":
      return withFrontmatter(
        [
          "phase: response",
          `author: ${author}`,
          "reviewOf: peer-review",
          "responses:",
          "  - verdict: accept",
          "    issueRef: 1",
        ].join("\n"),
        `# Response by ${author}\n\nAccepted the raised issue.`,
      );
    case "evaluation":
      return withFrontmatter(
        [
          "phase: evaluation",
          `author: ${author}`,
          "round: 1",
          `proposedBase: ${proposedBase(author)}`,
          "remainingDisagreements: []",
        ].join("\n"),
        `# Evaluation by ${author}\n\nNo remaining disagreements — converged.`,
      );
    case "integration":
      return withFrontmatter(
        [
          "phase: integration",
          `author: ${author}`,
          `base: ${proposedBase(author)}`,
          "additions:",
          "  - verdict: merged",
          "    additionRef: issue-1",
        ].join("\n"),
        `# Integrated document by ${author}\n\nMerged the agreed addition into the base.`,
      );
    default:
      // draft / validation / unknown: no validate gate — a tagged marker is sufficient.
      return `${author}:${kind}`;
  }
}

/**
 * A SCHEMA-VIOLATING structured body for `kind` (drives the D-38 one-retry path). The frontmatter is
 * deliberately malformed for the kind's 04-01 schema (e.g. an out-of-range severity, a
 * reject-with-reason missing its required reason).
 */
export function malformedBody(kind, author) {
  switch (kind) {
    case "review":
      return withFrontmatter(
        [
          "phase: review",
          `author: ${author}`,
          "targets: peer-draft",
          "issues:",
          "  - n: 1",
          "    severity: P9", // INVALID: severity enum is P1|P2|P3
          "    question: malformed severity on purpose",
        ].join("\n"),
        `# Malformed review by ${author}`,
      );
    case "response":
      return withFrontmatter(
        [
          "phase: response",
          `author: ${author}`,
          "reviewOf: peer-review",
          "responses:",
          "  - verdict: reject-with-reason", // INVALID: missing required `reason`
          "    issueRef: 1",
        ].join("\n"),
        `# Malformed response by ${author}`,
      );
    case "evaluation":
      return withFrontmatter(
        [
          "phase: evaluation",
          `author: ${author}`,
          "round: 0", // INVALID: round must be a positive int
          `proposedBase: ${proposedBase(author)}`,
          "remainingDisagreements: []",
        ].join("\n"),
        `# Malformed evaluation by ${author}`,
      );
    case "integration":
      return withFrontmatter(
        [
          "phase: integration",
          `author: ${author}`,
          "base: peer-draft",
          "additions:",
          "  - verdict: merged-with-change", // INVALID: missing required `change`
          "    additionRef: issue-1",
        ].join("\n"),
        `# Malformed integration by ${author}`,
      );
    default:
      return `${author}:${kind}:malformed`;
  }
}

/**
 * FAIL-ONCE marker mechanism (PROT-06 / D-57 resume tests). When the env `MAR_FAIL_ONCE` names this
 * author AND a marker file exists at `MAR_FAIL_ONCE_MARKER`, this author's engine-driven turn emits a
 * MALFORMED structured body for the current phase — so its turn fails validation (after the one
 * retry) and the agent is dropped. The TEST controls the toggle: it creates the marker before the
 * FIRST `mar run` (the agent fails, the run fails below the vendor floor), then DELETES the marker
 * before `mar resume` (the agent now emits a valid turn and rejoins with the FULL roster, D-57).
 *
 * Marker-file (not env-toggle) is the portable form: the same env is passed to BOTH `mar` invocations
 * via `process.env`, and only the marker's presence — which the test flips between runs — changes the
 * behavior. Returns the malformed body when armed for an engine phase, else undefined (fall through).
 */
function failOnceBody(author, args) {
  if (process.env.MAR_FAIL_ONCE !== author) return undefined;
  const marker = process.env.MAR_FAIL_ONCE_MARKER;
  if (!marker || !existsSync(marker)) return undefined;
  const phase = phaseFromArgs(args);
  if (phase === undefined) return undefined;
  return malformedBody(phase, author);
}

/**
 * RE-LITIGATION mode (RCRD-02 / D-64 enforcement test). Two env knobs steer it:
 *   MAR_RELITIGATE_RESPONSE=<author>  → during the RESPONSE phase, that author SETTLES a fork by
 *       emitting a `reject-with-reason` for issue 1 (the engine appends `response-<author>-issue-1`
 *       to shared/resolved-decisions.md with resolver "convergence").
 *   MAR_RELITIGATE_ID=<id>            → during the INTEGRATION phase, the integrator's addition names
 *       `<id>` as its additionRef — REOPENING that settled decision. The engine's enforcement drops
 *       the position with a `re-litigation` reason and continues.
 * Returns a body when armed for the matching phase, else undefined (fall through).
 */
function relitigationBody(author, args) {
  const phase = phaseFromArgs(args);
  if (phase === "response" && process.env.MAR_RELITIGATE_RESPONSE === author) {
    return withFrontmatter(
      [
        "phase: response",
        `author: ${author}`,
        "reviewOf: peer-review",
        "responses:",
        "  - verdict: reject-with-reason",
        "    issueRef: 1",
        '    reason: "rejecting issue 1 — this is the SETTLED fork"',
      ].join("\n"),
      `# Response by ${author}\n\nRejected issue 1 with a reason — settles the fork.`,
    );
  }
  if (phase === "integration" && process.env.MAR_RELITIGATE_ID) {
    const settledId = process.env.MAR_RELITIGATE_ID;
    return withFrontmatter(
      [
        "phase: integration",
        `author: ${author}`,
        `base: ${proposedBase(author)}`,
        "additions:",
        "  - verdict: merged",
        `    additionRef: ${settledId}`,
      ].join("\n"),
      `# Integrated document by ${author}\n\nAddition reopens settled ${settledId} (re-litigation).`,
    );
  }
  return undefined;
}

/**
 * LEDGER-READ ECHO mode (RCRD-02 / D-62 inject test). When `MAR_LEDGER_ECHO_DIR` and
 * `MAR_LEDGER_ECHO_ID` are set, on EVERY invocation this fixture reads `shared/resolved-decisions.md`
 * (relative to cwd — non-scoped phases run in the run dir) and appends one line to
 * `<dir>/<author>.echo` reporting whether the given decision id was visible: `SAW <id>` / `MISSED <id>`.
 * Proves the seeded directive's target (the ledger) is actually available to a later-phase agent. A
 * best-effort no-op when the env is unset or the file is absent.
 *
 * Non-scoped phases run with cwd set to the run dir, so the ledger is normally available directly
 * at `shared/resolved-decisions.md`. The older project-cwd fallback is kept for fixture compatibility.
 */
function maybeEchoLedger(author) {
  const dir = process.env.MAR_LEDGER_ECHO_DIR;
  const id = process.env.MAR_LEDGER_ECHO_ID;
  if (!dir || !id) return;
  let saw = false;
  try {
    const direct = join("shared", "resolved-decisions.md");
    if (existsSync(direct) && readFileSync(direct, "utf8").includes(id)) {
      saw = true;
    }
    let runIds = [];
    try {
      runIds = readdirSync("runs");
    } catch {
      runIds = [];
    }
    for (const rid of runIds) {
      if (saw) break;
      const p = join("runs", rid, "shared", "resolved-decisions.md");
      if (existsSync(p) && readFileSync(p, "utf8").includes(id)) {
        saw = true;
        break;
      }
    }
  } catch {
    saw = false;
  }
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${author}.echo`), `${saw ? "SAW" : "MISSED"} ${id}\n`, "utf8");
  } catch {
    // best-effort: an echo failure must never crash a fixture.
  }
}

/**
 * Resolve the body a fixture should emit, given its `author` and argv. Honors (in priority order):
 *   MAR_FAIL_ONCE (env)      → malformed body for the engine phase while the marker file exists
 *                              (resume fail-once mechanism, D-57)
 *   --emit-malformed <kind>  → malformed structured body (validation-retry RED path)
 *   --emit <kind>            → schema-valid structured body for <kind>
 *   [phase:<name>] tag       → schema-valid structured body for the engine-driven phase
 * Returns undefined when none apply (the caller falls through to its other modes).
 */
export function resolveEmitBody(author, args) {
  // Record the received prompt when echo mode is armed (gated-feedback test, no-op otherwise).
  maybeEchoPrompt(author, args);
  // Record whether the resolved-decisions ledger is visible (D-62 inject test, no-op otherwise).
  maybeEchoLedger(author);
  // Re-litigation mode (D-64 enforce test): settle a fork in response, reopen it in integration.
  const relit = relitigationBody(author, args);
  if (relit !== undefined) return relit;
  const failOnce = failOnceBody(author, args);
  if (failOnce !== undefined) return failOnce;
  const malformedKind = flagValue(args, "--emit-malformed");
  if (malformedKind !== undefined) return malformedBody(malformedKind, author);
  const emitKind = flagValue(args, "--emit");
  if (emitKind !== undefined) return structuredBody(emitKind, author);
  const phase = phaseFromArgs(args);
  if (phase !== undefined) return structuredBody(phase, author);
  return undefined;
}
