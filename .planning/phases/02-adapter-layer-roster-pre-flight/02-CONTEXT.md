# Phase 2: Adapter Layer + Roster + Pre-flight - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

A user can configure a roster of distinct-vendor agents (claude, codex, gemini) in `mar.config.json`, and the system drives each through the same `AgentAdapter` contract — wrapping every invocation in timeout + bounded retry, refusing rosters with fewer than 2 distinct vendors at run start, and pre-flight checking each roster CLI (installed, authenticated, responsive) before a run begins.

Covers requirements: ORCH-02, ORCH-03, ORCH-04, ORCH-05. The protocol state machine and `mar run` itself are Phase 3 — Phase 2 builds the gate/preflight machinery Phase 3 will call.

</domain>

<decisions>
## Implementation Decisions

### Roster config design
- **D-18:** Roster lives in `mar.config.json` at project root. JSON, zod-validated (consistent with manifest/NDJSON; no YAML dependency).
- **D-19:** Agent entries are structured fields, NOT command-template strings: `{ name, vendor, bin?, model?, timeoutMs?, extraArgs? }` plus a `defaults` block (`{ timeoutMs, retries }`). `vendor` selects the adapter (claude|codex|gemini); `bin` overrides the binary (supports fake-CLI testing); `extraArgs` appends vendor flags. Adapters own command shape — config cannot break argv safety.
- **D-20:** `mar invoke --agent <X>` resolves against roster entry names ONLY (e.g., `claude-1`). Missing roster file → clear error. Single resolution path; ORCH-03's "adding a vendor requires no protocol-layer changes" falls out of the vendor→adapter registry.
- **D-21:** Ship `mar init` — probes PATH for claude/codex/gemini and writes a starter `mar.config.json` with detected vendors.

### Retry policy (ORCH-02)
- **D-22:** Retry TRANSIENT failures only: timeouts, rate limits (429 / RESOURCE_EXHAUSTED / "usage limit"-style sentinels), unparseable-JSON flukes. NEVER retry auth failures or clean vendor errors (re-running won't fix login; deterministic failures waste credits).
- **D-23:** Default: 2 retries (3 attempts total), exponential backoff with jitter (~15s → ~60s), honoring provider retry-after hints when present.
- **D-24:** Retry settings: `defaults.retries` in mar.config.json with per-agent override. Retry logic lives in ONE vendor-agnostic wrapper around `AgentAdapter.invoke` — not duplicated per adapter.
- **D-25:** Every attempt (including failed ones) gets its own `invocations.ndjson` record with an attempt number — the audit trail shows exactly what happened.

### Pre-flight (ORCH-05)
- **D-26:** Tiered check per roster CLI: (1) binary on PATH + `--version` parses → "installed"; (2) tiny live probe invocation with short timeout → proves auth + responsiveness in one shot. Live probe is the only reliable auth check across all three vendors (auth state isn't inspectable offline). Costs ~1 tiny invocation per agent.
- **D-27:** Triggers: explicit `mar preflight` command, AND automatically at run start (consumed by Phase 3's `mar run`) with a short-lived result cache (~10 min) so back-to-back runs don't re-probe. `mar invoke` does NOT auto-preflight.
- **D-28:** Output: per-agent status table — installed ✓/✗ with version, probe ✓/✗ with latency, actionable hint on failure (e.g., "run: codex login"). Exit 0 = all pass, exit 1 = any fail (scriptable). Also writes a machine-readable preflight result JSON for the run-start cache.

### Multi-vendor failure UX (ORCH-04)
- **D-29:** <2-distinct-vendors gate: HARD refusal at run start, no override flag. Error names the vendors found. Single-vendor review defeats the project premise (PROJECT.md lists it as out of scope). `mar invoke` (single invocation, not a review run) is exempt from the gate.
- **D-30:** Partial pre-flight failure at run start: BLOCK by default showing the failure table; optional `--skip-failed` drops failing agents and proceeds ONLY if ≥2 distinct vendors remain healthy — the diversity invariant is never compromised.
- **D-31:** Gemini/Antigravity churn risk surfaces via preflight hints only (explain the June 18, 2026 transition, point at paid-tier/API-key options when the gemini probe fails). No special-casing elsewhere — gemini stays a plain swappable adapter.

### Research-resolved decisions (post-discussion)
- **D-32:** Gemini adapter is FIXTURE-BUILT and preflight-hinted (user confirmed). Gemini auth is currently broken on this machine (exit 41 no-auth-method / exit 1 ProjectIdRequiredError / exit 55 trusted-dir gate — see 02-RESEARCH.md). Build the adapter against fake-gemini.mjs mirroring documented shapes; `mar preflight` showing gemini ✗ with an actionable auth hint is CORRECT behavior, not a bug. ORCH-04 is satisfied by claude+codex. Gemini's error JSON goes to STDERR — adapter parses stdout-or-stderr; do not allowlist gemini exit codes.
- **D-33:** Probe prompt "Reply with exactly: pong", probe timeout ~30s (codex retries auth 5x internally, inflating failure latency), probe retries: 0.
- **D-34:** `mar.config.json` is committed to the repo (not gitignored) — roster is project configuration.
- **D-35:** No new dependencies for retry/backoff/NDJSON-parsing/PATH-detection — plain TS on the existing stack (p-retry evaluated and rejected by research).

### Claude's Discretion
- Exact probe prompt content and probe timeout value
- Codex adapter specifics (stderr/stdout split handling, `--ephemeral`, `--skip-git-repo-check`, sandbox flags) and gemini adapter specifics — follow the STACK.md flag tables and pin behavior in adapter tests like Phase 1 did for claude
- Preflight cache file location/format (suggestion: under a `.mar/` or OS temp dir — NOT in `runs/`)
- zod schema details for mar.config.json and validation error formatting
- How `extraArgs` merges with adapter-owned argv (append-only recommended)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (load-bearing)
- `.planning/research/STACK.md` — verified per-CLI headless flag tables (codex stderr/stdout split, `--output-schema`, gemini `--output-format json` shape, Antigravity transition details). The codex/gemini tables are THE spec for the new adapters.
- `.planning/research/PITFALLS.md` — auth-expiry/rate-limit/sandbox pitfalls; 429-as-retryable guidance; pre-flight probe rationale.
- `.planning/research/ARCHITECTURE.md` — adapter layer boundary, component structure.

### Phase 1 contracts (build on, don't break)
- `.planning/phases/01-workspace-first-adapter/01-CONTEXT.md` — D-01..D-17 (stack, adapter interface, workspace, logging, timeout decisions).
- `.planning/phases/01-workspace-first-adapter/01-REVIEW.md` — fixed findings; the 4 open Info findings; invariants the fixes established (yamlScalar escaping, nextSeq, redactedCommand).
- `src/adapters/adapter.ts` — the `AgentAdapter`/`TurnRequest`/`TurnResult` contract all new adapters implement.
- `src/adapters/claude.ts` — reference adapter implementation (splitBin, ok-rule, redactedCommand, flag-pinning test pattern in `test/claude-adapter.test.ts`).

### Project planning
- `.planning/PROJECT.md` — out-of-scope list (single-vendor review, vendor APIs).
- `.planning/REQUIREMENTS.md` — ORCH-02..05 definitions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AgentAdapter` interface (`src/adapters/adapter.ts`): codex/gemini adapters implement it unchanged; the retry wrapper wraps it.
- `makeClaudeAdapter` (`src/adapters/claude.ts`): the template for new adapters — injectable bin via `splitBin`, execa argv arrays, per-vendor ok-rule, `redactedCommand`, zod normalization to `TurnResult`.
- Fake-CLI fixture pattern (`test/fixtures/fake-claude.mjs` + flag-pinning tests): replicate as `fake-codex.mjs` / `fake-gemini.mjs` so adapter + retry + preflight tests burn zero real credits.
- `logInvocation` (`src/log/invocation.ts`): extend records with attempt number (D-25) rather than creating a parallel log.
- zod schemas in `src/schema/`: add `mar.config.json` roster schema alongside.

### Established Patterns
- Per-vendor quirks live ONLY in the adapter; protocol/CLI layers see normalized `TurnResult` — codex's stderr/stdout split must not leak upward.
- Success determination in the adapter tier (`turn.ok`), never re-derived at CLI tier.
- Atomic temp+rename for any new on-disk state (preflight cache JSON).
- TDD pattern from Phase 1 (RED commit → GREEN commit) with vitest.

### Integration Points
- `src/cli.ts`: gains `init` and `preflight` subcommands; `invoke` switches from hardcoded vendor to roster-name resolution (D-20).
- Phase 3's `mar run` will call: roster loader, vendor-distinctness gate, preflight-with-cache, retry-wrapped adapter invocations — design these as composable functions, not CLI-only code paths.

</code_context>

<specifics>
## Specific Ideas

- Preflight output format mirrors the approved preview: one line per agent (`claude-1  claude 2.1.162  ✓ installed  ✓ responsive (2.1s)`), failure hint lines (`↳ hint: run \`codex login\``), summary line with exit code.
- Roster example shape approved: `{ "agents": [{ "name": "claude-1", "vendor": "claude" }, ...], "defaults": { "timeoutMs": 600000, "retries": 1 } }` — note the discussion settled defaults.retries at 2, not 1.

</specifics>

<deferred>
## Deferred Ideas

- Antigravity CLI adapter (when it ships) and Grok adapter — architecture allows, don't build (v2 ORCH-07).
- Cost/token tracking per invocation (v2 COST-01).

</deferred>

---

*Phase: 2-Adapter Layer + Roster + Pre-flight*
*Context gathered: 2026-06-04*
