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
 * IntegrationFrontmatter.base). Steerable via MAR_EMIT_BASE so a convergence test (04-04) can make
 * every fixture agree on one base; defaults to the fixture's own author so an unsteered run is
 * still schema-valid.
 */
export function proposedBase(author) {
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
 * Resolve the body a fixture should emit, given its `author` and argv. Honors (in priority order):
 *   --emit-malformed <kind>  → malformed structured body (validation-retry RED path)
 *   --emit <kind>            → schema-valid structured body for <kind>
 *   [phase:<name>] tag       → schema-valid structured body for the engine-driven phase
 * Returns undefined when none apply (the caller falls through to its other modes).
 */
export function resolveEmitBody(author, args) {
  const malformedKind = flagValue(args, "--emit-malformed");
  if (malformedKind !== undefined) return malformedBody(malformedKind, author);
  const emitKind = flagValue(args, "--emit");
  if (emitKind !== undefined) return structuredBody(emitKind, author);
  const phase = phaseFromArgs(args);
  if (phase !== undefined) return structuredBody(phase, author);
  return undefined;
}
