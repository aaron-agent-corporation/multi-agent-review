---
phase: 5
slug: hardening-resume-gating-majority-guards
status: secured
threats_open: 0
asvs_level: 1
created: 2026-06-06
---

# Phase 5 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Human gate input → engine | Feedback notes and arbitration rulings typed at gates | attacker-influenceable free text reaching prompts and the ledger |
| Resume entry → completed run state | `mar resume` trusts on-disk manifest + artifacts from a prior session | potentially tampered artifacts, decayed CLI auth |
| CLI run-id argument → filesystem | `<run-id>` builds the run directory path | path components |
| Agent artifacts → resolved-decisions ledger | Agent-authored settlements parsed and re-served to later phases | attacker-influenceable YAML |
| Packaged binary → template resolution | Compiled dist layout must match resolver expectations | availability |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-05-01 | Tampering | ancestor/global instruction override | mitigate | SOLE FORMAT CONTRACT ancestor-ignore directive (tmpl:15-35); live zero-leakage evidence | closed |
| T-05-02 | DoS | packaged-binary template ENOENT | mitigate | 05-07 corrected copy → dist/src/templates; bin → dist/src/cli.js; resolver-truth + compiled-CLI-run guard test | closed |
| T-05-03 | Spoofing | `--bare` regression breaking subscription auth | mitigate | flag-pin test asserts `--bare` absent (claude-adapter.test.ts:138) | closed |
| T-05-04 | Tampering | preamble artifact dropped by strict reader | mitigate | ONE shared tolerant reader (frontmatter.ts:30-66) consumed by all readers | closed |
| T-05-05 | EoP | YAML deserialization via crafted frontmatter | mitigate | gray-matter READ-only, js-yaml SAFE load; no matter.stringify in any write path | closed |
| T-05-06 | Tampering | paused status treated as terminal | mitigate | single RESUMABLE_STATUSES/TERMINAL_DONE source, compile-typed (manifest.ts:44-51) | closed |
| T-05-07 | Spoofing | 1-1 tie resolved as majority | mitigate | clearMajority `> rosterSize/2`, null on tie (converge.ts:145-155); escalate tests | closed |
| T-05-08 | Tampering | running tally anchoring rounds | mitigate | tally computed only at exit boundary; never enters a round prompt (converge.ts:246,281) | closed |
| T-05-09 | Tampering | corrupted completed artifact into resume | mitigate | revalidateForResume re-parses every completed artifact with specific refusals (engine.ts:1235-1282) | closed |
| T-05-10 | Tampering | run-id path traversal | mitigate | RUN_ID_RE `/^[A-Za-z0-9_-]+$/` before runDir resolution (cli.ts:33,214,482,499) | closed |
| T-05-11 | DoS | resume hang via restored mid-flight actor | mitigate | re-derivation only; no snapshot persistence APIs in resume path (engine.ts:1335-1343) | closed |
| T-05-12 | Spoofing | resume with decayed CLI auth | mitigate | runPreflight at resume with per-agent refusal (engine.ts:1273-1279) | closed |
| T-05-13 | EoP | vendor-floor bypass on resume | mitigate | applySkipFailed ≥2-distinct-vendor floor every phase (gates.ts:30-32, engine.ts:585); full-roster restore on failed/timeout | closed |
| T-05-14 | Tampering | human feedback note injection | mitigate | note-only injection, control chars stripped, contract never in prompt (gating.ts:141-145); stored with attribution+timestamp | closed |
| T-05-15 | DoS | blocking gate hangs scripted/CI run | mitigate | isTTY guard + non-TTY default-autonomous + ask() seam (cli.ts:39-48,80-90) | closed |
| T-05-16 | Repudiation | arbitration without rationale/attribution | mitigate | resolver:"human" + rationale required and persisted (gating.ts:260-303) | closed |
| T-05-17 | EoP | YAML/key injection via crafted rationale | mitigate | hand-rolled injection-safe serializer for ledger writes (resolved-decisions.ts:36-73); reads stay safe-load | closed |
| T-05-18 | Tampering | agent reopens settled decision | mitigate | inject (template directive) + enforce (detectRelitigation/enforceDrop, drop+warn no retry) (resolved-decisions.ts:180-258, engine.ts:540-556) | closed |
| T-05-19 | DoS | digest bloat / thin-prompt violation | mitigate | one line per fork; prompts reference the file, never inline it (resolved-decisions.ts:80-93, tmpl:35) | closed |
| T-05-20 | DoS | concurrent ledger appends lose entries | mitigate | per-runDir serializeWrite promise-chain mutex + temp-then-rename (manifest.ts:35-49) | closed |

*Status: open · closed*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-01 | T-05-20 | serializeWrite mutex is in-process only; cross-process concurrent writers are out of scope for the single-process engine | user (audit) | 2026-06-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit 2026-06-06

| Metric | Count |
|--------|-------|
| Threats found | 20 |
| Closed | 20 |
| Open | 0 |

Auditor: read-only verification of plan-time register against implementation (ASVS L1). All mitigations evidence-cited (file:line). T-05-02 judged against the corrected 05-07 gap-closure state. One documented limitation logged as accepted risk (in-process-only ledger mutex).
