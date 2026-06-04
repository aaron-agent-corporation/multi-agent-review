---
phase: 1
slug: workspace-first-adapter
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (per Phase 1 research) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds (fake-CLI fixtures, no real claude invocations) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=dot`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | — | — | ORCH-01, ORCH-06, PROT-02, PROT-07 | — | — | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] vitest installed and configured (no framework exists — greenfield)
- [ ] `tests/fixtures/fake-claude.mjs` — fake-CLI fixture (`--hang`, `--fail-auth`, `--bad-json` modes) so adapter tests never invoke real claude
- [ ] Test stubs for adapter normalization (ORCH-01), invocation logging (ORCH-06), artifact naming (PROT-02), manifest schema (PROT-07)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `claude -p --output-format json` invocation produces a normalized artifact end-to-end | ORCH-01 | Real CLI burns subscription credits; CI can't auth | Run `mar invoke --agent claude --prompt "say hello"` once; check `runs/<id>/` for artifact + manifest + invocations.ndjson |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
