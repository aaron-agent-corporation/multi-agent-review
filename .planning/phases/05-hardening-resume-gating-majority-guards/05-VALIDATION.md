---
phase: 5
slug: hardening-resume-gating-majority-guards
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-05
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing — 33 files / 267 tests green at phase start) |
| **Config file** | none needed — `vitest run` via package.json |
| **Quick run command** | `npx vitest run <touched test files>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds full suite |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test files>` plus `npx tsc --noEmit`
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner — every plan task maps here; hermetic fake-CLI fixtures per D-49) | | | PROT-05/06, RSLV-02/03, RCRD-02 | | | unit/integration | `npm test` | ⬜ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Validation architecture per requirement (from 05-RESEARCH.md §Validation Architecture):
- **PROT-05 (gating):** hermetic test drives a gated run with an injected `ask()` seam (no real TTY); asserts pause status written at boundary, feedback note injected into next-phase prompts, abort path.
- **PROT-06 (resume):** kill a fixture run mid-phase → `mar resume` re-derives machine from manifest, re-validates artifacts (tolerant reader), re-runs interrupted phase; failed-run resume re-attempts with full roster.
- **RSLV-02 (majority):** 3-fixture run pinned to disagree until cap → clearMajority(2-1) picks base; assert no plurality win on 1-1 (escalates).
- **RSLV-03 (escalation):** gated deadlock → arbitration prompt (injected seam) records `resolver: human`; autonomous → open decision logged.
- **RCRD-02 (guard):** resolved-decisions.md appended per settled fork; digest visible to later-phase fixtures; re-litigating fixture position dropped with `re-litigation` reason.

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — vitest + fake-CLI fixtures (`test/fixtures/fake-*.mjs`) are established. Fixture extensions needed (not new infra): scripted disagree-until-cap mode, re-litigation-attempt mode, and a kill-mid-phase harness — planned as tasks within the phase, not Wave 0.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Blocking TTY prompt ergonomics (real terminal) | PROT-05 | isTTY behavior and prompt UX can't be fully simulated | Run `mar run <doc>`, choose gated; verify prompt renders, approve/abort/feedback work |
| Live gated arbitration feel | RSLV-03 | Human judgment of arbitration presentation | Force a live escalation or use fixtures in a TTY; verify positions+evidence display |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
