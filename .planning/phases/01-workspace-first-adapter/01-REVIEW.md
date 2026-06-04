---
phase: 01-workspace-first-adapter
reviewed: 2026-06-04T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/adapters/adapter.ts
  - src/adapters/claude.ts
  - src/cli.ts
  - src/log/invocation.ts
  - src/schema/manifest.ts
  - src/schema/turn.ts
  - src/workspace/artifacts.ts
  - src/workspace/layout.ts
  - src/workspace/manifest.ts
  - test/claude-adapter.test.ts
  - test/e2e-invoke.test.ts
  - test/fixtures/fake-claude.mjs
  - test/invocation.test.ts
  - test/manifest.test.ts
  - test/workspace.test.ts
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
  fixed: 6
  remaining: 4
status: fixed
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** fixed (CR-01 + WR-01..WR-05 resolved; 4 Info findings remain out of scope)

## Summary

The workspace-first claude adapter is well-structured and the stated invariants are
largely honored: argv arrays only (no shell), run-id charset enforced, atomic temp+rename
writes, the verified ok-rule (`exitCode===0 && is_error===false`, never `result.type`),
no `--bare`, and `promptRef`-only logging. Tests cover the four adapter modes and the
workspace round-trips.

Adversarial review surfaced one correctness defect that breaks the artifact format
invariant (unescaped vendor data injected into YAML frontmatter), plus several robustness
and consistency gaps: divergent bin-splitting logic that breaks on paths with spaces, weak
`--timeout` parsing that silently accepts garbage, a seq-collision path that can overwrite
a prior artifact on a resumed run, and an audit log whose recorded `command` does not match
the argv actually spawned. None of the issues are shell-injection or run-id-escape
regressions — those invariants hold.

## Critical Issues

### CR-01: Unescaped vendor data injected into YAML frontmatter corrupts the artifact

**Resolved:** 9d33f73
**File:** `src/workspace/artifacts.ts:18-22`
**Issue:** `toFrontmatter` interpolates every value directly into the YAML block with no
escaping: `` `${k}: ${v}` ``. Several values are vendor-controlled — most notably
`sessionId`, which `cli.ts:123` copies verbatim from the claude CLI's JSON into the
frontmatter (`runId` is charset-constrained, but `sessionId` is not). A `sessionId` (or any
future string frontmatter field) containing a newline, a leading `---`, or a `: ` sequence
will break the frontmatter delimiters or inject arbitrary keys, e.g. a value of
`a\n---\ninjected: true` ends the frontmatter early and corrupts the body. Downstream
parsing (the project plans `gray-matter`) will then mis-read or fail on the artifact. Since
this violates the artifact-format invariant the whole workspace depends on, and the value
originates outside the orchestrator, it must be hardened before shipping.
**Fix:** Escape/quote scalar values, and reject control characters. Minimal approach —
serialize each value as a JSON string (valid YAML for scalars) and strip newlines:

```ts
function yamlScalar(v: string | number): string {
  if (typeof v === "number") return String(v);
  // JSON.stringify yields a quoted, escaped YAML-safe double-quoted scalar.
  return JSON.stringify(v.replace(/\r?\n/g, " "));
}
function toFrontmatter(fields: Record<string, string | number>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${yamlScalar(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}
```

## Warnings

### WR-01: `detectClaudeVersion` splits on all whitespace, breaking paths with spaces

**Resolved:** 2f18677
**File:** `src/cli.ts:41-42`
**Issue:** `bin.trim().split(/\s+/)` splits the injected `MAR_CLAUDE_BIN` on *every* run of
whitespace, then spawns `cmd[0]` with `cmd.slice(1)` as args. This contradicts
`splitBin` in `claude.ts:27-36`, which deliberately splits only once specifically so paths
containing spaces survive. The e2e harness sets
`MAR_CLAUDE_BIN="node /…/Active Projects/…/fake-claude.mjs"` and this repo's own path
contains a space ("Active Projects"), so version detection here would spawn
`node /…/Active` with a broken trailing arg. It is masked today only because the failure is
swallowed by the surrounding `try/catch` (returns `"unknown"`) and the fake fixture treats an
unrecognized `--version` invocation as the happy path. Two code paths interpreting the same
injected value differently is a latent bug.
**Fix:** Reuse the single splitting strategy. Export `splitBin` from `claude.ts` and call it
here instead of re-implementing with `split(/\s+/)`:

```ts
const { cmd, preArgs } = splitBin(bin);
const r = await execa(cmd, [...preArgs, "--version"], { reject: false, timeout: 10_000 });
```

### WR-02: `--timeout` silently accepts trailing garbage and sub-millisecond values

**Resolved:** 311ce9e
**File:** `src/cli.ts:63-67`
**Issue:** `Number.parseInt(opts.timeout, 10)` stops at the first non-digit and returns the
prefix, so `--timeout 500abc` becomes `500` and `--timeout 1e3` becomes `1` (a 1 ms
wall-clock timeout that will kill every real invocation). The only guard is
`Number.isNaN || <= 0`, neither of which catches these. Malformed timeout input is accepted
without error.
**Fix:** Validate the whole string and require a plausible minimum:

```ts
const timeoutMs = opts.timeout ? Number(opts.timeout) : DEFAULT_TIMEOUT_MS;
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  process.stderr.write(`error: --timeout must be a positive integer (ms)\n`);
  return 2;
}
```

### WR-03: Resumed-run seq can collide and overwrite a prior successful artifact

**Resolved:** c715b2f
**File:** `src/cli.ts:88`
**Issue:** On `--run`, `seq = manifest.artifacts.length + 1`. Because only *successful*
turns call `addArtifact`, the artifact count does not advance on failed/timed-out turns —
correct for the failure itself. But it means seq is derived purely from successes, so the
next turn always targets `<count+1>`. If turn N succeeds (artifact `00N`) and a later
resume re-runs against the same count, the deterministic filename
(`artifactName(seq, ...)`) plus the atomic write will silently overwrite an existing
artifact rather than failing or allocating a fresh slot. Seq should be monotonic over *all*
turns, not just successful ones.
**Fix:** Track the highest seq ever used (e.g. persist a `nextSeq`/`turnCount` on the
manifest, or derive seq from the max existing artifact seq + the count of logged
invocations), and refuse to overwrite an existing artifact path.

### WR-04: Audit log records a reconstructed argv, not the argv actually spawned

**Resolved:** c8db957
**File:** `src/cli.ts:112,147-154` (vs `src/adapters/claude.ts:14-16,63`)
**Issue:** The adapter spawns `["-p", promptText, "--output-format", "json"]`, but the
invocation log records `command = ["-p", promptRef, "--output-format", "json"]` —
a hand-rebuilt array that hardcodes the flag set and substitutes the prompt reference. This
keeps the prompt body out of the log (good, and consistent with D-15), but it means the
audit trail can silently diverge from what the adapter really executed: if the adapter's
flags change, the log will still claim the old argv. An audit record that does not reflect
the real command undermines the lineage guarantee.
**Fix:** Have the adapter return the redacted argv it used (prompt slot replaced with a
placeholder) as part of `TurnResult`, and log that, so the log and the spawn share one
source of truth instead of two independently-maintained literals.

### WR-05: `resolvePrompt` reads arbitrary filesystem paths as prompt content

**Resolved:** 7a7f495
**File:** `src/cli.ts:30-36`
**Issue:** Any `--prompt` value that happens to name an existing file is read with
`readFileSync(value, "utf8")` and sent to the model, with no size cap and no path
restriction. A literal prompt like `/etc/passwd`, `~/.aws/credentials`, or
`./.env` is silently turned into file contents rather than treated as text. While the
file-or-string overload is intended, the unbounded, unrestricted read is a footgun: a
user's literal string can accidentally exfiltrate a sensitive local file into a vendor
request.
**Fix:** Gate file-mode behind an explicit signal (e.g. `--prompt-file <path>` vs
`--prompt <string>`), or at minimum bound the read size and resolve/confine the path; treat
the value as a literal string by default unless file-mode was explicitly requested.

## Info

### IN-01: pino `level` field leaks into the audit record

**File:** `src/log/invocation.ts:41-42`
**Issue:** `base: undefined` and `timestamp: false` suppress pid/hostname/`time`, but pino
still emits `"level":30` on every record (confirmed in the on-disk
`invocations.ndjson`). It is harmless noise, but the comment claims "each line is exactly
the audit record," which is not quite true.
**Fix:** Either accept it as benign, or drop it via a custom serializer / a level-less
write so the line contains only the intended audit fields.

### IN-02: Relative-path derivation is fragile

**File:** `src/cli.ts:127`
**Issue:** `written.path.slice(runDir.length + 1)` assumes `written.path` is exactly
`runDir` + `/` + filename with no normalization differences. It works today but breaks if
`runDir` ever gains a trailing slash or `path.join` normalizes segments.
**Fix:** Use `path.relative(runDir, written.path)` for a normalization-safe result.

### IN-03: `splitBin` `existsSync` probe runs on every invocation

**File:** `src/adapters/claude.ts:32`
**Issue:** `splitBin` calls `existsSync(trimmed)` on the full bin string each invoke to
disambiguate a spaced path from a `node <script>` launcher. Correct, but it couples
binary resolution to a filesystem stat on a value that is usually the constant `"claude"`.
Minor; consider documenting that the production default never hits this branch (it has no
whitespace and short-circuits before the `existsSync` cost matters only for injected bins).
**Fix:** No change required; noted for clarity.

### IN-04: CLAUDE.md pins zod 3.23+ but the project ships zod 4

**File:** `src/schema/manifest.ts`, `src/schema/turn.ts` (project-wide)
**Issue:** `package.json` depends on `zod@^4` (installed 4.4.3) while CLAUDE.md's stack
table specifies "zod 3.23+". The two-arg `z.record(z.string(), z.string())` form used in
`manifest.ts:25` is valid in v4, so there is no runtime bug, but the documented version
contract is stale and could mislead future maintainers about API expectations.
**Fix:** Update CLAUDE.md's recommended-stack table to zod 4, or pin to 3.x if v3 behavior
was intended.

---

_Reviewed: 2026-06-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
