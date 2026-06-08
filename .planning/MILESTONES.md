# Milestones

## v1.0 MVP (Shipped: 2026-06-07)

**Delivered:** A vendor-neutral orchestrator that drives 3 frontier-model CLIs (claude, codex, gemini) through a structured 6-phase adversarial review protocol producing a decision record — resumable, gateable, and guarded against re-litigation.

**Stats:** 5 phases · 23 plans · 32 tasks · ~5,700 LOC src + ~6,700 LOC tests · 40 test files / 315 tests · 42 feat commits · 2026-06-04 → 2026-06-07 · git range Phase 1 → 05-07.

**Key accomplishments:**

- **Phase 1** — `mar invoke`: drives a vendor CLI headlessly into a deterministic, manifest-indexed run workspace with normalized artifacts, raw siblings, and an NDJSON invocation log (ORCH-01/06, PROT-02/07).
- **Phase 2** — swappable per-vendor adapter layer + registry, `mar.config.json` roster, retry-with-backoff, and tiered preflight (install + live probe); ≥2-distinct-vendor floor enforced (ORCH-02/03/04/05).
- **Phase 3** — XState v5 6-phase engine with enforced turn-taking and structural draft independence (scoped workdirs, promote-at-boundary), proven by a falsifiable planted-error A/B test; skip-failed resilience (PROT-01/03/04).
- **Phase 4** — first complete LIVE 3-vendor run: zod-validated structured reviews/responses, seeded format contract, validation-with-one-retry gate, evidence-grounded convergence loop, single designated integrator with per-addition verdicts, and a contested-only decision record (REVW-01..05, RSLV-01, RCRD-01) — the v1 success bar.
- **Phase 5** — hardening: resume from last completed phase (re-derivation, full-roster restore on failure), per-run autonomous/gated mode with approve/abort/feedback gates and human arbitration, majority tie-break at cap/deadlock, and a rolling resolved-decisions ledger guarding against re-litigation (PROT-05/06, RSLV-02/03, RCRD-02).

**Quality gates:** 24/24 requirements satisfied (3-source agreement) · all 5 phases verified passed · cross-phase integration verified end-to-end on the compiled binary · 2 security audits, 38 threats closed.

**Known deferred items at close (1):** Phase 03 HUMAN-UAT.md — status passed, 0 pending scenarios (the human-verification item was covered by an added regression test); flagged only by HUMAN-UAT category. Non-blocking.

**Tech debt carried forward:** in-process-only ledger mutex (AR-05-01) · gemini free-tier sunset 2026-06-18 (swappable adapter) · phases 1–4 lack formal VALIDATION.md (coverage met by the 315-test suite).

---
