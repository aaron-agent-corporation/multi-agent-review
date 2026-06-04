---
phase: 2
slug: adapter-layer-roster-pre-flight
status: draft
nyquist_compliant: false
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
| (filled by planner) | — | — | ORCH-02, ORCH-03, ORCH-04, ORCH-05 | — | — | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
