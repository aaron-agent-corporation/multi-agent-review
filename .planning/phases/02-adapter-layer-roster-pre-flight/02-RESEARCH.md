# Phase 2: Adapter Layer + Roster + Pre-flight - Research

**Researched:** 2026-06-04
**Domain:** Multi-vendor CLI adapters (codex `exec --json` NDJSON, gemini `-p --output-format json`); vendor-agnostic timeout+retry wrapper; tiered pre-flight probe; zod roster config (`mar.config.json`); vendor-distinctness gate; PATH detection for `mar init`
**Confidence:** HIGH for codex live behavior (verified by live invocation against installed 0.128.0), HIGH for gemini failure/exit/auth-routing behavior (live), MEDIUM for gemini SUCCESS JSON shape (docs-only — could not produce a live success; see below), HIGH for the adapter pattern (extends the verified Phase-1 claude adapter), HIGH for library versions (already pinned in package.json).

## Summary

Phase 1 established the load-bearing contract: `AgentAdapter.invoke(TurnRequest) -> TurnResult`, the `splitBin` injectable-bin pattern, the `redactedCommand` audit invariant, the verified ok-rule discipline (never trust a single misleading field), and the fake-CLI fixture + flag-pinning test pattern. Phase 2 is overwhelmingly **"replicate that discipline twice more (codex, gemini) and wrap all three in three new vendor-agnostic layers: retry, preflight, roster."** The adapter contract does not change; no protocol-layer code is touched (ORCH-03 falls out of a vendor->adapter registry keyed by `vendor`).

This research was conducted by **live-invoking the installed codex 0.128.0 and gemini 0.45.0** on this machine (tiny "Reply with exactly: pong"-class prompts). Two findings materially change the plan and **contradict the optimistic assumption baked into STACK.md/CONTEXT.md** that all three CLIs are authenticated and ready:

1. **Gemini is NOT currently usable headlessly on this machine.** The active account (`agwhaley@whaleylawfirm.com`) is a Google **Workspace / GCA** account. A live `gemini -p ... --output-format json` returns **exit 41** ("Please set an Auth method...") because `~/.gemini/settings.json` does not select an auth method; forcing the GCA path then fails with **exit 1** `ProjectIdRequiredError` (needs `GOOGLE_CLOUD_PROJECT`); and any auth path also hits a **trusted-directory gate (exit 55)** unless `--skip-trust` / `GEMINI_CLI_TRUST_WORKSPACE=true` is set. This is exactly the failure ORCH-05 preflight exists to catch — but it also means **the gemini adapter's live tests and the preflight probe will FAIL against the real CLI until the user configures gemini auth.** The plan must (a) build gemini entirely against a fake-CLI fixture, and (b) treat the gemini preflight hint (D-31) as the primary near-term UX, pointing at the Antigravity-transition / auth-config docs. **This is the single most important finding for the planner.**

2. **Codex's stdout/stderr split and terminal-event semantics are now pinned (live-verified).** `codex exec --json` emits **NDJSON on stdout** (`thread.started` -> `turn.started` -> `item.completed{item.type:"agent_message"}` -> `turn.completed`), with human progress + tracing on **stderr**. The agent's final text is the `text` of the `agent_message` `item.completed` event (or simpler: read it from `--output-last-message <file>`, live-confirmed to write just the final message). **Success = `turn.completed` terminal event AND exit 0; failure = `turn.failed` event (and/or `error` events) AND exit 1.** Auth failure (401) surfaces as repeated `{"type":"error","message":"...401 Unauthorized..."}` events followed by `turn.failed`, exit 1 — and codex **retries internally 5x** before giving up, which inflates probe latency (matters for probe timeout sizing). The user's codex is authenticated via a **ChatGPT account** (confirmed by an invalid-model error message), not an API key.

**Primary recommendation:** Build two new adapters (`codex.ts`, `gemini.ts`) that mirror `claude.ts` exactly — injectable bin via `splitBin`, execa argv arrays, `redactedCommand`, per-vendor ok-rule, zod normalization to the EXISTING `TurnResult`. For codex, parse stdout NDJSON line-by-line and key success off the `turn.completed`/`turn.failed` terminal event + exit code (read final text from `--output-last-message` for robustness). For gemini, parse the single `{response,stats,error}` JSON object but **read it from BOTH stdout and stderr** (live: the error object came out on stderr) and key success off `error == null && exitCode === 0`. Wrap all three in ONE vendor-agnostic retry function (transient-only classification, exp backoff + jitter, no new dependency — plain TS is sufficient). Build the tiered preflight (PATH+`--version` then tiny live probe) and the zod roster loader with a vendor discriminated union. Test everything against `fake-codex.mjs` / `fake-gemini.mjs` fixtures that mirror these LIVE-VERIFIED shapes — zero real credits, and **gemini's must work even though the real gemini CLI currently cannot.**

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Roster config (ORCH-03):**
- **D-18:** Roster lives in `mar.config.json` at project root. JSON, zod-validated (no YAML dependency).
- **D-19:** Agent entries are structured fields, NOT command-template strings: `{ name, vendor, bin?, model?, timeoutMs?, extraArgs? }` plus a `defaults` block (`{ timeoutMs, retries }`). `vendor` selects the adapter (claude|codex|gemini); `bin` overrides the binary (supports fake-CLI testing); `extraArgs` appends vendor flags. Adapters own command shape — config cannot break argv safety.
- **D-20:** `mar invoke --agent <X>` resolves against roster entry names ONLY (e.g., `claude-1`). Missing roster file -> clear error. Single resolution path; ORCH-03's "adding a vendor requires no protocol-layer changes" falls out of the vendor->adapter registry.
- **D-21:** Ship `mar init` — probes PATH for claude/codex/gemini and writes a starter `mar.config.json` with detected vendors.

**Retry policy (ORCH-02):**
- **D-22:** Retry TRANSIENT failures only: timeouts, rate limits (429 / RESOURCE_EXHAUSTED / "usage limit"-style sentinels), unparseable-JSON flukes. NEVER retry auth failures or clean vendor errors.
- **D-23:** Default: 2 retries (3 attempts total), exponential backoff with jitter (~15s -> ~60s), honoring provider retry-after hints when present.
- **D-24:** Retry settings: `defaults.retries` in mar.config.json with per-agent override. Retry logic lives in ONE vendor-agnostic wrapper around `AgentAdapter.invoke` — not duplicated per adapter.
- **D-25:** Every attempt (including failed ones) gets its own `invocations.ndjson` record with an attempt number.

**Pre-flight (ORCH-05):**
- **D-26:** Tiered check per roster CLI: (1) binary on PATH + `--version` parses -> "installed"; (2) tiny live probe invocation with short timeout -> proves auth + responsiveness in one shot. Live probe is the only reliable auth check across all three vendors. Costs ~1 tiny invocation per agent.
- **D-27:** Triggers: explicit `mar preflight` command, AND automatically at run start (Phase 3) with a short-lived result cache (~10 min). `mar invoke` does NOT auto-preflight.
- **D-28:** Output: per-agent status table — installed status with version, probe status with latency, actionable hint on failure (e.g., "run: codex login"). Exit 0 = all pass, exit 1 = any fail. Also writes a machine-readable preflight result JSON for the run-start cache.

**Multi-vendor failure UX (ORCH-04):**
- **D-29:** <2-distinct-vendors gate: HARD refusal at run start, no override flag. Error names the vendors found. `mar invoke` (single invocation) is exempt.
- **D-30:** Partial pre-flight failure at run start: BLOCK by default showing the failure table; optional `--skip-failed` drops failing agents and proceeds ONLY if >=2 distinct vendors remain healthy.
- **D-31:** Gemini/Antigravity churn risk surfaces via preflight hints only (explain the June 18, 2026 transition, point at paid-tier/API-key options when the gemini probe fails). No special-casing elsewhere.

### Claude's Discretion
- Exact probe prompt content and probe timeout value.
- Codex adapter specifics (stderr/stdout split handling, `--ephemeral`, `--skip-git-repo-check`, sandbox flags) and gemini adapter specifics — follow STACK.md flag tables and pin behavior in adapter tests.
- Preflight cache file location/format (suggestion: under a `.mar/` or OS temp dir — NOT in `runs/`).
- zod schema details for mar.config.json and validation error formatting.
- How `extraArgs` merges with adapter-owned argv (append-only recommended).

### Deferred Ideas (OUT OF SCOPE)
- Antigravity CLI adapter (when it ships) and Grok adapter — architecture allows, don't build (v2 ORCH-07).
- Cost/token tracking per invocation (v2 COST-01). *(Note: codex `turn.completed` and gemini `stats` both carry usage live — the adapters can capture it into the existing optional `costUsd`/raw fields now at near-zero cost, but no cost UX is built.)*

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORCH-02 | Every invocation wrapped with configurable timeout + bounded retry | execa `timeout` already proven (Phase 1); new vendor-agnostic `withRetry` wrapper + transient-classification heuristics per vendor (live-verified signatures below) + exp-backoff-with-jitter recipe (plain TS, no dep) |
| ORCH-03 | Roster config (name, vendor, model); adding a vendor needs no protocol-layer change | zod discriminated-union schema for `mar.config.json` + a `vendor -> adapter factory` registry; `TurnRequest`/`TurnResult` unchanged |
| ORCH-04 | Refuse <2 distinct vendors | Pure function over the roster: `new Set(agents.map(a=>a.vendor)).size >= 2`; hard gate at run start (D-29), `--skip-failed` preserves the invariant (D-30) |
| ORCH-05 | Pre-flight installed/authenticated/responsive | Tiered: PATH detect + `--version` parse (live formats captured), then a tiny live probe keyed off each vendor's LIVE-VERIFIED success terminal signal; cache JSON; per-vendor failure hints (esp. gemini auth) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| codex/gemini subprocess + flag shape + normalization | Adapter (`codex.ts`/`gemini.ts`) | Schema (zod) | Vendor specifics (NDJSON parse, stderr-routed JSON) MUST NOT leak past the adapter — same boundary Phase 1 set |
| Transient-failure classification + backoff/retry | Retry wrapper (`retry.ts`) | Adapter (provides `TurnResult` signals) | ONE vendor-agnostic wrapper (D-24); per-vendor classification reads only normalized signals + a vendor tag, never re-parses raw output |
| Roster load + validate + name resolution | Config (`config.ts` + `schema/config.ts`) | zod | Single resolution path (D-20); discriminated union enforces per-vendor fields |
| vendor -> adapter construction | Registry (`adapters/registry.ts`) | Config | The seam that makes ORCH-03 true — add a vendor = add a registry entry, zero protocol change |
| Vendor-distinctness gate | Gate (pure fn) | Config | Run-start invariant (ORCH-04); reused by Phase 3 `mar run` |
| Tiered preflight (version + probe) | Preflight (`preflight.ts`) | Adapter, Registry | Probe IS a tiny adapter invocation; preflight composes adapters, never re-implements CLI calls |
| Preflight result cache (read/write/TTL) | Preflight cache | fs-extra | Atomic temp+rename (Phase-1 invariant); lives OUTSIDE `runs/` (D-27 discretion) |
| `mar init` PATH detection | CLI/init (`init.ts`) | — | Portable `command -v`-equivalent via Node; writes starter config |
| `mar preflight` / `mar invoke` (roster-resolved) / `mar init` subcommands | CLI (`cli.ts`) | commander | Thin dispatch only; business logic in the composable functions Phase 3 will reuse |

## Standard Stack

**No new runtime dependencies are required or recommended for Phase 2.** Everything is already installed and pinned in `package.json`. The retry/backoff, NDJSON line-parsing, PATH detection, and config validation can all be built on the existing stack (execa, zod, fs-extra, commander, pino, nanoid) plus Node built-ins.

### Already installed (verified in package.json) — reuse, do not re-add
| Library | Range (pinned) | Phase-2 use |
|---------|----------------|-------------|
| execa | ^9 | codex/gemini subprocess spawn, timeout, kill, separate stdout/stderr, `reject:false` — identical to claude adapter |
| zod | ^4 | `mar.config.json` discriminated-union schema; codex NDJSON event schemas; gemini `{response,stats,error}` schema; preflight-cache schema |
| fs-extra | ^11 | atomic preflight-cache write (temp+rename), `mar init` config write, `ensureDir` for `.mar/` |
| commander | ^15 | `mar init`, `mar preflight` subcommands; `mar invoke` roster-name resolution |
| pino | ^10 | extend `invocations.ndjson` with `attempt` field (D-25) via existing `logInvocation` |
| nanoid | ^5 | (already used for run ids; no new use required) |

### Node built-ins for the new mechanics (no dependency)
| Built-in | Phase-2 use |
|----------|-------------|
| `node:timers/promises` `setTimeout` | backoff sleep between retries (awaitable, abortable) — avoids `p-retry` |
| `String.prototype.split("\n")` / incremental buffer | NDJSON line parsing for codex stdout (one JSON object per line) |
| `node:fs` `existsSync` + PATH walk | `mar init` binary detection — see "PATH detection" below |
| `Math.random()` | jitter |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled retry loop (~30 lines) | `p-retry` | p-retry is a clean, well-known abstraction, BUT: (a) D-22 requires custom transient-vs-fatal classification that p-retry's `AbortError` mechanism only partially fits; (b) honoring per-vendor `retry-after` and per-attempt NDJSON logging (D-25) means you're customizing it heavily anyway; (c) adds a dependency the project doesn't otherwise need. **Recommendation: plain TS.** The loop is small, fully testable with fake fixtures, and keeps the transient-classification logic explicit and vendor-aware. `[ASSUMED — judgment call; either works]` |
| `node:timers/promises setTimeout` | `p-retry` internal timing / setInterval | Built-in `setTimeout(ms)` returns a promise; cleaner than callback timers; abortable via signal if a future cancel is added |
| zod discriminated union on `vendor` | flat object + manual `if (vendor===...)` | Discriminated union gives precise per-vendor field typing and one clean error path; D-19's shared shape across vendors is simple enough that a discriminated union is light but still the right call for extensibility (ORCH-03) |
| `command -v` via a shell | Node PATH walk (no shell) | Consistent with the project's no-shell-injection posture (execa array args); avoids `shell:true`. `which` npm package is an alternative but is an unneeded dependency |

**Installation:** none. `npm install` of new packages is NOT part of this phase.

## Package Legitimacy Audit

> Phase 2 installs **no new packages**. The Package Legitimacy Gate is therefore N/A. All libraries used were vetted and pinned in Phase 1 (see `01-RESEARCH.md` Package Legitimacy Audit) and are declared in the project's authoritative `package.json`/CLAUDE.md. If the planner elects to add `p-retry` (NOT recommended here), it must run the slopcheck gate before adding it.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none added this phase) | — | N/A — reuses Phase-1-vetted deps |

**Packages removed due to slopcheck [SLOP]:** none (none considered).
**Packages flagged [SUS]:** none.

## LIVE-VERIFIED CLI Behavior

> The load-bearing new evidence. Captured by actually running codex 0.128.0 and gemini 0.45.0 on this machine on 2026-06-04 with tiny prompts. The fake-CLI fixtures MUST mirror these shapes.

### Codex CLI 0.128.0 — `codex exec --json` (VERIFIED live)

**Version detection:** `codex --version` -> `codex-cli 0.128.0` (TWO tokens, "codex-cli" + semver). Parse strategy: split on whitespace, take the LAST token as the version (claude prints `2.1.162 (Claude Code)` → first token; codex prints `codex-cli 0.128.0` → second token; gemini prints bare `0.45.0`). **A single `split()[0]` like the Phase-1 `detectClaudeVersion` will return `"codex-cli"` for codex — the version detector must be per-vendor or extract the semver via regex `/\d+\.\d+\.\d+/`.** `[VERIFIED: live]`

**Recommended adapter argv (probe + run):**
```
codex exec --json --skip-git-repo-check --ephemeral -s read-only [-m <model>] "<prompt>"
```
- `--json` -> NDJSON on stdout (REQUIRED for parsing). `[VERIFIED: live]`
- `--skip-git-repo-check` -> codex normally refuses to run outside a git repo; the run/probe workspace may not be a repo. **Include it.** `[VERIFIED: docs + live]`
- `--ephemeral` -> don't persist rollout/session files (clean, no `~/.codex` litter per probe). `[VERIFIED: live — help text + ran clean]`
- `-s read-only` (sandbox) -> the review-drafting adapter needs NO write access; least-privilege per PITFALLS Pitfall 8. The integrator phase (Phase 4+) may need `workspace-write`, but Phase 2 adapters default to `read-only`. `[VERIFIED: help — possible values read-only|workspace-write|danger-full-access]`
- `--output-last-message <file>` (optional but RECOMMENDED) -> writes ONLY the final agent message to a file; live-confirmed (`last.txt` contained exactly `pong2`). Robust fallback for extracting final text without NDJSON reassembly. `[VERIFIED: live]`
- Do NOT use `--dangerously-bypass-approvals-and-sandbox` (PITFALLS security table; also unreliable per #14345).
- Reproducibility analog to claude's dropped `--bare`: `--ignore-user-config` exists (ignores `~/.codex/config.toml`, auth still via CODEX_HOME). **Like Phase 1's `--bare` decision, do NOT add it by default** — verify it doesn't break the ChatGPT-account auth before considering it. `[ASSUMED — not live-tested for auth interaction; mirror the Phase-1 caution]`

**Success NDJSON shape (stdout, one JSON object per line):** `[VERIFIED: live]`
```
{"type":"thread.started","thread_id":"019e941a-..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"pong"}}
{"type":"turn.completed","usage":{"input_tokens":19484,"cached_input_tokens":3456,"output_tokens":20,"reasoning_output_tokens":13}}
```
- **Final agent text** = the `text` of the `item.completed` event whose `item.type === "agent_message"` (there can be other item types — tool calls etc. — in a real run; filter on `agent_message`). Simpler robust path: read `--output-last-message` file.
- **Terminal success event** = `{"type":"turn.completed", ...}` with `usage`.
- **stderr** carried only `Reading additional input from stdin...` on success (human progress / tracing). Never parse stderr for content on the success path.

**Failure shapes:** `[VERIFIED: live]`
- **Auth failure (no/invalid creds, 401):** stdout emits repeated `{"type":"error","message":"...unexpected status 401 Unauthorized: Missing bearer or basic authentication..."}` events (codex internally retries **5x per endpoint** before giving up), terminating in `{"type":"turn.failed","error":{"message":"...401..."}}`. **exit 1.** stderr mirrors with `ERROR codex_api::endpoint::responses_websocket: ... 401 Unauthorized`.
- **Bad CODEX_HOME (path missing):** no NDJSON at all; stderr `Error finding codex home: ...`; **exit 1.** Adapter must treat "no parseable terminal event" as failure (like claude's unparseable-stdout path).
- **Invalid model / 4xx request error:** `{"type":"error","message":"{\"type\":\"error\",\"status\":400,...}"}` then `{"type":"turn.failed",...}`; **exit 1.**

**Codex ok-rule (for the adapter):**
> `ok = exitCode === 0 AND a `turn.completed` event was seen AND no `turn.failed` event was seen`. Extract text from the last `agent_message` `item.completed` (or `--output-last-message`). On any other outcome (`turn.failed`, only `error` events, no parseable terminal event, or exit != 0) -> `ok:false`, surface the last `error`/`turn.failed` message into `TurnResult.error`. Mirror the Phase-1 discipline: do NOT trust a single ambiguous field; require the positive terminal event AND exit 0.

**Codex transient-classification (for retry, D-22):** A `turn.failed`/`error` message containing `429`, `RESOURCE_EXHAUSTED`, `rate limit`, `usage limit`, `Too Many Requests`, or `5xx`/`overloaded`/`unexpected status 503` -> TRANSIENT (retry). A message containing `401`, `Unauthorized`, `Missing bearer`, `not logged in`, `invalid_request_error`, `model is not supported` -> FATAL (do NOT retry — re-running won't fix auth or a bad model). `[VERIFIED: live for the 401 and invalid-model strings; 429 string ASSUMED from vendor convention + PITFALLS]`

### Gemini CLI 0.45.0 — `gemini -p --output-format json` (FAILURE paths VERIFIED live; SUCCESS shape docs-only)

> **CRITICAL: gemini could not complete a successful headless invocation on this machine** (auth not configured for headless — see below). The SUCCESS shape is from official docs; the fake fixture must encode the documented success shape AND the live-verified failure shapes.

**Version detection:** `gemini --version` -> bare `0.45.0` (single token, no prefix). `[VERIFIED: live]`

**Recommended adapter argv (probe + run):**
```
gemini -p "<prompt>" --output-format json --skip-trust [-m <model>] [-y]
```
- `-p "<prompt>"` -> non-interactive (headless). `[VERIFIED: help + live]`
- `--output-format json` -> `{ response, stats, error? }`. Choices live-confirmed: `text|json|stream-json`. `[VERIFIED: help]`
- `--skip-trust` -> **REQUIRED in many dirs.** Live: without it, an authenticated invocation failed with **exit 55** "Gemini CLI is not running in a trusted directory." (the codex sandbox-trust analog). Alternatively set env `GEMINI_CLI_TRUST_WORKSPACE=true`. **Include `--skip-trust`** (least surprise; the probe/run dir is the project, which the user already trusts implicitly by running mar). `[VERIFIED: live]`
- `-y`/`--yolo` or `--approval-mode` -> NOT needed for a read-only review-drafting probe; only relevant when the agent would take edit actions (Phase 4 integrator). Phase 2 adapter omits it. `[VERIFIED: help]`

**Success JSON shape (docs):** single JSON object on stdout: `[CITED: geminicli.com/docs/cli/headless]`
```json
{ "response": "<the model's final answer string>",
  "stats": { /* token usage + API latency */ } }
```
- **Final text** = top-level `response` (string).
- `stats` = usage metadata (capture into raw / future cost).
- `error` key present ONLY on failure.

**Failure shapes (VERIFIED live on this machine):**
| Scenario | exit code | JSON? | Where | Notes |
|----------|-----------|-------|-------|-------|
| No auth method selected (`settings.json` has none) | **41** | yes: `{session_id, error:{type:"Error", message:"Please set an Auth method...", code:41}}` | **stderr** | The active account is Google Workspace; `~/.gemini/settings.json` is absent/empty so no method is chosen |
| Auth present but untrusted directory | **55** | no (plain colored text) | stderr | "not running in a trusted directory ... use `--skip-trust`" |
| GCA/Workspace account missing project | **1** | no (stack trace text) | stderr | `ProjectIdRequiredError: ... set GOOGLE_CLOUD_PROJECT` |

- **Docs claim exit codes 0/1/42/53** (success / general / input error / turn limit). **Live observed 41 and 55 are UNDOCUMENTED** — direct evidence of Pitfall 1 (CLI exit semantics drift / are under-documented). **Do not hard-code an exit-code allowlist; key success off `error == null && exitCode === 0` and the presence of a `response` string, and treat any non-zero exit as failure.**
- **JSON-on-stderr gotcha:** on the auth-failure path the `{error}` JSON object came out on **stderr**, not stdout. **The gemini adapter MUST attempt to parse JSON from stdout, and if stdout has none, ALSO try stderr**, before declaring "unparseable." (Contrast: codex content is always stdout; claude is always stdout.) `[VERIFIED: live]`

**Gemini ok-rule (for the adapter):**
> `ok = exitCode === 0 AND parsed JSON has a `response` string AND no `error` key`. Parse JSON from stdout-or-stderr. On `error` present, or non-zero exit, or no parseable JSON -> `ok:false`; surface `error.message` (or stderr text) into `TurnResult.error`.

**Gemini transient-classification (for retry, D-22):** `error.code === 429`, or `error.message` containing `RESOURCE_EXHAUSTED`, `rate limit`, `quota`, `429`, `Too Many Requests`, or `overloaded`/`503` -> TRANSIENT. `error.code` in {41, 42, 55} or message containing `Auth method`, `Unauthorized`, `ProjectIdRequired`, `trusted directory`, `API key not valid` -> FATAL. **PITFALLS note: gemini emits false-positive 429s during successful retries (#17906) — do NOT abort on the FIRST 429; the bounded retry (D-23) is exactly the right handling.** `[VERIFIED: live for 41/55; 429 string ASSUMED from docs + PITFALLS]`

### Auth state on THIS machine (for the planner + Environment Availability)
| CLI | Installed | Authenticated for headless | Evidence |
|-----|-----------|---------------------------|----------|
| claude 2.1.162 | yes | YES (subscription; Phase 1 verified) | Phase 1 live |
| codex 0.128.0 | yes | YES (ChatGPT account) | Live `pong`/`ack` round-trips, exit 0 |
| gemini 0.45.0 | yes | **NO — not usable headlessly as-configured** | Live exit 41/55/1; needs `settings.json` auth method + (for GCA) `GOOGLE_CLOUD_PROJECT`, or a `GEMINI_API_KEY` |

## Architecture Patterns

### System Architecture Diagram (Phase 2)
```
mar.config.json (project root)
   │  zod-validate (discriminated union on vendor)
   ▼
┌──────────────┐   resolve --agent <name> → roster entry (D-20)
│ Config loader│───────────────────────────────────────────────┐
└──────┬───────┘                                                │
       │ RosterEntry { name, vendor, bin?, model?, timeoutMs?, extraArgs? } + defaults
       ▼
┌──────────────────┐   vendor → adapter factory (claude|codex|gemini)
│ Adapter registry │   (THE ORCH-03 seam: add vendor = add entry, no protocol change)
└──────┬───────────┘
       │ AgentAdapter (unchanged Phase-1 contract)
       ▼
┌──────────────────────────────────────────────┐
│ withRetry(adapter, { retries, classify })     │  ← ONE vendor-agnostic wrapper (D-24)
│   attempt 1 → TurnResult                       │     transient? backoff(exp+jitter,retry-after)
│   attempt 2 → TurnResult                       │     fatal? stop. each attempt → invocations.ndjson
│   attempt 3 → TurnResult                       │       with attempt # (D-25)
└──────┬───────────────────────────────────────┘
       │ final TurnResult
       ▼   (used by `mar invoke` now; by Phase-3 `mar run` later)

PREFLIGHT (mar preflight  /  run-start, Phase 3):
   for each distinct roster CLI:
     tier 1: bin on PATH? + `--version` parses → installed ✓/✗ (+version)
     tier 2: tiny probe = withRetry(adapter, {retries:0}) "Reply: pong", short timeout
             → keyed off vendor success terminal signal → responsive ✓/✗ (+latency, +hint)
   → status table (D-28) + machine-readable cache JSON (.mar/, TTL ~10min, D-27)
   → exit 0 all-pass / exit 1 any-fail

GATES (run start, Phase 3 consumes; build the pure fns now):
   distinctVendors(roster) >= 2  ELSE hard refuse (D-29, no override)
   partial preflight fail → block, or --skip-failed drops failing AND re-checks >=2 (D-30)
```

### Recommended Project Structure (additions to Phase-1 tree)
```
src/
├── adapters/
│   ├── adapter.ts          # UNCHANGED contract
│   ├── claude.ts           # UNCHANGED (reference)
│   ├── codex.ts            # NEW — codex exec --json NDJSON adapter
│   ├── gemini.ts           # NEW — gemini -p --output-format json adapter
│   └── registry.ts         # NEW — vendor → adapter factory (ORCH-03 seam)
├── retry.ts                # NEW — withRetry: transient classify + exp backoff + jitter (D-22..25)
├── config.ts               # NEW — load/validate mar.config.json, resolve agent by name (D-18..20)
├── preflight.ts            # NEW — tiered check + cache (D-26..28)
├── gates.ts                # NEW — distinctVendors gate + skip-failed logic (D-29,30)
├── init.ts                 # NEW — PATH detection + starter config writer (D-21)
├── schema/
│   ├── turn.ts             # extend ClaudeJson siblings: add CodexEvent, GeminiJson schemas
│   └── config.ts           # NEW — zod roster schema (discriminated union)
└── cli.ts                  # add `init`, `preflight`; switch `invoke` to roster-name resolution
test/
├── fixtures/
│   ├── fake-claude.mjs     # UNCHANGED
│   ├── fake-codex.mjs      # NEW — emits LIVE-VERIFIED NDJSON; modes: happy/--fail-auth/--rate-limit/--bad-json/--hang
│   └── fake-gemini.mjs     # NEW — emits docs success + LIVE failure shapes (incl. JSON-on-stderr, exit 41/55)
├── codex-adapter.test.ts   # NEW (mirror claude-adapter.test.ts: happy/auth/unparseable/hang + flag-pinning)
├── gemini-adapter.test.ts  # NEW
├── retry.test.ts           # NEW — transient retried, fatal not, attempt logging, backoff (fake timers)
├── config.test.ts          # NEW — valid/invalid roster, name resolution, missing-file error
├── preflight.test.ts       # NEW — installed/probe matrix, hint text, cache write/TTL
├── gates.test.ts           # NEW — <2 vendors refused; --skip-failed preserves >=2
└── init.test.ts            # NEW — PATH detection writes correct starter config
```

### Pattern 1: codex adapter — NDJSON terminal-event parse
```typescript
// src/adapters/codex.ts — mirrors claude.ts: splitBin, execa array argv, redactedCommand
// Source: LIVE-VERIFIED codex 0.128.0 (2026-06-04)
function buildArgv(promptText: string, model?: string): string[] {
  const a = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only"];
  if (model) a.push("-m", model);
  a.push(promptText);                 // PROMPT is the trailing positional
  return a;
}
// after execa(bin, argv, { timeout, reject:false, forceKillAfterDelay:5000 }):
// parse stdout line-by-line; track terminal event + last agent_message text
let completed = false, failed = false, lastText = "", lastErr = "";
for (const line of result.stdout.split("\n")) {
  if (!line.trim()) continue;
  const ev = safeJsonParse(line); if (!ev || typeof ev !== "object") continue;
  if (ev.type === "item.completed" && ev.item?.type === "agent_message") lastText = ev.item.text ?? "";
  else if (ev.type === "turn.completed") completed = true;
  else if (ev.type === "turn.failed") { failed = true; lastErr = ev.error?.message ?? "turn failed"; }
  else if (ev.type === "error") lastErr = ev.message ?? lastErr;
}
const ok = result.exitCode === 0 && completed && !failed;
// (redactArgv: replace the trailing promptText positional with "<prompt>")
```

### Pattern 2: gemini adapter — parse stdout-OR-stderr, error-key ok-rule
```typescript
// src/adapters/gemini.ts
// Source: LIVE-VERIFIED gemini 0.45.0 failure shapes + CITED docs success shape
function buildArgv(promptText: string, model?: string): string[] {
  const a = ["-p", promptText, "--output-format", "json", "--skip-trust"];
  if (model) a.push("-m", model);
  return a;
}
// CRITICAL: error JSON came out on STDERR on the auth-failure path → try both.
const parsed = GeminiJson.safeParse(safeJsonParse(result.stdout) ?? safeJsonParse(result.stderr));
if (!parsed.success) return failResult("unparseable output", result);
const j = parsed.data;
const ok = result.exitCode === 0 && j.error == null && typeof j.response === "string";
const text = ok ? j.response : "";
const error = ok ? undefined : (j.error?.message ?? result.stderr ?? "gemini error");
```

### Pattern 3: vendor-agnostic retry wrapper (D-22..25, no dependency)
```typescript
// src/retry.ts
import { setTimeout as sleep } from "node:timers/promises";
type Classify = (t: TurnResult) => "transient" | "fatal";  // per-vendor, reads normalized signals
export async function withRetry(
  invoke: () => Promise<TurnResult>, opts: { retries: number; classify: Classify;
    onAttempt: (t: TurnResult, attempt: number) => void;  // → invocations.ndjson w/ attempt # (D-25)
    baseMs?: number; maxMs?: number; retryAfterMs?: (t: TurnResult) => number | undefined; }
): Promise<TurnResult> {
  const base = opts.baseMs ?? 15_000, cap = opts.maxMs ?? 60_000;
  let last!: TurnResult;
  for (let attempt = 1; attempt <= opts.retries + 1; attempt++) {
    last = await invoke();
    opts.onAttempt(last, attempt);                 // log EVERY attempt incl. failures
    if (last.ok) return last;
    if (opts.classify(last) === "fatal") return last;          // never retry auth/clean errors
    if (attempt > opts.retries) return last;                   // budget exhausted
    const ra = opts.retryAfterMs?.(last);                      // honor retry-after if present
    const backoff = Math.min(cap, base * 2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * (backoff / 2));  // full-ish jitter
    await sleep(ra ?? backoff + jitter);
  }
  return last;
}
```
> Test with vitest fake timers (`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`) so backoff sleeps don't slow the suite. `[CITED: vitest fake timers]`

### Pattern 4: zod roster config (D-18,19) — discriminated union
```typescript
// src/schema/config.ts
import { z } from "zod";
const Base = { name: z.string().min(1), bin: z.string().optional(),
  model: z.string().optional(), timeoutMs: z.number().int().positive().optional(),
  extraArgs: z.array(z.string()).optional() };
const Agent = z.discriminatedUnion("vendor", [
  z.object({ vendor: z.literal("claude"), ...Base }),
  z.object({ vendor: z.literal("codex"),  ...Base }),
  z.object({ vendor: z.literal("gemini"), ...Base }),
]);
export const MarConfig = z.object({
  agents: z.array(Agent).min(1),
  defaults: z.object({ timeoutMs: z.number().int().positive().default(600_000),
                       retries: z.number().int().min(0).default(2) }).default({}),
}).superRefine((c, ctx) => {                  // name uniqueness
  const dup = c.agents.map(a => a.name).filter((n,i,arr) => arr.indexOf(n) !== i);
  if (dup.length) ctx.addIssue({ code: "custom", message: `duplicate agent name(s): ${dup.join(", ")}` });
});
// NOTE: the >=2-distinct-VENDOR rule is a RUN-START gate (ORCH-04 / D-29), NOT a config-load
// error — a config may legitimately list one vendor for a `mar invoke`. Do not enforce it here.
```
> **zod v4 note:** discriminated unions, `superRefine`, and `default()` are stable in zod 4 (installed `^4`). Validation error formatting: use `z.treeifyError(err)` (zod 4) or iterate `err.issues` for `path`+`message` to produce the actionable per-field messages D-19 implies. `[ASSUMED — verify exact zod-4 error API at implementation via Context7; Phase-1 A2 flagged the same]`

### Pattern 5: PATH detection for `mar init` (D-21) — no shell
```typescript
// src/init.ts — portable command-on-PATH check without spawning a shell
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";
function onPath(bin: string): string | undefined {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const ext of exts) { const p = join(dir, bin + ext); if (existsSync(p)) return p; }
  }
  return undefined;
}
// detect claude/codex/gemini; write a starter mar.config.json listing each DETECTED vendor as one agent.
```
> Alternative: spawn `<bin> --version` via execa with `reject:false` and treat success as "present" — this ALSO confirms the binary runs, but costs a process spawn per CLI. PATH-walk is cheaper for `init`; the `--version` spawn is already done in preflight tier-1. `[ASSUMED — standard pattern]`

### Anti-Patterns to Avoid
- **Leaking codex's stderr/stdout split or NDJSON event types past the adapter** — the registry/retry/protocol layers see only `TurnResult`. (D-12 invariant; PITFALLS Integration Gotchas.)
- **Duplicating retry logic per adapter** — ONE `withRetry` (D-24). Adapters are retry-agnostic; they just return `TurnResult`.
- **Treating any 429 as fatal** (gemini false-positive 429s #17906) OR retrying auth failures (wastes credits, never succeeds) — classify precisely (D-22).
- **Hard-coding a gemini exit-code allowlist** — undocumented 41/55 observed live; key off `error`/`response`/exit-0, not a magic-number set.
- **Enforcing the >=2-vendor rule at config load** — it's a run-start gate so single-vendor `mar invoke` still works (D-29 exemption).
- **Writing the preflight cache into `runs/`** — keep it out (D-27 discretion: `.mar/` or temp); it's machine state, not run-artifact lineage.
- **Building Phase-3 `mar run`** — Phase 2 builds composable functions (loader, gate, preflight, withRetry); it does NOT build the protocol run loop.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subprocess timeout/kill/stderr-split | manual `spawn` bookkeeping | execa (already used) | Identical to claude adapter; execa solves it |
| NDJSON event validation | `typeof ev.type === 'string'` ladders | zod schemas per codex event + `safeParse` | Fails loudly on shape drift (Pitfall 1) |
| Config validation + typed access | manual `if (!cfg.agents)` checks | zod discriminated union + `z.infer` | One schema, precise per-vendor errors, ORCH-03 extensibility |
| Backoff sleep | `setTimeout` callback + Promise wrapper | `node:timers/promises` `setTimeout` | Built-in awaitable sleep; abortable |
| PATH lookup | shelling out to `which`/`command -v` | Node PATH-walk (no shell) | No-shell-injection posture; no extra dependency |
| Per-attempt audit logging | a parallel log file | extend existing `logInvocation` with `attempt` | D-25; one audit trail, not two |
| Atomic cache write | `writeFile` then hope | fs-extra temp+rename (Phase-1 pattern) | Crash-safe; reuse the proven recipe |

**Key insight:** Phase 2 introduces almost no genuinely new mechanism — it's the Phase-1 adapter discipline applied twice more plus three thin orchestration functions (retry, preflight, roster) built entirely on the existing stack. The ONLY hard, irreducible new knowledge is the **per-vendor output/exit/auth signatures**, which this research live-verified so the fixtures and ok-rules can be exact.

## Runtime State Inventory

Greenfield-ish phase (new code + new config file; no rename/refactor of existing identifiers). External-state touchpoints:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `mar.config.json` at project root (user-authored / `mar init`-generated). New preflight cache JSON (e.g. `.mar/preflight.json`). | Create; gitignore the cache (and decide if `mar.config.json` is committed — recommend committed, it's project config) |
| Live service config | codex auth = ChatGPT account in `~/.codex` (live OK). gemini auth = `~/.gemini` OAuth creds present but `settings.json` selects NO method → headless-broken; Workspace/GCA account needs `GOOGLE_CLOUD_PROJECT`. claude = subscription (Phase-1 OK). | NONE in code. Surface gemini gap via preflight hint (D-31). Do NOT write to `~/.gemini`/`~/.codex` from mar. |
| OS-registered state | None (no scheduled tasks, services, daemons — v1 is CLI-only). | None — verified by project's filesystem-first / no-daemon constraint. |
| Secrets/env vars | `ANTHROPIC_API_KEY` (unset, claude only-if-`--bare`). codex reads `CODEX_HOME`. gemini reads `GEMINI_API_KEY`/`GOOGLE_GENAI_USE_GCA`/`GOOGLE_CLOUD_PROJECT`/`GEMINI_CLI_TRUST_WORKSPACE`. `MAR_CLAUDE_BIN` (Phase-1 test injection) → generalize to `MAR_CODEX_BIN`/`MAR_GEMINI_BIN` or rely on roster `bin`. | Adapters read env only; NEVER log or persist these. Preflight hints may NAME the needed env var, never its value. |
| Build artifacts | `dist/` from `tsc build` (bin entry); none stale from this phase. | None. |

**Nothing found for OS-registered state** — confirmed by the project's explicit no-daemon/no-service v1 constraint.

## Common Pitfalls

### Pitfall 1: Gemini adapter/preflight tests fail against the REAL CLI (auth not configured)
**What goes wrong:** A live gemini call on this machine returns exit 41/55/1 — never a `response`. Any test or preflight that hits the real gemini binary fails, and a developer may "fix" it by mangling the adapter.
**Why:** The active gemini account is Google Workspace/GCA without `settings.json` auth-method selection or `GOOGLE_CLOUD_PROJECT`.
**How to avoid:** Build and test the gemini adapter ENTIRELY against `fake-gemini.mjs` (encode docs-success + live-failure shapes). Gate any real-gemini smoke test behind an env flag, skipped by default (like Phase-1's `MAR_LIVE_CLAUDE`). The preflight `responsive ✗` + hint IS the correct, expected behavior for gemini today — verify the HINT text, not a live success.
**Warning signs:** CI red only on gemini; exit 41/55 in test output; someone editing the ok-rule to "accept" an error.

### Pitfall 2: codex version detector returns "codex-cli" instead of the semver
**What goes wrong:** Phase-1 `detectClaudeVersion` takes `stdout.split(/\s+/)[0]`. For codex that yields `"codex-cli"`, not `0.128.0`, corrupting the manifest's `cliVersions` (Pitfall-1 version-drift mitigation depends on it being right).
**How to avoid:** Per-vendor version extraction, or a shared `/\d+\.\d+\.\d+/` regex match. claude=`2.1.162 (Claude Code)`, codex=`codex-cli 0.128.0`, gemini=`0.45.0`.
**Warning signs:** manifest `cliVersions.codex === "codex-cli"`.

### Pitfall 3: Parsing codex content from stderr (or gemini content from only stdout)
**What goes wrong:** codex content is on stdout (NDJSON); its stderr is human/tracing noise — parsing stderr yields garbage. Conversely gemini's error JSON appeared on STDERR; parsing only stdout misses it and reports "unparseable" instead of the real auth error.
**How to avoid:** codex → parse stdout NDJSON only. gemini → try stdout JSON, fall back to stderr JSON. Pin both in fixtures.
**Warning signs:** codex "unparseable" on success; gemini "unparseable output" where the real cause was exit-41 auth.

### Pitfall 4: Retrying fatal failures (auth) or aborting on first transient 429
**What goes wrong:** Retrying a 401/exit-41 wastes credits and never succeeds; treating gemini's false-positive 429 (#17906) as fatal aborts a call that would have succeeded.
**How to avoid:** Precise classification (D-22): auth/clean-error → fatal (stop); 429/RESOURCE_EXHAUSTED/timeout/unparseable-fluke → transient (bounded retry, D-23). Honor `retry-after` when present.
**Warning signs:** repeated identical auth failures in `invocations.ndjson`; a single 429 ending a run.

### Pitfall 5: Codex internal 5x reconnect inflates probe latency / trips the probe timeout
**What goes wrong:** On auth failure codex retries the websocket ~5x per endpoint before emitting `turn.failed` — the live auth-failure took many seconds. A too-short probe timeout will kill codex mid-reconnect and report `timeout` instead of the truer `auth failure`, producing a misleading hint.
**How to avoid:** Size the probe timeout generously enough to let codex reach `turn.failed` (suggest ~20–30s probe timeout, configurable), and in classification treat a probe that DID surface a `401`/`Unauthorized` message as auth-fatal even if it also timed out. Document the probe timeout as Claude's-discretion (CONTEXT.md) — recommend ~30s.
**Warning signs:** codex preflight always says "timeout" never "not authenticated"; hint says "increase timeout" when the real fix is "codex login".

### Pitfall 6: Gemini trusted-directory gate (exit 55) misread as auth failure
**What goes wrong:** Forgetting `--skip-trust` makes EVERY gemini call fail with exit 55 in untrusted dirs — looks like a broken adapter or auth issue.
**How to avoid:** Always pass `--skip-trust` in the gemini adapter argv (pin it in the flag-pinning test). Recognize exit 55 / "trusted directory" as its own hint ("trust the workspace / pass --skip-trust"), distinct from auth.
**Warning signs:** exit 55; "not running in a trusted directory" in stderr.

### Pitfall 7: CLI flag drift (PITFALLS Pitfall 1) — the standing risk
**What goes wrong:** codex's flag set "changed notably across 0.12x" (STACK.md); a minor bump can move keys/flags and silently break parsing.
**How to avoid:** Flag-pinning tests per adapter (assert the EXACT argv, like `claude-adapter.test.ts` does); record `cliVersions` per run; per-adapter fake-CLI smoke fixture mirrors the verified shape so drift fails loudly.
**Warning signs:** parse exceptions or empty artifacts after `brew upgrade codex`/`gemini`.

## Code Examples

(See Patterns 1–5 above — all derived from LIVE-VERIFIED shapes or CITED docs. Additional concrete schemas:)

### codex NDJSON event schema (zod, only consumed fields)
```typescript
// src/schema/turn.ts (additions) — VERIFIED live shapes
export const CodexEvent = z.object({
  type: z.string(),
  item: z.object({ type: z.string(), text: z.string().optional() }).partial().optional(),
  error: z.object({ message: z.string() }).partial().optional(),
  message: z.string().optional(),
  usage: z.unknown().optional(),
}).passthrough();   // tolerate new event types / keys (drift-safe)
```

### gemini response schema (zod)
```typescript
export const GeminiJson = z.object({
  response: z.string().optional(),      // present on success
  stats: z.unknown().optional(),
  session_id: z.string().optional(),
  error: z.object({ type: z.string().optional(), message: z.string(),
                    code: z.number().optional() }).optional(),  // present only on failure
}).passthrough();
```

### preflight cache schema (zod) + location
```typescript
// .mar/preflight.json (gitignored), atomic temp+rename
export const PreflightCache = z.object({
  checkedAt: z.string(),                 // ISO; TTL ~10min vs now (D-27)
  results: z.array(z.object({
    name: z.string(), vendor: z.string(),
    installed: z.boolean(), version: z.string().optional(),
    responsive: z.boolean(), latencyMs: z.number().optional(),
    hint: z.string().optional(),         // actionable (e.g. "run: codex login")
  })),
});
```

## State of the Art

| Old assumption (STACK.md / CONTEXT.md) | Current (live-verified 2026-06-04) | Impact |
|----------------------------------------|-------------------------------------|--------|
| codex final message on stdout, progress on stderr | TRUE, and the final message is the `agent_message` `item.completed` text; terminal event is `turn.completed`/`turn.failed` | adapter keys off terminal event + exit, not "last stdout line" |
| gemini returns `{response, stats, error?}` | TRUE on success (docs); but ERROR JSON routes to **stderr** and exit codes 41/55 are real+undocumented | parse stdout-or-stderr; don't allowlist exit codes |
| all three CLIs authenticated & ready | claude ✓, codex ✓, **gemini ✗ (headless auth unconfigured)** | gemini built/tested against fixtures; preflight hint is the near-term UX |
| codex `--version` like claude | codex prints `codex-cli 0.128.0` (2 tokens) | per-vendor version parse |
| Antigravity cutoff June 18 2026 (future) | still future as of research date; gemini already churning (auth friction) | reinforces D-31 hint + swappable-adapter posture |

**Deprecated/outdated for this phase:** gemini `--allowed-tools` is DEPRECATED (help text → use Policy Engine); not needed here anyway. No library is deprecated.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plain-TS retry (no `p-retry`) is the right call given custom classification + per-attempt logging | Standard Stack / Pattern 3 | Low — either works; ~30 lines, fully tested |
| A2 | Gemini SUCCESS shape is exactly `{response, stats}` with text in `response` | LIVE-VERIFIED section / Pattern 2 | **Med** — could NOT live-verify success (auth broken); fixture encodes docs shape. Re-verify when gemini auth is fixed or via a live smoke once configured |
| A3 | codex 429/rate-limit message strings match `429`/`RESOURCE_EXHAUSTED`/`Too Many Requests` | codex transient-classification | Med — 401/invalid-model strings ARE live-verified; the rate-limit string is inferred. Broaden the regex and re-verify if a real 429 is ever captured |
| A4 | `--ignore-user-config` (codex) and dropping it is the right default (mirror Phase-1 `--bare` caution) | codex argv | Low-Med — not live-tested for auth interaction; default to NOT using it |
| A5 | Probe timeout ~30s is enough to let codex reach `turn.failed` past its 5x reconnect | Pitfall 5 | Med — observed multi-second auth failures; make it configurable (Claude's-discretion per CONTEXT.md) |
| A6 | `mar.config.json` should be COMMITTED (project config), preflight cache gitignored | Runtime State Inventory | Low — recommend; planner/user may prefer config gitignored if it carries machine-specific `bin` paths |
| A7 | zod 4 `treeifyError`/`issues` is the error-formatting API | Pattern 4 | Low — verify exact API at implementation (same as Phase-1 A2) |
| A8 | The user wants gemini in the roster despite current headless-auth breakage (vs descoping gemini to a 2-vendor claude+codex v1) | Summary / whole phase | **Med-High** — ORCH-04 needs only 2 distinct vendors, and claude+codex BOTH work live. The planner/user may choose to ship Phase 2 with claude+codex as the working pair and keep gemini as a fixture-tested, preflight-hinted adapter. **Surface for discuss-phase / user confirmation.** |

## Open Questions (RESOLVED)

> All resolved during planning: Q1 → D-32 (gemini fixture-built, preflight-hinted); Q2 → D-33 (probe "Reply with exactly: pong", ~30s, retries:0); Q3 → D-34 (mar.config.json committed).

1. **Is gemini's headless auth gap blocking, or expected?**
   - What we know: gemini cannot complete a headless call on this machine (exit 41/55/1); claude+codex both work live and already satisfy ORCH-04's 2-distinct-vendor minimum.
   - What's unclear: does the user want to (a) fix gemini auth now (`settings.json` auth method + `GOOGLE_CLOUD_PROJECT`, or a `GEMINI_API_KEY`), or (b) ship Phase 2 with claude+codex as the live pair and gemini as a fixture-built, preflight-hinted adapter pending the Antigravity transition?
   - Recommendation: build all three adapters (gemini fully fixture-tested), make the default `mar init` roster include only DETECTED-AND-it-could-go-either-way vendors, and let preflight surface gemini's gap. Flag A8 to the user via discuss-phase. **This does not block Phase 2 — ORCH-04 is satisfiable with claude+codex.**

2. **Exact probe prompt + timeout (Claude's-discretion).**
   - Recommendation: prompt `"Reply with exactly: pong"`; classify a probe `ok` only if `text` contains `pong` (cheap correctness signal) OR just `turn.ok` (simpler). Probe timeout ~30s (Pitfall 5). Probe with `retries:0` (a probe shouldn't burn the retry budget).

3. **`mar.config.json` committed vs gitignored** — recommend committed (project config); revisit if `bin` overrides carry machine-specific absolute paths (A6).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | 24.7.0 (target 22) | — |
| claude CLI | claude adapter / preflight | ✓ authenticated | 2.1.162 | — |
| codex CLI | codex adapter / preflight | ✓ authenticated (ChatGPT acct) | 0.128.0 | — |
| gemini CLI | gemini adapter / preflight | ✓ installed, **✗ headless-auth** | 0.45.0 | Build/test against `fake-gemini.mjs`; preflight hint surfaces the gap (D-31); claude+codex satisfy ORCH-04 |
| git | codex normally needs a repo | (project has .git) | — | `--skip-git-repo-check` in codex argv removes the dependency anyway |

**Missing dependencies with no fallback:** none — Phase 2 is buildable and testable end-to-end (all adapters via fixtures; claude+codex also live).
**Missing dependencies with fallback:** gemini headless auth — fallback is fixture-based development + a 2-vendor (claude+codex) working set for ORCH-04, with gemini's adapter ready for when auth is configured.

## Validation Architecture

`nyquist_validation: true` → section included. Test infra is UNCHANGED (vitest 4.x, fake-CLI fixtures) per the phase brief.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x (installed; `vitest.config.ts` exists from Phase 1) |
| Config file | `vitest.config.ts` (present) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORCH-03 | valid `mar.config.json` parses; per-vendor fields typed | unit | `npx vitest run test/config.test.ts` | ❌ Wave 0 |
| ORCH-03 | invalid roster (bad vendor / dup name / missing file) → clear error | unit | `npx vitest run test/config.test.ts` | ❌ Wave 0 |
| ORCH-03 | `mar invoke --agent <name>` resolves by roster NAME (D-20) | unit | `npx vitest run test/config.test.ts` | ❌ Wave 0 |
| ORCH-03 | vendor→adapter registry returns correct adapter; new vendor = registry entry only | unit | `npx vitest run test/registry.test.ts` | ❌ Wave 0 |
| ORCH-01/03 | codex adapter happy path → ok:true, text from agent_message (fake NDJSON) | unit (fake-codex) | `npx vitest run test/codex-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01/03 | codex auth-fail (turn.failed + 401, exit1) → ok:false, error surfaced | unit (fake-codex --fail-auth) | `npx vitest run test/codex-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01/03 | codex unparseable/no-terminal-event → graceful ok:false | unit (fake-codex --bad-json) | `npx vitest run test/codex-adapter.test.ts` | ❌ Wave 0 |
| ORCH-02 | codex hang killed by wall-clock timeout | unit (fake-codex --hang) | `npx vitest run test/codex-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01/03 | codex flag-pinning: exact argv incl --skip-git-repo-check/--ephemeral/-s read-only | unit (execa mock) | `npx vitest run test/codex-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01/03 | gemini happy (docs `{response}`) → ok:true, text=response | unit (fake-gemini) | `npx vitest run test/gemini-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01/03 | gemini auth-fail JSON-on-STDERR (exit 41) → ok:false, error surfaced | unit (fake-gemini --fail-auth) | `npx vitest run test/gemini-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01/03 | gemini untrusted-dir (exit 55) → ok:false with distinct hint | unit (fake-gemini --untrusted) | `npx vitest run test/gemini-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01/03 | gemini flag-pinning: exact argv incl --output-format json --skip-trust | unit (execa mock) | `npx vitest run test/gemini-adapter.test.ts` | ❌ Wave 0 |
| ORCH-02 | withRetry retries TRANSIENT (429/timeout), stops on FATAL (auth) | unit (fake timers) | `npx vitest run test/retry.test.ts` | ❌ Wave 0 |
| ORCH-02 | withRetry: exp backoff + jitter; honors retry-after; default 2 retries (3 attempts) | unit (fake timers) | `npx vitest run test/retry.test.ts` | ❌ Wave 0 |
| ORCH-02 | every attempt (incl failures) logged with attempt # to invocations.ndjson (D-25) | unit | `npx vitest run test/retry.test.ts` | ❌ Wave 0 |
| ORCH-05 | preflight tier-1: bin on PATH + version parsed (per-vendor format) | unit | `npx vitest run test/preflight.test.ts` | ❌ Wave 0 |
| ORCH-05 | preflight tier-2 probe: responsive ✓ (fake ok) / ✗+hint (fake fail) | unit (fakes) | `npx vitest run test/preflight.test.ts` | ❌ Wave 0 |
| ORCH-05 | preflight writes cache JSON; honors ~10min TTL; exit 0 all-pass/1 any-fail | unit | `npx vitest run test/preflight.test.ts` | ❌ Wave 0 |
| ORCH-04 | <2 distinct vendors → hard refusal naming vendors (no override) | unit | `npx vitest run test/gates.test.ts` | ❌ Wave 0 |
| ORCH-04 | --skip-failed drops failing agents ONLY if ≥2 distinct vendors remain | unit | `npx vitest run test/gates.test.ts` | ❌ Wave 0 |
| ORCH-03 | `mar init` detects CLIs on PATH, writes starter config | unit | `npx vitest run test/init.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>`
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** full suite green; optional gated live smoke (`MAR_LIVE_CODEX=1` works; `MAR_LIVE_GEMINI=1` expected to FAIL until auth configured — skip by default) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/fixtures/fake-codex.mjs` — emits LIVE-VERIFIED NDJSON; modes: default(happy)/`--fail-auth`(error events+turn.failed,exit1)/`--rate-limit`(429 message)/`--bad-json`/`--hang`
- [ ] `test/fixtures/fake-gemini.mjs` — modes: default(docs `{response}` on stdout,exit0)/`--fail-auth`(JSON error on STDERR,exit41)/`--untrusted`(text on stderr,exit55)/`--rate-limit`(error.code 429)/`--bad-json`/`--hang`
- [ ] Test files listed above (codex-adapter, gemini-adapter, registry, retry, config, preflight, gates, init)
- [ ] No framework install needed (vitest present)
- [ ] Generalize bin-injection env (`MAR_CODEX_BIN`/`MAR_GEMINI_BIN`) OR rely on roster `bin` field for fixture injection (D-19 `bin` already supports this — prefer roster `bin`)

## Security Domain

`security_enforcement` not explicitly false → included. Phase 2 adds two more subprocess vendors + a config file; no untrusted external document input yet (legal-doc/prompt-injection defenses remain Phase 4/5 per PITFALLS Pitfall 8).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | indirect | Rely on each CLI's own auth; NEVER store/echo creds. Preflight hints may NAME a needed env var, never its value. |
| V3 Session Management | no | Fresh-context per turn; codex `--ephemeral` (no session files), gemini/codex session ids not security-sensitive here |
| V4 Access Control | yes (least-privilege) | codex `-s read-only`; gemini no `-y`/edit perms for review drafting — agents read inputs, write only their own artifact (PITFALLS Pitfall 8) |
| V5 Input Validation | yes | zod `safeParse` on ALL CLI output (NDJSON events, gemini JSON) AND on `mar.config.json`; `.passthrough()` tolerates-but-validates |
| V6 Cryptography | no | none hand-rolled |
| V7 Error/Logging | yes | log argv/exit/duration/attempt; NEVER log prompt body (existing `redactedCommand`/`promptRef`), NEVER log creds or full CLI stderr if it could carry sensitive content |

### Known Threat Patterns for {Node multi-CLI orchestrator + config}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via prompt/extraArgs | Tampering | execa array args (no shell); `extraArgs` is append-only to an adapter-owned argv array — config can't inject shell metachars (D-19) |
| Malicious `bin`/`extraArgs` in mar.config.json | Tampering/EoP | `bin` runs a binary by design (test-injection feature) — document that `mar.config.json` is trusted project config; validate `extraArgs` is `string[]`; do NOT eval/interpolate |
| Credential leakage in logs/cache | Info Disclosure | preflight cache stores status+version+hint only, never tokens; never log env-var values |
| Codex sandbox bypass on host | EoP | default `-s read-only`; never `--dangerously-bypass-approvals-and-sandbox` (PITFALLS) |
| Runaway retry cost | Availability/$$ | bounded retries (D-23, default 2); fatal-classification stops auth loops immediately; timeout bounds each attempt |
| Untrusted artifact-as-instruction | Tampering | out of scope Phase 2 (no cross-agent reads yet); Phase 4/5 (PITFALLS Pitfall 8) |

## Project Constraints (from CLAUDE.md)

- **Drive vendor CLIs as installed, NOT vendor APIs/SDKs** — codex/gemini adapters shell out via execa; no OpenAI/Google SDK.
- **ESM, Node 22, no CommonJS** — all new files ESM; fixtures `.mjs`.
- **Typed adapter layer is the core architectural asset** — `TurnRequest`/`TurnResult` UNCHANGED; codex NDJSON / gemini stderr-JSON quirks MUST NOT leak past the adapter (D-12).
- **Pin CLI behavior in adapter tests** — flag-pinning tests REQUIRED for codex and gemini (codex flags drift notably across minors — STACK.md).
- **Filesystem-first, no daemon/message bus/web UI** — preflight cache is a plain JSON file; roster is a plain JSON file.
- **GSD workflow enforcement** — file changes go through a GSD command (execution-time concern).

## Sources

### Primary (HIGH confidence)
- **Live invocation of codex 0.128.0 on this machine (2026-06-04)** — `exec --json` NDJSON shape (`thread.started`/`turn.started`/`item.completed{agent_message}`/`turn.completed`), `turn.failed`+`error` on 401, `--output-last-message` content, `--ephemeral`/`--skip-git-repo-check`/`-s read-only` behavior, `codex --version` format, ChatGPT-account auth, internal 5x reconnect on auth failure. **The load-bearing codex evidence.**
- **Live invocation of gemini 0.45.0 on this machine (2026-06-04)** — exit 41 (auth-method JSON on STDERR), exit 55 (untrusted dir), exit 1 (GCA ProjectIdRequired), `gemini --version` format, `--output-format` choices, `--skip-trust` requirement, oauth_creds present but `settings.json` unset. **The load-bearing gemini evidence (failure paths).**
- `codex exec --help` / `gemini --help` (installed binaries) — exact flag surface.
- Phase-1 verified artifacts: `src/adapters/adapter.ts`, `src/adapters/claude.ts`, `src/schema/turn.ts`, `src/log/invocation.ts`, `src/cli.ts`, `test/fixtures/fake-claude.mjs`, `test/claude-adapter.test.ts`, `01-RESEARCH.md` — the contract + patterns Phase 2 replicates.
- `package.json` — installed deps already cover Phase 2 (no new install).

### Secondary (MEDIUM confidence)
- `https://geminicli.com/docs/cli/headless/` — gemini `{response, stats, error?}` success shape and documented exit codes 0/1/42/53 (note: live-observed 41/55 are undocumented). gemini SUCCESS shape is docs-only (could not live-verify due to auth gap — A2).
- STACK.md / PITFALLS.md (project research) — codex/gemini flag tables, 429-as-retryable / false-positive-429 guidance, Antigravity transition, version-drift discipline.

### Tertiary (LOW confidence)
- None relied upon. (429/rate-limit exact message strings for codex/gemini are inferred — A3 — and flagged for re-verification if a real 429 is captured.)

## Metadata

**Confidence breakdown:**
- codex live behavior (output/exit/auth/flags): HIGH — live-verified on installed 0.128.0.
- gemini FAILURE behavior (exit 41/55/1, JSON-on-stderr, --skip-trust): HIGH — live-verified.
- gemini SUCCESS shape: MEDIUM — docs-only; auth gap prevented a live success (A2).
- Adapter/retry/preflight/config patterns: HIGH — extend the verified Phase-1 contract; built on already-installed stack.
- Rate-limit (429) classification strings: MEDIUM — inferred from vendor convention + PITFALLS (A3).
- The claim "gemini headless auth is currently broken on this machine": HIGH — reproduced across multiple auth paths.

**Research date:** 2026-06-04
**Valid until:** ~2026-07-04 for libraries/patterns; SOONER for the CLIs — re-verify codex/gemini output+exit shapes on any `brew upgrade`, and re-verify gemini SUCCESS shape once its headless auth is configured (and ahead of the June 18 2026 Antigravity cutoff).
