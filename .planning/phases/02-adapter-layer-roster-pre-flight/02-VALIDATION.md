---
phase: 2
slug: adapter-layer-roster-pre-flight
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-04
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (existing — vitest.config.ts from Phase 1) |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run <touched test file> --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5-15 seconds (fake-CLI fixtures only; retry backoff must use injected/zero delays in tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test file> --reporter=dot`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green (Phase 1's 50 tests + Phase 2 additions)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 02-01 | 1 | ORCH-03 | T-02-02 | zod `.safeParse` per NDJSON line + gemini JSON; unparseable → graceful ok:false | unit (RED) | `npx vitest run test/codex-adapter.test.ts test/gemini-adapter.test.ts; test $? -ne 0` | ❌ W0 | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | ORCH-03 | T-02-01, T-02-03, T-02-04, T-02-05 | execa array argv (no shell); `-s read-only` pinned; redactArgv swaps prompt for `<prompt>` | unit | `npx vitest run test/codex-adapter.test.ts test/gemini-adapter.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-01-T3 | 02-01 | 1 | ORCH-03 | — | vendor selection via typed FACTORIES map (keyof guard) | unit | `npx vitest run test/registry.test.ts test/codex-adapter.test.ts test/gemini-adapter.test.ts test/claude-adapter.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-02-T1 | 02-02 | 1 | ORCH-02 | T-02-07, T-02-08 | auth strings classify fatal (zero retries); per-attempt log carries no prompt body | unit | `npx vitest run test/invocation.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-02-T2 | 02-02 | 1 | ORCH-02 | T-02-06 | bounded retries; fatal stops auth loop; fake timers (no real waits) | unit | `npx vitest run test/retry.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-03-T1 | 02-03 | 1 | ORCH-03 | T-02-10 | MarConfig.parse rejects unknown vendor / dup name before reaching adapter | unit | `npx vitest run test/config.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-03-T2 | 02-03 | 1 | ORCH-04 | T-02-12 | assertReviewable hard gate (no override); <2 distinct vendors refused | unit | `npx vitest run test/gates.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-03-T3 | 02-03 | 1 | ORCH-03 | T-02-11 | PATH-walk via existsSync only — no shell, no `which` spawn | unit | `npx vitest run test/init.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-04-T1 | 02-04 | 2 | ORCH-05 | T-02-14 | cache validated by PreflightCache.parse; TTL bounds trust; atomic temp+rename | unit | `npx vitest run test/preflight.test.ts -t 'version\|cache\|TTL\|fresh' --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-04-T2 | 02-04 | 2 | ORCH-05 | T-02-13, T-02-15, T-02-16 | single tiny probe (retries:0, ~30s); hints name env vars never values; probe read-only argv | unit | `npx vitest run test/preflight.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-05-T1 | 02-05 | 3 | ORCH-02, ORCH-03, ORCH-05 | T-02-17, T-02-18, T-02-19, T-02-20 | agent resolved against validated roster; persistence branches only on final turn.ok; withRetry bounded | unit | `npx vitest run test/cli-roster.test.ts test/e2e-invoke.test.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 02-05-T2 | 02-05 | 3 | ORCH-03, ORCH-05 | — | live round-trip; promptRef only in log (no body); gemini ✗-with-hint correct (D-32) | manual (human-verify) | MANUAL — live `mar init`/`preflight`/`invoke` round-trip (burns credits, interactive auth; see plan) | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** No 3 consecutive tasks lack an automated `<verify>`. The only non-automated task (02-05-T2, live human-verify) is immediately preceded by 11 automated tasks and is the terminal task of the phase — continuity holds.

---

## Wave 0 Requirements

- [ ] `test/fixtures/fake-codex.mjs` — NDJSON event-stream fixture mirroring LIVE-VERIFIED codex 0.128.0 shapes (turn.completed success, turn.failed, auth-401-retry, hang modes)
- [ ] `test/fixtures/fake-gemini.mjs` — fixture mirroring documented gemini shapes incl. error-JSON-on-STDERR, exit 41/55 modes (per 02-RESEARCH.md — real gemini unavailable on this machine)
- [ ] Test stubs: roster config schema (ORCH-03), retry wrapper transient classification + attempt logging (ORCH-02), vendor-distinctness gate (ORCH-04), preflight tiers + table output (ORCH-05), codex/gemini adapter normalization + flag-pinning
- [ ] Retry tests MUST inject zero/near-zero backoff delays — no real 15-60s waits in the suite

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live codex invocation through `mar invoke` | ORCH-03 | Real CLI burns credits; proves codex adapter against the real binary | `npx tsx src/cli.ts invoke --agent codex-1 --prompt "Reply with exactly: pong"` after `mar init`; check artifact + manifest + log |
| Live `mar preflight` on real machine | ORCH-05 | Real auth states (claude ✓, codex ✓, gemini ✗ expected) | Run `npx tsx src/cli.ts preflight`; expect claude/codex responsive, gemini ✗ with auth hint, exit 1 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned
