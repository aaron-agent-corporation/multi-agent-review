---
status: complete
phase: 05-hardening-resume-gating-majority-guards
source: [05-01-SUMMARY.md, 05-02-SUMMARY.md, 05-03-SUMMARY.md, 05-04-SUMMARY.md, 05-05-SUMMARY.md, 05-06-SUMMARY.md]
started: 2026-06-05T20:55:00Z
updated: 2026-06-06T10:40:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Built CLI Smoke Test (dist packaging fix)
expected: After `npm run build`, `node dist/src/cli.js --help` shows commands including `resume`; `dist/templates/agent-instructions.md.tmpl` exists byte-identical to source. The compiled CLI no longer ENOENTs at draft fan-out.
result: issue
reported: "Help + file existence pass, but an actual `node dist/src/cli.js run` still ENOENTs: build copies templates to dist/templates/ while the compiled resolver (instructions.ts TEMPLATE_URL ../templates from dist/src/protocol/) resolves dist/src/templates/. Guard test asserted the wrong path."
severity: major

### 2. Run-start mode prompt + non-TTY safety
expected: In a real terminal, `mar run <doc>` asks "gated or autonomous?" before starting. `--autonomous` / `--gated` flags skip the prompt. When stdin is not a TTY (e.g. piped), it NEVER hangs — defaults to autonomous.
result: pass
evidence: "Piped stdin (non-TTY) defaulted autonomous and completed all 6 phases without hanging; --gated/--autonomous flags bypass the prompt (proven in tests 3/6). Real-TTY prompt rendering rolls into test 5."

### 3. Gated run pauses at phase boundary (pause-and-exit)
expected: A gated run with `--pause-and-exit` stops at the first phase boundary, writes status `paused-awaiting-approval` into the run's manifest.json, and exits cleanly. The run dir shows completed-phase artifacts only.
result: pass
evidence: "Gated --pause-and-exit stopped at the draft boundary: manifest status paused-awaiting-approval, only 3 draft artifacts, clean exit with resume hint (run 20260606-Pg7CNT)."

### 4. Resume continues a paused/interrupted run
expected: `mar resume <run-id>` (or `--last`) on the paused run re-validates (manifest + artifacts + preflight) and continues from the next phase without re-running completed phases — artifact seq numbers continue, no duplicates. A failed run resumes with the full original roster.
result: pass
evidence: "mar resume --last continued paused run from review (drafts not re-run, seqs collision-free, status completed). Failed run (2 broken bins) resumed after config restore with FULL 3-agent roster to completion."

### 5. Blocking gate feel in a real TTY (approve / abort / feedback)
expected: In default gated mode (no pause-and-exit), the terminal prompt at each boundary offers approve / abort / feedback; typing a feedback note visibly carries into the next phase (note reaches the next phase's prompts); abort stops the run cleanly. [Pre-planned manual-only check from 05-VALIDATION.md]
result: skipped
reason: "User opted out — pre-planned manual-only check (05-VALIDATION.md); gate logic covered hermetically by gating tests via the ask() seam."

### 6. Majority tie-break + resolver in decision record
expected: A 3-agent fixture run steered to a persistent 2-1 base disagreement (MAR_EMIT_BASES) resolves by majority at the cap instead of escalating; the decision record tags that resolution `resolver: "majority"`. A 1-1 two-agent disagreement still escalates.
result: pass
evidence: "Steered 2-1 split ran 10 evaluation rounds then resolved via majority (record entry resolver: majority, lineage rounds 1..10). 2-agent 1-1 escalated with openDecision convergence-escalation — no false plurality."

### 7. Re-litigation guard ledger
expected: During a structured run, `runs/<id>/shared/resolved-decisions.md` appears and grows as forks settle; entries carry id/summary/rationale/resolver. The terminal decision-record is assembled from it, and a fixture that re-opens a settled decision gets dropped with a `re-litigation` reason (run continues).
result: pass
evidence: "Fork settled in response appended to shared/resolved-decisions.md (resolver: convergence, pinned value); integration reopening it was dropped with re-litigation reason; sidecar relitigation-drops.json + record relitigationViolations populated; run completed."

## Summary

total: 7
passed: 5
issues: 1
pending: 0
skipped: 1

## Gaps

- truth: "The compiled `mar` binary runs the protocol without template ENOENT"
  status: resolved
  resolved_by: "05-07 (c29f560/60461ae) + bin.mar fix (3ce221d); compiled-CLI fixture run now part of the guard test"
  reason: "Build copies src/templates -> dist/templates, but compiled resolver expects dist/src/templates (tsc preserves src/ prefix in outDir). dist-template.test.ts asserts existence at dist/templates — wrong path, so the guard test passes while the binary is broken."
  severity: major
  test: 1
  artifacts: ["package.json (build script)", "test/dist-template.test.ts", "src/protocol/instructions.ts:22"]
  missing: ["copy destination dist/src/templates (or resolver-aware guard test that runs the compiled CLI)"]
