---
phase: 05-hardening-resume-gating-majority-guards
plan: 07
status: complete
gap_closure: true
commits:
  - c29f560 fix(05-07): copy templates to dist/src/templates matching compiled resolver
  - 60461ae test(05-07): assert resolver-true template path and compiled-CLI fixture run
key-files:
  - package.json
  - test/dist-template.test.ts
self-check: pass
---

# Plan 05-07 Summary — Fix dist template copy destination (UAT gap closure)

## What was wrong
`tsc` (rootDir ".") emits compiled output under `dist/src/**`, so the CLI is at `dist/src/cli.js`
and the resolver in `src/protocol/instructions.ts:22`
(`new URL("../templates/agent-instructions.md.tmpl", import.meta.url)` from
`dist/src/protocol/instructions.js`) reads `dist/src/templates/...`. The build copy step pointed at
`dist/templates/` instead, so the packaged binary ENOENTed at draft fan-out (UAT Test-1). The 05-01
guard asserted the wrong hardcoded path (`dist/templates/`), so it stayed green while the binary was
broken.

## Changes
1. **package.json** — build copy destination `dist/templates` → `dist/src/templates` (same portable
   `cpSync` form), so the copy lands exactly where the compiled resolver reads.
2. **test/dist-template.test.ts** — hardened the guard:
   - Existence + byte-identity assertions now target `dist/src/templates/agent-instructions.md.tmpl`.
   - **Resolver-truth assertion**: derives the path the same way the compiled module does
     (`new URL("../templates/...", pathToFileURL(dist/src/protocol/instructions.js))`) and asserts
     THAT file exists — so the copy destination can never silently diverge from the resolver again.
   - **Compiled-CLI end-to-end check**: drives `node dist/src/cli.js run <doc> --autonomous` against a
     fake-CLI roster (claude+codex fixtures, absolute bins in mar.config.json, MAR_EMIT_BASE=claude,
     stdin ignored) and asserts the run completes (manifest.status === "completed", one run dir). This
     is the exact UAT Test-1 reproduction, now passing.

## Verification (evidence)
- `npm run build` succeeds; layout confirmed: `dist/src/cli.js`, `dist/src/protocol/instructions.js`,
  and `dist/src/templates/agent-instructions.md.tmpl` all present.
- `node dist/src/cli.js --help` exits 0.
- Compiled-CLI fixture run completes all 6 phases with no ENOENT (asserted in dist-template.test.ts;
  manifest.status === "completed").
- `npx tsc --noEmit` exits 0 (clean).
- `npm test` — 40 files, **315 passed** (313 baseline + 2 new dist-template assertions). 0 failures.
  (The "protocol error" / "review needs >=2 distinct vendors" lines in output are expected stderr from
  negative-path tests, not failures.)

## Acceptance criteria — all met
- [x] package.json build script contains `dist/src/templates`
- [x] test references `dist/src/templates` + a resolver-derived path assertion
- [x] `npm run build` then `node dist/src/cli.js --help` exits 0
- [x] compiled-CLI hermetic fixture run completes all 6 phases, no ENOENT
- [x] `npm test` exits 0 (full suite green)
