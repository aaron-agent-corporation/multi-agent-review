---
phase: 4
slug: first-end-to-end-run
status: secured
threats_open: 0
asvs_level: 1
created: 2026-06-06
---

# Phase 4 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| npm install | Third-party dependency (gray-matter) enters the runtime | package code (supply chain) |
| Agent CLI output → engine | Frontmatter authored by external frontier models is parsed/validated | attacker-influenceable YAML + markdown |
| Seeded instruction files → agent context | Format contract vs. ancestor/global instruction files | prompt-level control plane |
| Run workspace filesystem | Agent names and artifact paths build filesystem paths | path components |
| Vendor env/auth (GEMINI_API_KEY etc.) → adapters | Credentials present in process env during invocation | secrets |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-04-SC | Tampering | gray-matter supply chain | mitigate | blocking-human legitimacy checkpoint; no pre/postinstall (package.json); pinned ^4.0.3 | closed |
| T-04-01 | Tampering | agent frontmatter shape | mitigate | zod safeParse per phase schema (phases.ts:73-75; src/schema/*) | closed |
| T-04-02 | EoP | YAML deserialization | accept | all matter() calls text-only, default js-yaml SAFE load; writes via hand-rolled serializer | closed |
| T-04-03 | Tampering | instruction-file inheritance | mitigate | seeded SOLE FORMAT CONTRACT ancestor-ignore (tmpl:15-23); hermetic spike proof | closed |
| T-04-04 | Tampering | agent-name path traversal | mitigate | assertSafeAgent charset gate (scope.ts:12-18) + join containment | closed |
| T-04-05 | Tampering | input-document prompt injection | accept | out of Phase-4 scope (test docs); flagged for untrusted-input hardening later | closed |
| T-04-06 | Tampering | malformed frontmatter accepted | mitigate | validation-with-one-retry, fail-closed (engine.ts:256-305); never auto-normalized | closed |
| T-04-07 | EoP | YAML RCE via crafted frontmatter | mitigate | no custom unsafe js-yaml schema at any read site (frontmatter.ts, engine.ts, resolved-decisions.ts) | closed |
| T-04-08 | DoS | manifest concurrent-write race | mitigate | concurrent artifact writes, sequential addArtifact after allSettled (engine.ts:318-342) | closed |
| T-04-09 | Spoofing | non-integrator merging | mitigate | integration fans out over integrator only (engine.ts:570-573); gate expects exactly 1 writer (gate.ts:54) | closed |
| T-04-10 | Spoofing | redundant merging | mitigate | single designated integrator (base author, D-44); same exactly-1-writer gate | closed |
| T-04-11 | Tampering | auto-merge of unreviewed addition | mitigate | per-addition verdict discriminated union (integration.ts:10-24); reason required on dropped | closed |
| T-04-12 | DoS | unbounded convergence loop | mitigate | convergenceCap default 10 (config.ts:52); cap → escalate (converge.ts:212,246,262) | closed |
| T-04-13 | Repudiation | unlogged resolution decisions | mitigate | every integrator verdict + concession carries rationale to ledger/record (engine.ts:465-496) | closed |
| T-04-14 | Repudiation | decision missing rationale/lineage | mitigate | rationale z.string().min(1); DecisionRecordFrontmatter.parse before write (decision-record.ts:279) | closed |
| T-04-15 | Tampering | half-written record on crash | mitigate | atomic temp-then-rename (decision-record.ts:295-297) | closed |
| T-04-16 | Tampering | ancestor leakage in LIVE run | mitigate | seeded ancestor-ignore directive + gemini --skip-trust; live run 20260605-MlhRzU measured ZERO leakage. Register drift: plan cited claude --bare, deliberately rejected (breaks subscription auth; flag-pinning test guards omission) — implemented mechanism verified stronger | closed |
| T-04-17 | Info Disclosure | GEMINI_API_KEY in logs | accept | logger records promptRef only; redactArgvAt in all 3 adapters; key never in argv/artifacts | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-04-01 | T-04-02 | gray-matter default js-yaml SAFE load; no unsafe schema passed anywhere; write path never uses gray-matter | user (plan-time, verified at audit) | 2026-06-06 |
| AR-04-02 | T-04-05 | Untrusted input documents out of Phase-4 scope (test docs only); revisit when real legal documents become inputs | user (plan-time, D-42 context) | 2026-06-06 |
| AR-04-03 | T-04-17 | Vendor-managed env credential; logging layer structurally never records prompt bodies or env | user (plan-time, verified at audit) | 2026-06-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit 2026-06-06

| Metric | Count |
|--------|-------|
| Threats found | 18 |
| Closed | 18 |
| Open | 0 |

Auditor: read-only verification of plan-time register against implementation (ASVS L1). All mitigations evidence-cited (file:line). One register drift documented (T-04-16 `--bare`), resolved in favor of the implemented, live-proven mechanism. Non-blocking operational note: the dist packaging bug cited in 04-05-SUMMARY was fixed in Phase 5 plan 05-07.
