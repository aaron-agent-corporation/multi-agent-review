---
phase: 1
slug: workspace-first-adapter
status: planned
nyquist_compliant: true
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
| **Config file** | `vitest.config.ts` — created by Plan 01 Task 1 (Wave 0) |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds (fake-CLI fixtures, no real claude invocations) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test file> --reporter=dot`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | PROT-02, PROT-07 | T-01-04 | runs/ gitignored; fixture mirrors verified JSON; e2e anchor RED | scaffold + fixture | `npx vitest run test/e2e-invoke.test.ts` (expect RED) | ❌ W0 | ⬜ pending |
| 01-01-T2 | 01 | 1 | PROT-02, PROT-07 | T-01-01 | deterministic naming, no path-traversal in ids; vendor-agnostic TurnResult | unit | `npx vitest run test/workspace.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-T3 | 01 | 1 | PROT-02, PROT-07 | T-01-02, T-01-03 | atomic temp+rename; done=exists AND non-empty; disk re-derivable | unit | `npx vitest run test/manifest.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-T1 | 02 | 2 | ORCH-01 | T-01-05, T-01-06, T-01-07, T-01-09 | no-shell argv; ok=exit0 AND !is_error; timeout kill; no --bare/subtype | unit (fake-CLI) | `npx vitest run test/claude-adapter.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-T2 | 02 | 2 | ORCH-06 | T-01-08 | NDJSON one-record-per-call; promptRef not content; no key logged | unit | `npx vitest run test/invocation.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-T1 | 03 | 3 | ORCH-01, ORCH-06, PROT-02, PROT-07 | T-01-10, T-01-11, T-01-13 | run-id sanitized; console progress only; ok from adapter | e2e (fake-CLI) | `npx vitest run test/e2e-invoke.test.ts` (expect GREEN) | ❌ W0 | ⬜ pending |
| 01-03-T2 | 03 | 3 | ORCH-01 | T-01-12 | live real-claude smoke (human checkpoint) | manual | (human-verify checkpoint) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (all created in Plan 01 Task 1)

- [ ] vitest installed and configured (`vitest.config.ts`) — greenfield
- [ ] Project scaffold: `package.json` (`"type":"module"`), `tsconfig.json` (nodenext), `biome.json`, `.gitignore` (with `runs/`)
- [ ] `test/fixtures/fake-claude.mjs` — fake-CLI fixture (`--hang`, `--fail-auth`, `--bad-json`, happy) so adapter tests never invoke real claude
- [ ] `test/e2e-invoke.test.ts` (RED anchor), `test/workspace.test.ts`, `test/manifest.test.ts` (Plan 01); `test/claude-adapter.test.ts`, `test/invocation.test.ts` (Plan 02)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `claude -p --output-format json` invocation produces a normalized artifact end-to-end | ORCH-01 | Real CLI burns subscription credits; CI can't auth | Run `npx tsx src/cli.ts invoke --agent claude --prompt "say hello"` once; check `runs/<id>/` for artifact + .raw.json + manifest (status completed) + invocations.ndjson — Plan 03 Task 2 checkpoint |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned
