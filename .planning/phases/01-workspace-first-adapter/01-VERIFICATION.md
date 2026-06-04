---
phase: 01-workspace-first-adapter
verified: 2026-06-04T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
mode: mvp
---

# Phase 1: Workspace + First Adapter Verification Report

**Phase Goal:** A user can run one installed CLI headlessly and see its output captured as a deterministically named, normalized artifact in a manifest-indexed run workspace.
**Verified:** 2026-06-04
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

The phase is MVP-mode. The goal is a capability statement (not strict "As a..." User Story syntax); it is verified goal-backward as the observable outcome: a user can run `mar invoke --agent claude --prompt <file|string>` and get a deterministically named, normalized artifact indexed by a manifest in a run workspace, with every invocation logged and hung calls bounded by a wall-clock timeout. All five ROADMAP Success Criteria are the contract and are verified below.

### Observable Truths (merged ROADMAP success criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | User invokes one vendor CLI (claude) headlessly through a common adapter call and receives structured, normalized output (ORCH-01, SC1) | ✓ VERIFIED | `src/adapters/adapter.ts` defines vendor-agnostic `AgentAdapter`/`TurnRequest`; `src/adapters/claude.ts` `makeClaudeAdapter(bin)` drives execa `["-p", prompt, "--output-format", "json"]` (no `--bare`), normalizes `ClaudeJson`→`TurnResult` via zod. Probe: adapter run against fixture returned `ok:true, text:"pong"`. `test/claude-adapter.test.ts` covers happy/auth-fail/bad-json/hang/flag-pinning (all green). |
| 2 | Each invocation writes a deterministically named artifact `<seq>-<agent>-<kind>.md` into `runs/<id>/`; the artifact trail is authoritative run state (PROT-02, SC2) | ✓ VERIFIED | `src/workspace/layout.ts` `artifactName` zero-pads seq to 3 (`001-claude-output.md`); `src/workspace/artifacts.ts` `writeArtifact` writes `.md` + sibling `.raw.json` atomically (temp+rename); `isDone` = exists AND size>0. On-disk `runs/20260604-S1Q-4G/` has `001/002-claude-output.md` + `.raw.json`. `test/workspace.test.ts`, `test/manifest.test.ts` green. |
| 3 | Every run has an ID, a status, and a manifest indexing its artifacts (PROT-07, SC3) | ✓ VERIFIED | `src/schema/manifest.ts` `Manifest` zod schema (runId, status enum incl. `timeout`, createdAt/updatedAt, cliVersions, artifacts[]). `src/workspace/manifest.ts` atomic createRun/read/addArtifact/setStatus with validate-before-write. Live manifest.json: `status:"completed"`, `cliVersions.claude:"2.1.162"`, 2 artifact entries. Round-trip re-derivability asserted by `manifest.test.ts`. |
| 4 | Every invocation is logged with command, prompt reference, exit code, duration, and output location (ORCH-06, SC4) | ✓ VERIFIED | `src/log/invocation.ts` `logInvocation` appends one NDJSON line via sync pino destination to `invocations.ndjson`; record carries command, promptRef, exitCode, durationMs, timedOut, artifactPath. cli.ts logs even on failure. Live `invocations.ndjson` has 2 parseable records. `test/invocation.test.ts` green (count==calls, all fields, promptRef not body). |
| 5 | A hung invocation is bounded by an external wall-clock timeout rather than blocking indefinitely (D-17, SC5) | ✓ VERIFIED | `src/adapters/claude.ts` execa called with `timeout: req.timeoutMs`, `killSignal:"SIGTERM"`, `forceKillAfterDelay:5000`, `reject:false`; timedOut/forced-kill → `{ok:false, timedOut:true, error:"timeout"}`. `--hang` test @ `timeoutMs:200` asserts `timedOut===true` and process killed (green). CLI default 600000ms. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/schema/turn.ts` | ClaudeJson + vendor-agnostic TurnResult | ✓ VERIFIED | `.passthrough()` ClaudeJson; TurnResult camelCase only (costUsd/sessionId/durationMs), no snake_case vendor fields; includes `redactedCommand` (WR-04). Imported by claude.ts. |
| `src/schema/manifest.ts` | Manifest zod schema (PROT-07) | ✓ VERIFIED | status enum keeps `timeout` distinct; imported by manifest.ts. |
| `src/workspace/layout.ts` | run paths + deterministic naming | ✓ VERIFIED | padStart(3); `newRunId` charset `[A-Za-z0-9_-]`; `nextSeq`/`seqFromArtifactName` (WR-03). Wired into cli.ts. |
| `src/workspace/manifest.ts` | atomic manifest read/write/update | ✓ VERIFIED | temp+rename, validate-before-write. Wired into cli.ts. |
| `src/workspace/artifacts.ts` | atomic artifact write + done-detection | ✓ VERIFIED | `yamlScalar`+`CONTROL_CHARS` injection-safe frontmatter (CR-01); `isDone` size>0. Wired into cli.ts. |
| `src/adapters/adapter.ts` | vendor-agnostic AgentAdapter | ✓ VERIFIED | no vendor fields. Imported by claude.ts + cli.ts. |
| `src/adapters/claude.ts` | makeClaudeAdapter (ORCH-01) | ✓ VERIFIED | `--output-format json`, no --bare/subtype/shell:true; `splitBin` exported+reused (WR-01); `redactedCommand` (WR-04). Wired into cli.ts. |
| `src/log/invocation.ts` | pino NDJSON logger (ORCH-06) | ✓ VERIFIED | writes `invocations.ndjson`. Wired into cli.ts. |
| `src/cli.ts` | commander `mar invoke` end-to-end | ✓ VERIFIED | wires adapter→workspace→log→console; `parseTimeout` whole-string validation (WR-02); `MAX_PROMPT_FILE_BYTES` cap (WR-05); logs `turn.redactedCommand` (WR-04). |
| `test/fixtures/fake-claude.mjs` | 4-mode fixture | ✓ VERIFIED | happy/--fail-auth/--bad-json/--hang. |
| `test/e2e-invoke.test.ts` | e2e anchor (now GREEN) | ✓ VERIFIED | spawns mar invoke against fixture, asserts run dir, non-empty `001-claude-output.md`, `.raw.json`, manifest status completed + 1 artifact, invocations.ndjson. Green. |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| workspace/manifest.ts | schema/manifest.ts | import + Manifest.parse before write | ✓ WIRED |
| workspace/artifacts.ts | workspace/layout.ts | artifactPath/rawPath naming | ✓ WIRED |
| adapters/claude.ts | schema/turn.ts | ClaudeJson.safeParse → TurnResult | ✓ WIRED |
| adapters/claude.ts | execa | execa(bin, argv, {timeout, reject:false, forceKillAfterDelay}) | ✓ WIRED |
| cli.ts | adapters/claude.ts | makeClaudeAdapter().invoke(turnRequest) | ✓ WIRED |
| cli.ts | workspace/manifest.ts | createRun/readManifest/addArtifact/setStatus | ✓ WIRED |
| cli.ts | workspace/artifacts.ts | writeArtifact after successful turn | ✓ WIRED |
| cli.ts | log/invocation.ts | logInvocation after every turn (incl. failure) | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| artifact `.md` body | `turn.text` | adapter `invoke()` → claude CLI JSON `.result` | Yes — probe returned "pong" from real fixture; live run wrote "pong" | ✓ FLOWING |
| manifest.json | `manifest.artifacts` | `addArtifact` writes real disk entry; re-read round-trips | Yes — live manifest has 2 real entries, status completed | ✓ FLOWING |
| invocations.ndjson | `record` | `logInvocation` from real turn fields | Yes — live log has 2 parseable records with real exitCode/durationMs | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full test suite | `npx vitest run` | 8 files, 50/50 passed | ✓ PASS |
| Type check | `npx tsc --noEmit` | exit 0, clean | ✓ PASS |
| Lint/format | `npx biome check src test` | 18 files, no fixes | ✓ PASS |
| Adapter normalizes + redacts | tsx probe `makeClaudeAdapter("node test/fixtures/fake-claude.mjs").invoke(...)` | `ok:true, text:"pong"`, `redactedCommand` has `<prompt>` placeholder, body NOT leaked | ✓ PASS |
| No --bare / no subtype / no shell:true in src | grep | only comment mentions; no actual flag/branch | ✓ PASS |

### Code-Review Fix Verification (01-REVIEW.md status: fixed)

| Finding | Fix Claimed | Verified In Code |
| ------- | ----------- | ---------------- |
| CR-01 unescaped YAML frontmatter | yamlScalar escaping | ✓ `artifacts.ts:31-41` `yamlScalar`+`CONTROL_CHARS`, JSON.stringify scalars |
| WR-01 bin split mismatch | reuse splitBin | ✓ `cli.ts:78` calls exported `splitBin` from claude.ts |
| WR-02 weak --timeout parse | whole-string validate | ✓ `cli.ts:66-71` `parseTimeout` uses `Number` + `Number.isInteger` |
| WR-03 seq collision/overwrite | monotonic nextSeq + overwrite guard | ✓ `layout.ts:68 nextSeq`, `cli.ts:138-148` guards existing slot |
| WR-04 audit log argv drift | adapter returns redactedCommand | ✓ `turn.ts:40` schema field, `claude.ts:78` redactArgv, `cli.ts:210` logs it; probe confirms `<prompt>` placeholder, no body leak |
| WR-05 unbounded prompt-file read | size cap | ✓ `cli.ts:16,47-52` `MAX_PROMPT_FILE_BYTES` 10MB hard error |

Info findings IN-01..IN-04 (pino level field, relative-path derivation, existsSync probe, CLAUDE.md zod version note) remain — out of scope, non-blocking, documented in 01-REVIEW.md.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| ORCH-01 | 01-02, 01-03 | Run installed vendor CLI headlessly through common adapter returning structured output | ✓ SATISFIED | AgentAdapter + makeClaudeAdapter + normalized TurnResult; truth 1 |
| ORCH-06 | 01-02, 01-03 | Every invocation logged (command, prompt ref, exit code, duration, output location) | ✓ SATISFIED | logInvocation NDJSON; truth 4 |
| PROT-02 | 01-01, 01-03 | Deterministically named artifact; artifact trail authoritative | ✓ SATISFIED | layout naming + atomic writeArtifact + isDone; truth 2 |
| PROT-07 | 01-01, 01-03 | Run has ID/status/manifest indexing artifacts | ✓ SATISFIED | Manifest schema + atomic manifest ops; truth 3 |

All four declared requirement IDs are present in REQUIREMENTS.md and mapped to Phase 1 (Complete). REQUIREMENTS.md maps exactly these four to Phase 1 — no orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No debt markers (TBD/FIXME/XXX), no stubs, no shell:true, no --bare, no subtype branching | — | None |

Note: stale on-disk `runs/20260604-S1Q-4G/invocations.ndjson` records `command` with the promptRef filled rather than the `<prompt>` placeholder. This is a pre-WR-04-fix live-smoke artifact (createdAt 16:19, before the fix batch), NOT current-code behavior. The current `cli.ts:210` logs `turn.redactedCommand`; tsx probe confirms the placeholder is produced and no prompt body leaks. `runs/` is gitignored (transient). No action required.

### Human Verification Required

None. The live real-claude smoke (claude 2.1.162) already passed at the blocking `checkpoint:human-verify` in Plan 03 (evidence in 01-03-SUMMARY.md: four files produced, status completed, append produced 002). No deferred `<verify><human-check>` blocks found in the PLANs. All automated checks pass in this verification process.

### Gaps Summary

No gaps. All five ROADMAP success criteria are observably true in the codebase. All four requirements satisfied. All artifacts exist, are substantive, wired, and have real data flowing. The full 50-test suite is green; tsc and biome are clean. All one critical + five warning code-review findings are verified present and correct in the current source. The live human-verified smoke against real claude already passed.

---

_Verified: 2026-06-04_
_Verifier: Claude (gsd-verifier)_
