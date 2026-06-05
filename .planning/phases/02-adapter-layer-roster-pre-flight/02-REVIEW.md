---
phase: 02-adapter-layer-roster-pre-flight
reviewed: 2026-06-04T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - src/adapters/claude.ts
  - src/adapters/codex.ts
  - src/adapters/common.ts
  - src/adapters/gemini.ts
  - src/adapters/registry.ts
  - src/cli.ts
  - src/config.ts
  - src/gates.ts
  - src/init.ts
  - src/log/invocation.ts
  - src/preflight.ts
  - src/retry.ts
  - src/schema/config.ts
  - src/schema/preflight.ts
  - src/schema/turn.ts
  - test/adapter-stdin.test.ts
  - test/cli-roster.test.ts
  - test/cli-timeout.test.ts
  - test/codex-adapter.test.ts
  - test/config.test.ts
  - test/e2e-invoke.test.ts
  - test/fixtures/fake-codex.mjs
  - test/fixtures/fake-gemini.mjs
  - test/gates.test.ts
  - test/gemini-adapter.test.ts
  - test/init.test.ts
  - test/invocation.test.ts
  - test/preflight.test.ts
  - test/registry.test.ts
  - test/retry.test.ts
findings:
  critical: 0
  warning: 6
  info: 4
  total: 10
status: issues_found
fixed:
  - WR-01
  - WR-02
  - WR-03
  - WR-04
  - WR-05
  - WR-06
fixed_at: 2026-06-04T00:00:00Z
fixed_note: "All 6 warnings fixed (Critical+Warning scope). Info IN-01..04 remain open by scope. Full gate green: 213 tests pass, tsc clean, biome clean on touched files."
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-04T00:00:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

The adapter layer, roster config, retry seam, and pre-flight checks are generally well-constructed: argv is passed as arrays (no shell injection), the prompt body is kept out of the audit log via placeholder redaction, success rules require positive terminal signals rather than a single ambiguous field, and timeouts/kills are bounded by execa. Tests pin flags and exercise the failure paths.

No BLOCKER-tier defects were proven. However several WARNING-tier issues degrade correctness and robustness, the most important being (a) the prompt-redaction routine over-redacts when a prompt value collides with a pinned flag value, corrupting the audit log, and (b) the retry backoff can sleep up to 1.5x the documented/`DEFAULT_MAX_MS` cap because jitter is added *after* the cap is applied.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Backoff jitter is added after the cap, so actual sleep exceeds the documented `maxMs`

**Status:** FIXED (commit b831258) — jitter is now added to the RAW exponential value and `Math.min(cap, raw + jitter)` clamps the TOTAL, so `maxMs` is a true ceiling. The green-washing `retry.test.ts` assertion was rewritten and a dedicated cap-ceiling test (`maxMs is a TRUE ceiling`) was added that fails under the old cap-then-jitter code.

**File:** `src/retry.ts:117-119`
**Issue:** The cap is applied to `backoff` first, then jitter (up to `backoff/2`) is *added*:
```ts
const backoff = Math.min(cap, base * 2 ** (attempt - 1));
const jitter = Math.floor(Math.random() * (backoff / 2));
await sleep(ra ?? backoff + jitter);
```
With the default `DEFAULT_MAX_MS = 60_000`, the real maximum sleep is `60_000 * 1.5 = 90_000` ms, not the 60s the constant and its doc comment ("Backoff cap in ms (default ~60s)") promise. The cap is not actually a ceiling on the wait. The `retry.test.ts` backoff test (`expected * 1.5 + 1`) was written to the buggy behavior, so it green-washes the defect rather than catching it.
**Fix:** Cap *after* jitter, or clamp the total:
```ts
const raw = base * 2 ** (attempt - 1);
const jitter = Math.floor(Math.random() * (raw / 2));
await sleep(ra ?? Math.min(cap, raw + jitter));
```

### WR-02: `redactArgv` over-redacts when the prompt value collides with a pinned flag value

**Status:** FIXED (commit 23a1152) — `redactArgv` (value-based) was replaced with `redactArgvAt(argv, promptIndex)` (positional). Each adapter passes the known prompt index: claude/gemini `preArgs.length + 1` (slot after `-p`), codex `argv.length - 1` (trailing positional). A regression test redacts a prompt literally equal to `json` and asserts `--output-format json` survives intact.

**File:** `src/adapters/common.ts:46-48`
**Issue:** Redaction matches by exact string value and replaces *every* matching element:
```ts
return argv.map((a) => (a === promptText ? PROMPT_PLACEHOLDER : a));
```
If the prompt text happens to equal a literal already present in the argv — e.g. a user invokes with `--prompt json`, `--prompt read-only`, `--prompt --skip-trust`, or a prompt equal to the configured model name — the corresponding flag/value is also rewritten to `<prompt>` in the audit record. The persisted `redactedCommand` then no longer reflects the actual flag set, defeating the stated "single source of truth with the spawn" guarantee (WR-04 / D-15). This is an audit-integrity correctness bug (it does not leak the prompt, only corrupts the recorded command).
**Fix:** Redact by position, not value. The prompt index is known at build time per adapter (claude/gemini: index after `-p`; codex: last element). Pass that index into a positional redactor, e.g. `redactArgvAt(argv, promptIndex)`, so only the prompt slot is replaced regardless of its content.

### WR-03: Gemini error fallback can produce an empty-string `error` on a failed turn

**Status:** FIXED (commit 928c9ed) — the fallback now flows through `sanitizeGeminiError`, which uses `||` (empty-as-missing) so an empty stderr/message falls through to the `"gemini error"` constant instead of surfacing `error: ""`. Fixed jointly with Phase 3 WR-04 (same line). Regression test: exit-1 turn with empty stderr asserts `error === "gemini error"`.

**File:** `src/adapters/gemini.ts:103`
**Issue:**
```ts
error: ok ? undefined : (j.error?.message ?? result.stderr ?? "gemini error"),
```
`result.stderr` is always a string and is frequently `""` (e.g. when the failure is encoded purely in the parsed JSON `error` object that lacks a `message`, or an exit-nonzero with empty stderr). Because `""` is not nullish, the `?? "gemini error"` final fallback never fires when stderr is empty, so a failed turn can surface `error: ""`. Downstream, an empty error string degrades the human progress line (`(${reason})` becomes `()` in `cli.ts:270`) and weakens retry classification (the classifier's `t.error ?? ""` then defaults to fatal with no signal).
**Fix:** Treat empty as missing:
```ts
error: ok ? undefined : (j.error?.message || result.stderr || "gemini error"),
```

### WR-04: `parseTimeout` silently accepts hex and leading/trailing-whitespace forms

**Status:** FIXED (commit 1f5583e) — a `/^\d+(e\d+)?$/i` guard now gates the whole string BEFORE `Number()` coercion, rejecting hex (`0x10`), surrounding whitespace (`  500  `), and fractional forms while preserving the documented `1e3 → 1000` case the existing `cli-timeout.test.ts` pins. New tests cover the rejected hex/whitespace forms. (Note: the finding's suggested `/^\d+$/` regex would have broken the pre-existing `1e3` passing case, so a scientific-integer-aware regex was used instead — consistent with the task's "keep passing cases consistent" directive.)

**File:** `src/cli.ts:84-89`
**Issue:** The doc claims "the WHOLE string must be a clean integer," but `Number()` also coerces hex (`Number("0x1F4") === 500`), `"  500  "` (whitespace) → `500`, and `"1e3"` → `1000` (the last is explicitly allowed by the test). A `--timeout 0x10` is accepted as a 16ms timeout that would kill every real run — surprising and not "clean integer" input. The validation is stricter than `parseInt` but looser than the documented contract.
**Fix:** Gate on a decimal-integer regex before coercion:
```ts
if (!/^\d+$/.test(value.trim())) return null;
const ms = Number(value);
if (!Number.isInteger(ms) || ms <= 0) return null;
return ms;
```

### WR-05: `checkInstalled` and `detectVersion` disagree on what "installed" means

**Status:** FIXED (commit 9fc0895) — a single exported `probeVersion(bin)` helper in `preflight.ts` is now the only `<bin> --version` probe. `checkInstalled` and `cli.ts`'s `detectVersion` both delegate to it, applying ONE agreed rule (installed iff spawn succeeds AND `--version` stdout is non-empty; exit code deliberately excluded so a print-version-but-exit-nonzero CLI is treated consistently). The now-unused `execa`/`splitBin` imports were dropped from `cli.ts`. (Behavior change endorsed by the finding: the preflight install-check no longer requires `exitCode === 0`.)

**File:** `src/preflight.ts:131-141` and `src/cli.ts:96-110`
**Issue:** Two separate `<bin> --version` probes apply different success criteria. `checkInstalled` (preflight) requires `exitCode === 0` to consider the binary installed; `detectVersion` (invoke path) ignores exit code entirely and keys off non-empty stdout. A CLI that prints its version to stdout but exits non-zero (some tools do) would be recorded as installed by `invoke` but `installed:false` by `preflight`, producing contradictory machine state and a misleading install hint. The duplicated `execa(... "--version", {reject:false, timeout:10_000})` logic should be a single shared helper.
**Fix:** Extract one `probeVersion(bin)` helper with a single agreed-upon rule and call it from both sites.

### WR-06: `splitBin`'s `existsSync` check can misfire on a relative bin in a hostile cwd

**Status:** FIXED (commit 998dadf) — the `existsSync` literal-path branch is now gated behind a path-shape check (`isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")`), so a bare vendor name always flows to PATH resolution by execa regardless of cwd contents. Regression test plants a file named `claude` in a fresh cwd and asserts `splitBin("claude")` still returns the bare name.

**File:** `src/adapters/common.ts:20-29`
**Issue:** `splitBin` first does `if (existsSync(trimmed)) return { cmd: trimmed, preArgs: [] }`. For a production roster entry whose `bin` is a bare vendor name (e.g. `"claude"`), if the current working directory happens to contain a file or directory literally named `claude`, `existsSync("claude")` is true and the adapter will attempt to execute the relative path `./claude` instead of resolving `claude` on PATH. This is an unlikely but real path-confusion footgun driven by cwd contents. (Same applies to `codex`/`gemini`.)
**Fix:** Only treat the value as a literal path when it actually looks like a path (contains a separator or is absolute), e.g. `if ((trimmed.includes("/") || isAbsolute(trimmed)) && existsSync(trimmed))`. A bare vendor name then always flows to PATH resolution by execa.

## Info

### IN-01: `hintFor` switch has no default arm and relies on union exhaustiveness

**File:** `src/preflight.ts:120-128`
**Issue:** The `switch (vendor)` for the "probe" stage has cases for all three vendors but no `default`. It type-checks today because `vendor` is the closed union, but a future vendor added to the schema would compile and return `undefined` here (the function is typed `: string`), silently dropping the hint. Low risk while the union is enforced.
**Fix:** Add `default: return \`${vendor} probe failed (auth/responsiveness)\`;` for defense-in-depth, or an exhaustiveness `assertNever`.

### IN-02: `applySkipFailed` ignores its `_failed` argument entirely

**File:** `src/gates.ts:30-33`
**Issue:** The second parameter `_failed` is accepted but never read — the function only gates and returns `healthy`. The signature implies the failed set participates in the decision. It is harmless but the parameter is dead; a caller might assume failed agents are diffed/validated against healthy.
**Fix:** Either drop the parameter or document explicitly that it exists only for call-site symmetry/logging.

### IN-03: Duplicated per-vendor `CLASSIFY` map across two modules

**File:** `src/cli.ts:44-48` and `src/preflight.ts:104-108`
**Issue:** The identical `Record<AgentEntry["vendor"], Classify>` mapping (`claude→classifyClaude`, etc.) is defined twice. If a fourth vendor is added, both maps must be updated in lockstep; missing one is a latent bug. Mirrors the same drift risk the registry deliberately centralizes.
**Fix:** Export a single `CLASSIFY` (or `classifierFor(vendor)`) from `retry.ts` and import it in both places.

### IN-04: `logInvocation` constructs a fresh pino destination/logger on every call

**File:** `src/log/invocation.ts:37-49`
**Issue:** Each append opens a new sync `pino.destination` and logger instance for a single line. Correctness is fine (sync flush guarantees ordering and the tests pass), but per-call construction is wasteful and, on some platforms, repeatedly opening the same append fd can interact poorly under heavy parallel drafting (Phase 3 runs N agents concurrently). Flagged as a maintainability note, not a v1 correctness defect.
**Fix:** Consider a per-runDir cached destination, or document that single-line-per-call construction is intentional for the append-only audit trail.

---

_Reviewed: 2026-06-04T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
