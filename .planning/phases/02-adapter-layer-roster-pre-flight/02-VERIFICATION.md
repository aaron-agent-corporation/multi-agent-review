---
phase: 02-adapter-layer-roster-pre-flight
verified: 2026-06-04T22:05:00Z
status: passed
score: 20/20 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
gaps: []
deferred: []
human_verification: []
notes:
  - "REQUIREMENTS.md traceability drift (non-blocking): ORCH-04 is implemented and verified in src/gates.ts (assertReviewable refuses <2 distinct vendors) and tested, but REQUIREMENTS.md still lists ORCH-04 as `[ ]` (line 15) and `Pending` (line 95). Update REQUIREMENTS.md to Complete. Does not affect goal achievement — code evidence is conclusive."
---

# Phase 2: Adapter Layer + Roster + Pre-Flight Verification Report

**Phase Goal:** A user can configure a roster of distinct-vendor agents and the system reliably drives each through a uniform adapter contract, refusing to start unsafe rosters and surfacing CLI problems before a run begins.
**Verified:** 2026-06-04T22:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

The phase goal decomposes into four observable capabilities, all verified against the codebase:

1. **Configure a roster of distinct-vendor agents** → `src/schema/config.ts` (discriminated union on vendor) + `src/config.ts` (loadConfig/resolveAgent) + `src/init.ts` (detectVendors/writeStarterConfig). VERIFIED.
2. **Drive each through a uniform adapter contract** → `src/adapters/{claude,codex,gemini}.ts` all implement the unchanged `AgentAdapter` interface; `src/adapters/registry.ts` `makeAdapter(vendor, bin?, model?)` is the single seam (ORCH-03). No vendor field names leak into `TurnResult`. VERIFIED.
3. **Refuse to start unsafe rosters** → `src/gates.ts` `assertReviewable` throws when `<2` distinct vendors (ORCH-04). VERIFIED.
4. **Surface CLI problems before a run** → `src/preflight.ts` `runPreflight` tiered check + actionable hints + cache; `mar preflight` exits 0/1 (ORCH-05). VERIFIED.

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | codex adapter drives `codex exec --json`, parses NDJSON, returns normalized TurnResult (ok = turn.completed + exit 0) | ✓ VERIFIED | `src/adapters/codex.ts` buildArgv `["exec","--json","--skip-git-repo-check","--ephemeral","-s","read-only"]`; CodexEvent.safeParse per line; tests green |
| 2   | gemini adapter drives `gemini -p --output-format json`, parses JSON from stdout-OR-stderr | ✓ VERIFIED | `src/adapters/gemini.ts`; stdout-or-stderr parse (D-32); `test/gemini-adapter.test.ts` green incl. STDERR fail-auth |
| 3   | vendor→adapter registry returns correct adapter; adding a vendor is one map entry | ✓ VERIFIED | `src/adapters/registry.ts` FACTORIES {claude,codex,gemini}; `test/registry.test.ts` asserts exact keys |
| 4   | all three adapters satisfy unchanged AgentAdapter; no vendor field names leak into TurnResult | ✓ VERIFIED | leak grep on registry empty (exit 1); tsc clean; TurnResult unchanged |
| 5   | each factory captures optional model in closure; buildArgv appends vendor model flag | ✓ VERIFIED | codex `-m <model>`; `makeAdapter(vendor,bin,model)` threads through; flag-pinning tests green |
| 6   | withRetry retries TRANSIENT (429/timeout/unparseable) and NEVER FATAL (auth) | ✓ VERIFIED | `src/retry.ts` classify{Claude,Codex,Gemini}; fatal returns immediately |
| 7   | default 2 retries (3 attempts), exp backoff + jitter, honors retry-after hint | ✓ VERIFIED | DEFAULT_RETRIES=2; retryAfterMs overrides computed backoff; fake-timer tests |
| 8   | every attempt (incl. failed) logged with attempt number to invocations.ndjson | ✓ VERIFIED | onAttempt → logInvocation; `test/cli-roster.test.ts` asserts attempts === [1,2] |
| 9   | retry backoff tests use fake timers — no real waits | ✓ VERIFIED | `test/retry.test.ts` (suite runs 22s for 169 tests, no 15-60s stalls) |
| 10  | valid mar.config.json parses to typed roster; per-vendor discriminated union; invalid → clear error | ✓ VERIFIED | `src/schema/config.ts` z.discriminatedUnion("vendor", ...) |
| 11  | mar invoke --agent resolves against roster names ONLY; unknown name lists valid names | ✓ VERIFIED | `src/config.ts` resolveAgent; cli-roster test "unknown --agent ... exits 2" |
| 12  | roster <2 distinct vendors HARD-refused naming vendors; single-vendor still LOADS | ✓ VERIFIED | `src/gates.ts` assertReviewable throws naming vendors; config has no count enforcement |
| 13  | mar init probes PATH for claude/codex/gemini, writes starter config listing detected vendors | ✓ VERIFIED | `src/init.ts` detectVendors/writeStarterConfig; live checkpoint wrote 3-vendor config |
| 14  | preflight tiered check: tier-1 bin+version, tier-2 live probe (auth+responsiveness) | ✓ VERIFIED | `src/preflight.ts` runPreflight composes makeAdapter + withRetry(retries:0) |
| 15  | per-agent status: installed+version, probe+latency, actionable hint; gemini auth/Antigravity hint | ✓ VERIFIED | hintFor() gemini hint cites settings.json/GEMINI_API_KEY + 2026-06-18 cutoff (D-31) |
| 16  | preflight writes machine-readable cache outside runs/ with ~10min TTL; exit 0 all-pass/1 any-fail | ✓ VERIFIED | `.mar/preflight.json`, CACHE_TTL_MS=600000, gitignored; cli-roster exit-code tests |
| 17  | codex version extractor returns semver not "codex-cli" | ✓ VERIFIED | extractVersion; live manifest cliVersions.codex="0.128.0" |
| 18  | mar init writes config; mar preflight prints table+exit; mar invoke resolves by name through withRetry | ✓ VERIFIED | `src/cli.ts` init/preflight subcommands; invoke = loadConfig→resolveAgent→makeAdapter→withRetry |
| 19  | mar invoke EXEMPT from >=2-vendor gate, does NOT auto-preflight; every attempt logged | ✓ VERIFIED | cli-roster tests: single-vendor invoke exit 0; no .mar/preflight.json written by invoke |
| 20  | existing e2e-invoke stays green after invoke switches to roster-name resolution | ✓ VERIFIED | `test/e2e-invoke.test.ts` green; full suite 169/169 |

**Score:** 20/20 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/adapters/common.ts` | shared splitBin/safeJsonParse/redactArgv | ✓ VERIFIED | exists, imported by adapters |
| `src/adapters/codex.ts` | makeCodexAdapter NDJSON adapter + `-m` | ✓ VERIFIED | exists, wired in registry |
| `src/adapters/gemini.ts` | makeGeminiAdapter stdout-or-stderr | ✓ VERIFIED | exists, wired in registry |
| `src/adapters/registry.ts` | makeAdapter(vendor,bin?,model?) seam | ✓ VERIFIED | FACTORIES map, threads bin+model |
| `src/schema/turn.ts` | CodexEvent + GeminiJson zod schemas | ✓ VERIFIED | 6 passthrough() (>=3 required) |
| `test/fixtures/fake-codex.mjs` | NDJSON fixture modes | ✓ VERIFIED | executable; +rate-limit-once mode |
| `test/fixtures/fake-gemini.mjs` | JSON fixture, stderr fail modes | ✓ VERIFIED | executable |
| `src/retry.ts` | withRetry + classifiers | ✓ VERIFIED | exports withRetry, classify{Claude,Codex,Gemini} |
| `src/log/invocation.ts` | InvocationRecord + attempt field | ✓ VERIFIED | attempt logged per call |
| `src/schema/config.ts` | MarConfig discriminated union | ✓ VERIFIED | z.discriminatedUnion("vendor") + model |
| `src/config.ts` | loadConfig + resolveAgent | ✓ VERIFIED | single name-resolution path |
| `src/gates.ts` | distinctVendors + assertReviewable | ✓ VERIFIED | size<2 throws naming vendors |
| `src/init.ts` | detectVendors + writeStarterConfig | ✓ VERIFIED | PATH detection, no shell |
| `src/schema/preflight.ts` | PreflightCache zod schema | ✓ VERIFIED | exists |
| `src/preflight.ts` | runPreflight + extractVersion + cache | ✓ VERIFIED | composes registry+retry |
| `src/cli.ts` | init+preflight+roster invoke | ✓ VERIFIED | old guard removed (count 0), withRetry x3 |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| registry.ts | {claude,codex,gemini}.ts | FACTORIES map | ✓ WIRED | imports + map entries confirmed |
| codex.ts | schema/turn.ts | CodexEvent.safeParse | ✓ WIRED | per-line parse loop |
| retry.ts | node:timers/promises | setTimeout sleep | ✓ WIRED | import + backoff sleep |
| retry.ts | log/invocation.ts | onAttempt → logInvocation | ✓ WIRED | per-attempt audit |
| config.ts | schema/config.ts | MarConfig.parse | ✓ WIRED | typed roster |
| gates.ts | roster agents | new Set(map vendor) | ✓ WIRED | distinctVendors |
| preflight.ts | registry.ts | makeAdapter + withRetry(retries:0) | ✓ WIRED | probe composes adapters |
| preflight.ts | .mar/preflight.json | atomic temp+rename | ✓ WIRED | writeCache |
| cli.ts invoke | config + registry | loadConfig→resolveAgent→makeAdapter | ✓ WIRED | hardcoded guard removed |
| cli.ts invoke | retry.ts | withRetry wrapping invoke | ✓ WIRED | grep count 3 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Type contracts hold | `npx tsc --noEmit` | exit 0, clean | ✓ PASS |
| Full fixture-driven suite | `npx vitest run` | 169/169 pass (18 files), 22s | ✓ PASS |
| No vendor field leak past adapter | grep registry for turn.completed/is_error/response | empty (exit 1) | ✓ PASS |
| Old hardcoded claude guard gone | `grep -c 'opts.agent !== "claude"' src/cli.ts` | 0 | ✓ PASS |
| withRetry at CLI call site | `grep -c withRetry src/cli.ts` | 3 | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared for this phase. Probe-equivalent verification is the live human-verify checkpoint (plan 02-05) — already PASSED on the user's machine (mar init / preflight / invoke round-trip with codex-1 and claude-1), treated as human-verified per the task instruction. Automated suite (169/169) covers fixture-driven equivalents.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| ORCH-02 | 02-02, 02-05 | Configurable timeout + bounded retry; hung agent never blocks | ✓ SATISFIED | withRetry (2 retries, backoff+jitter, transient-only); per-adapter timeout guard; wired at CLI |
| ORCH-03 | 02-01, 02-03 | Define roster (name, vendor, command, model); adding vendor needs no protocol change | ✓ SATISFIED | discriminated-union config + makeAdapter registry seam (one map entry per vendor) |
| ORCH-04 | 02-03 | Refuse run with <2 distinct vendors | ✓ SATISFIED | gates.ts assertReviewable throws size<2; single-vendor still loads (invoke-exempt) |
| ORCH-05 | 02-04, 02-05 | Pre-flight each roster CLI (installed/authenticated/responsive) | ✓ SATISFIED | runPreflight tiered check + cache + hints; mar preflight exit 0/1; live-verified gemini ✗ hint |

All four phase requirement IDs (ORCH-02, ORCH-03, ORCH-04, ORCH-05) declared in PLAN frontmatter are accounted for and satisfied. No orphaned requirements: REQUIREMENTS.md maps exactly these four IDs to Phase 2.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX debt markers in any phase source file | — | grep exit 1 (none found) |

The two `// WR-04` comments in codex.ts/gemini.ts are decision-ID references, not debt markers (confirmed: no TODO/HACK/PLACEHOLDER on those lines). `PROMPT_PLACEHOLDER` is a redaction constant, not a stub.

### Human Verification Required

None outstanding. The live CLI round-trip (mar init → preflight → invoke for codex-1 and claude-1, gemini ✗ with auth hint, exit 1) was human-verified during execution (plan 02-05 checkpoint, APPROVED) and is treated as conclusive per the verification task note. No credit-burning re-runs required.

### Documentation Drift (non-blocking)

REQUIREMENTS.md is stale for ORCH-04: it is marked `[ ]` (line 15) and `Pending` (traceability line 95), but ORCH-04 is fully implemented (`src/gates.ts` assertReviewable) and tested (`test/gates.test.ts`, `test/cli-roster.test.ts`). The 02-05-SUMMARY `requirements-completed` correctly omits ORCH-04 (it belongs to plan 02-03, whose SUMMARY should mark it complete). This is documentation lag, not a goal gap — recommend updating REQUIREMENTS.md line 15 to `[x]` and line 95 to `Complete`. Does not block the phase.

### Gaps Summary

No gaps. All 20 must-have truths across the five plans verify against the codebase. The phase goal — a user configures a distinct-vendor roster, the system drives each through a uniform adapter contract, refuses unsafe (<2 vendor) rosters, and surfaces CLI problems via pre-flight before a run — is achieved and demonstrably wired end-to-end (registry → retry → gates → preflight → CLI), proven by 169/169 fixture-driven tests, clean tsc, and a human-approved live round-trip. The only follow-up is cosmetic REQUIREMENTS.md status hygiene for ORCH-04.

---

_Verified: 2026-06-04T22:05:00Z_
_Verifier: Claude (gsd-verifier)_
