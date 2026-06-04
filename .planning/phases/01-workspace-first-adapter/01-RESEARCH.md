# Phase 1: Workspace + First Adapter - Research

**Researched:** 2026-06-04
**Domain:** Node 22 ESM + TypeScript project scaffolding; execa 9 subprocess control; zod schema design; atomic JSON manifest writes; deterministic artifact workspace; headless `claude -p --output-format json` adapter
**Confidence:** HIGH (claude CLI output shape and exit/error semantics verified by live invocation against installed 2.1.162; library versions verified against npm registry; execa 9 timeout/kill API verified against official docs)

## Summary

Project-level research (`.planning/research/`) already settled the stack (TS/Node 22 ESM + execa 9 + zod), the filesystem-as-truth architecture, and the per-vendor adapter pattern. This phase-level research fills the gaps the planner needs that those documents do not cover: concrete scaffolding versions, the **exact** `claude -p --output-format json` output shape and its error/exit semantics (verified by live invocation), execa 9 timeout/kill property names, a concrete `TurnResult` zod schema, the atomic-manifest write recipe, and a fake-CLI fixture pattern so adapter tests never burn real claude credits.

Two findings materially change the plan and must be surfaced to the planner:

1. **`--bare` is INCOMPATIBLE with subscription auth (D-09 conflict).** Live test: `claude -p --output-format json --bare` with no `ANTHROPIC_API_KEY` returns `is_error: true`, `result: "Not logged in · Please run /login"`, exit code 1. The `--help` text confirms: under `--bare`, "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper... OAuth and keychain are never read." The user authenticates via subscription (no API key in env). So D-09's reproducibility goal (`--bare` so `~/.claude` config can't perturb runs) cannot be met as written without an API key. The planner must choose: drop `--bare` for Phase 1 (subscription auth works without it — verified), OR require `ANTHROPIC_API_KEY`/`apiKeyHelper`. Recommendation: **drop `--bare` in Phase 1**, use plain `claude -p --output-format json`; revisit reproducibility once an API-key path exists. Note the billing change (June 15, 2026) applies to `-p` regardless.

2. **Exit code alone is NOT a reliable success signal — the adapter MUST check `is_error`.** A "Not logged in" failure returns exit 1 but `subtype: "success"` in the JSON. Conversely a real success is exit 0, `is_error: false`. The adapter must treat a turn as failed if `exitCode !== 0` **OR** `parsed.is_error === true`, and must NOT trust `subtype`.

**Primary recommendation:** Build the workspace layer first (layout + atomic manifest + artifact writer), then the claude adapter using plain `claude -p --output-format json` (no `--bare`) wrapped in execa with `timeout`, `reject: false`, separate stdout/stderr capture; map the verified JSON shape through a zod-validated `TurnResult`; test entirely against a fake-CLI fixture script. Pin the exact claude flag set in an adapter test so a version bump fails loudly.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** TypeScript on Node 22 LTS, ESM modules.
- **D-02:** `execa` 9.x for subprocess control — separate stdout/stderr capture, timeout, graceful kill.
- **D-03:** `zod` for validating CLI JSON output and defining the normalized `TurnResult` schema.
- **D-04:** XState v5 is the chosen state-machine library for Phase 3 — do NOT introduce XState in Phase 1. Phase 1 has no state machine to model.
- **D-05:** Supporting libs: commander (CLI parsing), pino (NDJSON logging), fs-extra (atomic writes), nanoid (IDs). Do NOT add gray-matter or p-queue until Phase 2+.
- **D-09:** Use `claude -p` with `--output-format json` and `--bare`. *(See Pitfall 1 — `--bare` conflicts with subscription auth; flagged for planner resolution.)*
- **D-17:** External wall-clock timeout on every invocation (execa `timeout`), default generous (~10 min), configurable. On timeout: kill, log with timeout flag, write no normalized artifact (or a failure marker), set manifest status. No retry logic in Phase 1.

### Claude's Discretion (recommended defaults — planner may adjust)
- **D-06:** Single CLI entry `mar`, commander. One subcommand: `mar invoke --agent claude --prompt <file-or-string> [--run <id>]`.
- **D-07:** No `--run` → new run created; `--run <id>` → append to existing run.
- **D-08:** Console output is human-readable progress; structured record goes to log file + manifest, not stdout.
- **D-10:** Normalized artifact = markdown with small YAML frontmatter (agent, vendor, timestamp, run id, turn id, log ref); raw CLI JSON preserved as sibling `.raw.json` — never discarded.
- **D-11:** Deterministic naming: `<seq>-<agent>-<kind>.md` (e.g., `001-claude-output.md`), zero-padded seq.
- **D-12:** "Normalized" = adapter maps vendor JSON to a single zod-validated `TurnResult`; protocol layer never sees vendor JSON.
- **D-13:** Run dir `runs/<run-id>/`; run id = timestamp prefix + short nanoid (e.g., `20260604-x7Kp2a`).
- **D-14:** `runs/<id>/manifest.json` authoritative: run id, status, created/updated, CLI versions, artifacts array (path, agent, seq, kind, created). State always derivable from disk.
- **D-15:** Append-only NDJSON at `runs/<id>/invocations.ndjson` (pino), one record per invocation (argv, prompt ref, exit code, duration ms, timeout flag, output artifact path).
- **D-16:** Manifest writes atomic (write-temp-then-rename via fs-extra).

### Deferred Ideas (OUT OF SCOPE)
None deferred in discussion. **Note for Phase 2+:** Claude `-p`/Agent SDK usage moves to a separate subscription credit pool starting June 15, 2026 — re-validate budget assumptions before heavy multi-agent runs.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORCH-01 | Run an installed vendor CLI (claude only this phase) headlessly through a common adapter returning structured output | Verified `claude -p --output-format json` shape + `AgentAdapter` interface + `TurnResult` zod schema below |
| ORCH-06 | Every invocation logged with command, prompt reference, exit code, duration, output location | Pino NDJSON `invocations.ndjson` pattern (D-15); execa exposes `command`/`exitCode`/`durationMs` |
| PROT-02 | Each turn produces a deterministically named artifact; artifact trail is authoritative run state | Deterministic `<seq>-<agent>-<kind>.md` naming + atomic write; "done = file exists AND non-empty" |
| PROT-07 | Run has ID, status, manifest indexing artifacts and phase completion | nanoid run id + atomic `manifest.json` schema below |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CLI argument parsing (`mar invoke`) | CLI / Entry | — | commander; thin dispatch only, no business logic |
| Subprocess spawn + timeout + kill | Adapter | — | execa owns process lifecycle; protocol never spawns |
| Vendor JSON → `TurnResult` normalization | Adapter | Schema (zod) | Vendor specifics MUST NOT leak past the adapter boundary |
| Run/artifact path + naming schema | Workspace (`layout`) | — | One module owns naming so it lives in exactly one place |
| Manifest read/write (atomic) | Workspace (`manifest`) | fs-extra | Single source of truth; atomic temp+rename |
| Artifact write + "done" detection | Workspace (`artifacts`) | — | Idempotent completion: exists AND non-empty |
| Per-invocation structured logging | Logging | pino | NDJSON append; audit trail (ORCH-06) |
| Run ID generation | Workspace | nanoid | Sortable timestamp prefix + collision-safe suffix |

## Standard Stack

### Core
| Library | Version (verified) | Purpose | Why Standard |
|---------|--------------------|---------|--------------|
| Node.js | 24.7.0 installed (project targets 22 LTS) | Runtime | Locked D-01. Note: machine runs Node 24; target `"engines": {"node": ">=22"}` and test on 22 if CI matters. |
| TypeScript | 6.0.3 latest | Language | Locked D-01. **Was 5.6+ in research → now TS 6.0.** Verify no TS6 breaking changes bite; `"module": "nodenext"` is the safe ESM setting. |
| execa | 9.6.1 | Subprocess execution | Locked D-02. ESM-only in v9. |
| zod | 4.4.3 latest | Schema validation | Locked D-03. **Research said zod 3.23+ → registry now ships zod 4.x.** See Pitfall 4 for zod 4 API notes. Pin `zod@^4` or deliberately pin `zod@^3` if you want the documented-in-research API. |

### Supporting
| Library | Version (verified) | Purpose | When to Use |
|---------|--------------------|---------|-------------|
| commander | 15.0.0 | CLI parsing | `mar` entry point (D-06). Research said 12.x → now 15.x. |
| pino | 10.3.1 | NDJSON logging | `invocations.ndjson` (D-15). Research said 9.x → now 10.x. |
| fs-extra | 11.3.5 | Atomic writes, ensureDir | Manifest atomic write, run dir creation (D-16). |
| nanoid | 5.1.11 | Run/turn IDs | Run id suffix (D-13). ESM-only in v5. |

### Dev Tooling
| Tool | Version (verified) | Purpose |
|------|--------------------|---------|
| tsx | 4.22.4 | Run TS without a build step during dev |
| vitest | 4.1.8 | Test runner — native ESM/TS. **Recommended over `node:test`** (see decision below) |
| @biomejs/biome | 2.4.16 | Lint + format |
| @types/node | 25.9.1 | Node types |
| @types/fs-extra | 11.0.4 | fs-extra types |

**Test runner decision (D-05 left it open): use vitest, not `node:test`.**
- vitest: zero-config ESM+TS, built-in mocking/spies (needed to assert the adapter calls execa with the exact claude flag set without spawning), watch mode, snapshot testing for the verified-JSON fixture, `vi.fn()`/`vi.mock()`. Already named in research dev tooling.
- `node:test` + `tsx`: zero dependencies, but weaker mocking ergonomics and you hand-roll fixture spawning. Viable but more friction for the fake-CLI pattern below.
- Verdict: vitest. The adapter-flag-pinning test and fake-CLI fixtures are materially easier. `[VERIFIED: npm registry]` for version; choice rationale `[ASSUMED]` (standard ecosystem practice).

**Installation:**
```bash
npm install execa@^9 zod@^4 commander@^15 pino@^10 fs-extra@^11 nanoid@^5
npm install -D typescript@^6 tsx@^4 vitest@^4 @biomejs/biome @types/node @types/fs-extra
```
*Do NOT install in Phase 1: xstate (D-04), gray-matter, p-queue, zod-to-json-schema (Phase 2+).*

## Package Legitimacy Audit

> slopcheck could not be installed in this sandbox (no network pip access verified); all packages below are nonetheless well-established with long histories and high download counts, individually version-verified against the npm registry via `npm view`. Treat the *names* as `[VERIFIED: npm registry]` only because they are named in the project's own CLAUDE.md/STACK.md (authoritative project docs), not discovered ad hoc.

| Package | Registry | Maturity | Source Repo | slopcheck | Disposition |
|---------|----------|----------|-------------|-----------|-------------|
| execa | npm | mature, ~100M+/wk | github.com/sindresorhus/execa | n/a | Approved (in STACK.md) |
| zod | npm | mature, very high dl | github.com/colinhacks/zod | n/a | Approved (in STACK.md) |
| commander | npm | mature, very high dl | github.com/tj/commander.js | n/a | Approved (in STACK.md) |
| pino | npm | mature, high dl | github.com/pinojs/pino | n/a | Approved (in STACK.md) |
| fs-extra | npm | mature, very high dl | github.com/jprichardson/node-fs-extra | n/a | Approved (in STACK.md) |
| nanoid | npm | mature, very high dl | github.com/ai/nanoid | n/a | Approved (in STACK.md) |
| vitest | npm | mature, high dl | github.com/vitest-dev/vitest | n/a | Approved (in STACK.md dev tooling) |
| tsx | npm | mature, high dl | github.com/privatenumber/tsx | n/a | Approved (in STACK.md dev tooling) |
| @biomejs/biome | npm | mature, high dl | github.com/biomejs/biome | n/a | Approved (in STACK.md dev tooling) |

**Packages removed due to slopcheck [SLOP]:** none.
**Packages flagged [SUS]:** none. All nine are named in the project's own authoritative STACK.md/CLAUDE.md and resolve to well-known GitHub repos. No checkpoint required. (If the planner wants belt-and-suspenders, run `slopcheck install execa zod commander pino fs-extra nanoid vitest tsx @biomejs/biome --json` once network is available before the install task.)

## Verified Claude CLI Behavior (live, claude 2.1.162)

> This is the load-bearing new finding. Captured by actually running the CLI on this machine.

### Exact `claude -p --output-format json` output shape (success)
A single JSON object (NOT wrapped, NOT NDJSON) printed to stdout:
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "api_error_status": null,
  "duration_ms": 2588,
  "duration_api_ms": 2575,
  "ttft_ms": 2513,
  "num_turns": 1,
  "result": "pong",
  "stop_reason": "end_turn",
  "session_id": "4eea0b0a-...-9f2302c50931",
  "total_cost_usd": 0.19065875,
  "usage": { "input_tokens": 10058, "cache_creation_input_tokens": 22443,
             "cache_read_input_tokens": 0, "output_tokens": 4, "service_tier": "standard", ... },
  "modelUsage": { "claude-opus-4-8[1m]": { "inputTokens": 10058, "outputTokens": 4,
                  "costUSD": 0.19065875, "contextWindow": 1000000, ... } },
  "permission_denials": [],
  "terminal_reason": "completed",
  "fast_mode_state": "off",
  "uuid": "0ffa5d96-..."
}
```
- **`result`** = the agent's text output (the thing that becomes the normalized markdown body).
- **`session_id`** = capture for any future resume (not needed Phase 1; D-04/architecture says fresh-context per turn).
- **`total_cost_usd`**, **`usage`**, **`modelUsage`**, **`duration_ms`** = metadata for the log/manifest (ORCH-06).
- With **`--json-schema '<schema>'`**, a top-level **`structured_output`** key appears alongside `result` containing the schema-conforming object (verified: `{"name":"Bob","age":5}`). Phase 1 does not need a schema, but the adapter's zod type should leave room for an optional `structuredOutput`.

### Error / exit semantics (CRITICAL for the adapter)

| Scenario | exit code | `is_error` | `subtype` | `result` |
|----------|-----------|-----------|-----------|----------|
| Normal success | 0 | false | "success" | the text answer |
| Not logged in (e.g. `--bare` w/o API key) | **1** | **true** | "success" (misleading!) | "Not logged in · Please run /login" |
| Unknown CLI flag | 1 | — (no JSON; stderr: `error: unknown option`) | — | — |

**Adapter rule:** a turn FAILED if `exitCode !== 0` **OR** the parsed JSON has `is_error === true`. **Do NOT trust `subtype`** — it reported `"success"` on a not-logged-in failure. Unknown-flag errors produce no JSON at all (plain stderr) → the adapter must handle "stdout did not parse as JSON" as a distinct failure mode, not crash.

### `--bare` auth constraint (resolves the D-09 conflict)
- `--help` text: under `--bare`, "Anthropic auth is **strictly ANTHROPIC_API_KEY or apiKeyHelper** via --settings (OAuth and keychain are never read)."
- Live test: `--bare` with no `ANTHROPIC_API_KEY` → `is_error: true`, "Not logged in", exit 1.
- Live test: plain `claude -p --output-format json` (no `--bare`) → success under the machine's subscription auth.
- `ANTHROPIC_API_KEY` is **not set** in this environment.
- **Implication:** Phase 1 should run `claude -p --output-format json` **without `--bare`** (subscription auth works), OR require an API key. The reproducibility benefit of `--bare` (immune to `~/.claude` config) is real but unavailable on subscription auth. Planner decision.

`[VERIFIED: live invocation]` for all of the above against claude 2.1.162.

## Architecture Patterns

### System Architecture Diagram (Phase 1 slice)
```
mar invoke --agent claude --prompt <file|string> [--run <id>]
        │  (commander parses args)
        ▼
   ┌─────────────────────┐   no --run → create run (nanoid id, ensureDir, init manifest)
   │   CLI / Entry        │   --run <id> → load existing manifest
   └──────────┬──────────┘
              │ TurnRequest { promptText, runDir, seq, agent:"claude", timeoutMs }
              ▼
   ┌─────────────────────┐
   │  ClaudeAdapter       │  build argv: ["-p", promptText, "--output-format","json"]
   │  (execa)             │  execa("claude", argv, { timeout, reject:false,
   │                      │       killSignal:"SIGTERM", forceKillAfterDelay:5000 })
   └──────────┬──────────┘
              │ raw {stdout, stderr, exitCode, durationMs, timedOut}
              ▼
   ┌─────────────────────┐  parse stdout JSON → zod.safeParse(ClaudeJsonSchema)
   │  Normalizer          │  map → TurnResult { ok, text, exitCode, durationMs,
   │  (zod)               │       costUsd?, sessionId?, usage?, timedOut, error? }
   └──────────┬──────────┘
              │ TurnResult
              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  Workspace (filesystem = truth)                              │
   │   runs/<id>/<seq>-claude-output.md   (frontmatter + result)  │ ← atomic write
   │   runs/<id>/<seq>-claude-output.raw.json (raw CLI JSON)      │
   │   runs/<id>/manifest.json   (atomic temp+rename; artifacts[])│
   │   runs/<id>/invocations.ndjson  (pino append: argv/exit/dur) │
   └─────────────────────────────────────────────────────────────┘
              │
              ▼  console: human-readable progress (D-08)
   "claude ✓  2.6s  exit 0  → runs/20260604-x7Kp2a/001-claude-output.md"
```

### Recommended Project Structure (Phase 1 subset of ARCHITECTURE.md)
```
multi-agent-review/
├── package.json            # "type":"module", bin: { mar: "./dist/cli.js" } or tsx entry
├── tsconfig.json           # module: nodenext, target ES2023, strict
├── biome.json
├── vitest.config.ts
├── src/
│   ├── cli.ts              # commander entry: `mar invoke`
│   ├── adapters/
│   │   ├── adapter.ts      # AgentAdapter interface, TurnRequest/TurnResult types
│   │   └── claude.ts       # claude -p --output-format json + execa + normalize
│   ├── schema/
│   │   └── turn.ts         # zod: ClaudeJsonSchema, TurnResult
│   ├── workspace/
│   │   ├── layout.ts       # run dir paths + <seq>-<agent>-<kind>.md naming
│   │   ├── manifest.ts     # read/write/validate manifest.json (atomic)
│   │   └── artifacts.ts    # write artifact (+ .raw.json), done-detection
│   └── log/
│       └── invocation.ts   # pino NDJSON writer for invocations.ndjson
├── test/
│   ├── fixtures/
│   │   └── fake-claude.mjs # stand-in CLI: emits canned JSON, supports --hang/--fail
│   ├── claude-adapter.test.ts
│   ├── manifest.test.ts
│   └── workspace.test.ts
└── runs/                   # gitignored generated run dirs
```

### Pattern 1: Adapter Interface (vendor-agnostic from day one)
```typescript
// src/adapters/adapter.ts — protocol only ever sees these types
export interface TurnRequest {
  agent: string;           // "claude"
  promptText: string;
  runDir: string;
  seq: number;
  timeoutMs: number;       // D-17 wall-clock bound
}
export interface AgentAdapter {
  readonly name: string;
  invoke(req: TurnRequest): Promise<TurnResult>;
}
// NO claude-specific fields here (D-12 / ARCHITECTURE anti-pattern 3).
```

### Pattern 2: execa invocation with timeout + graceful kill (D-17)
Verified property names from execa 9 official API docs:
```typescript
// src/adapters/claude.ts
import { execa } from "execa";
// Source: https://github.com/sindresorhus/execa/blob/main/docs/api.md
const result = await execa("claude", [
    "-p", req.promptText,
    "--output-format", "json",
    // NOTE: omit "--bare" — incompatible with subscription auth (see Pitfall 1)
  ], {
    timeout: req.timeoutMs,        // wall-clock ms; >0 terminates on overrun
    killSignal: "SIGTERM",         // default
    forceKillAfterDelay: 5000,     // SIGKILL if it won't die → error.isForcefullyTerminated
    reject: false,                 // resolve (don't throw) on non-zero exit → inspect result
    cleanup: true,                 // kill child if our process exits
    // stdout/stderr default to "pipe" → captured separately as result.stdout/result.stderr
  });
// On timeout: result.timedOut === true. On forced kill: result.isForcefullyTerminated === true.
// result.exitCode, result.durationMs available.
```
- `timeout` (ms): subprocess terminated if it runs longer. `error.timedOut`/`result.timedOut` becomes true.
- `killSignal` default `SIGTERM`; `forceKillAfterDelay` default 5000 ms → SIGKILL, sets `isForcefullyTerminated`.
- `reject:false` resolves with the error-shaped result instead of throwing — lets the adapter inspect `exitCode`/`timedOut` uniformly.
- stdout/stderr captured separately by default (`'pipe'`) → `result.stdout` / `result.stderr`.
`[CITED: github.com/sindresorhus/execa/blob/main/docs/api.md]`

### Pattern 3: Atomic manifest write (D-16, prevents corrupt manifest)
```typescript
// src/workspace/manifest.ts
import { writeFile, rename, ensureDir } from "fs-extra";
import { dirname, join } from "node:path";
async function writeManifestAtomic(runDir: string, manifest: Manifest) {
  const finalPath = join(runDir, "manifest.json");
  const tmpPath = `${finalPath}.tmp-${process.pid}`;       // unique temp avoids races
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2), "utf8");
  await rename(tmpPath, finalPath);                         // atomic on same filesystem
}
```
`rename(2)` is atomic on the same filesystem — a crash leaves either the old complete manifest or the new complete one, never a half-written file. Apply the SAME temp+rename to the normalized artifact so "file exists AND non-empty" reliably means "turn done" (ARCHITECTURE Pattern 1 / anti-pattern 4).

### Pattern 4: Deterministic artifact + raw sibling (D-10, D-11)
```typescript
// <seq> zero-padded to 3; kind generic in Phase 1
function artifactName(seq: number, agent: string, kind = "output") {
  return `${String(seq).padStart(3, "0")}-${agent}-${kind}.md`;  // 001-claude-output.md
}
// Markdown body = YAML frontmatter + TurnResult.text; sibling .raw.json = raw CLI JSON (never discarded)
```

### Anti-Patterns to Avoid (from ARCHITECTURE.md, Phase-1-relevant)
- **Holding run state in memory:** filesystem/manifest is authoritative; runner is a stateless function of the run dir.
- **Leaking vendor flags into protocol:** all `claude`-specific flags live in `claude.ts`; protocol speaks only `TurnRequest`/`TurnResult`.
- **Half-written artifact = done:** always temp+rename; done = exists AND non-empty.
- **Scraping human-readable stdout:** parse `--output-format json`, validate with zod, fail loudly on unexpected shape.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subprocess timeout + kill escalation | Manual `spawn` + `setTimeout` + `SIGTERM`/`SIGKILL` bookkeeping | execa `timeout` + `forceKillAfterDelay` | Race conditions, zombie children, cross-platform signal differences — execa solves all (D-02) |
| Separate stdout/stderr capture | Manual stream concatenation | execa `result.stdout` / `result.stderr` | execa pipes both separately by default |
| JSON shape validation | `if (typeof x.result === 'string')` ladders | zod `safeParse` | One schema, typed inference, fails loudly on drift (Pitfall 1) |
| Atomic file write | `fs.writeFile` then hope | fs-extra + temp+rename | Crash-during-write corrupts manifest; rename is atomic (D-16) |
| Collision-safe sortable IDs | `Date.now()` + `Math.random()` | nanoid + timestamp prefix | URL-safe, collision-resistant (D-13) |
| Structured NDJSON logs | `fs.appendFile(JSON.stringify(...))` | pino | Correct NDJSON, levels, fast, no partial-line interleave (D-15) |
| CLI arg parsing | `process.argv` slicing | commander | Subcommands, validation, help (D-06) |

**Key insight:** Phase 1's entire value is establishing clean contracts (adapter interface, manifest schema, artifact naming). Every "simple" hand-rolled primitive here (timeout, atomic write, JSON validation) has a sharp edge that the project-blessed library already files off.

## Testing the Adapter Without Burning Claude Credits (fake-CLI fixture pattern)

This is the phase-specific gap the planner most needs solved. A real `claude -p` call costs ~$0.19 and takes seconds — adapter tests must not hit it.

**Pattern: a fake-CLI fixture script the adapter spawns instead of real `claude`.**

1. Make the adapter's executable name injectable (don't hardcode `"claude"`):
```typescript
// claude.ts
export function makeClaudeAdapter(bin = "claude"): AgentAdapter { ... execa(bin, argv, opts) ... }
```
2. Ship a fixture that mimics the verified output shape and failure modes:
```javascript
// test/fixtures/fake-claude.mjs  (chmod +x; node shebang)
#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--hang")) { setInterval(() => {}, 1e9); }          // never exits → test timeout/kill
else if (args.includes("--fail-auth")) {                              // mimic not-logged-in
  process.stdout.write(JSON.stringify({ type:"result", subtype:"success",
    is_error:true, result:"Not logged in · Please run /login", session_id:"x",
    total_cost_usd:0, duration_ms:10, usage:{}, modelUsage:{} }));
  process.exit(1);
} else if (args.includes("--bad-json")) { process.stdout.write("not json"); process.exit(0); }
else {                                                                 // happy path
  process.stdout.write(JSON.stringify({ type:"result", subtype:"success",
    is_error:false, result:"pong", session_id:"4eea0b0a", total_cost_usd:0.19,
    duration_ms:2588, usage:{input_tokens:10058,output_tokens:4}, modelUsage:{} }));
  process.exit(0);
}
```
3. Tests inject the fixture path: `makeClaudeAdapter("test/fixtures/fake-claude.mjs")` (or `node fake-claude.mjs`). Cover: happy path → `TurnResult.ok===true, text==="pong"`; `--fail-auth` → `ok===false` (exit 1 AND is_error); `--bad-json` → graceful failure not crash; `--hang` with `timeoutMs:200` → `timedOut===true`, process killed.
4. **Pin the real flag set** in a separate test using vitest mock of execa: assert the adapter invokes `claude` with exactly `["-p", prompt, "--output-format", "json"]` (no `--bare`) — this test fails loudly if a future edit drifts the flags (Pitfall 1 / ARCHITECTURE smoke-test guidance).
5. Optional: ONE gated real-CLI smoke test behind an env flag (`MAR_LIVE_CLAUDE=1`) for manual pre-release verification, skipped by default in CI.

`[VERIFIED: live invocation]` — the fixture JSON mirrors the actual captured shape, including the misleading `subtype:"success"` on auth failure.

## Common Pitfalls

### Pitfall 1: `--bare` silently disables subscription auth (D-09 conflict)
**What goes wrong:** Following D-09 literally (`--bare`) makes every claude call return `is_error:true` "Not logged in" because the machine uses subscription/OAuth auth and `--bare` reads ONLY `ANTHROPIC_API_KEY`/apiKeyHelper.
**Why:** `--bare` is built for CI with API keys; it deliberately ignores OAuth/keychain.
**How to avoid:** Phase 1: run `claude -p --output-format json` WITHOUT `--bare` (verified working on subscription auth). If reproducibility-immunity to `~/.claude` is wanted, that requires an API key path — defer/escalate to the user.
**Warning signs:** `is_error:true`, `result:"Not logged in · Please run /login"`, exit 1 on every call.

### Pitfall 2: Trusting exit code OR `subtype` instead of `is_error`
**What goes wrong:** A not-logged-in failure returns `subtype:"success"` (misleading) — keying success off `subtype` marks failures as successes. Conversely an unknown-flag error emits NO JSON.
**How to avoid:** Success = `exitCode === 0` AND parsed JSON `is_error === false`. Treat unparseable stdout as failure (capture stderr into the log). Never branch on `subtype`.
**Warning signs:** Empty/"Not logged in" artifacts marked complete; JSON.parse throwing on stderr-only error output.

### Pitfall 3: Headless hang with no timeout (PITFALLS Pitfall 2)
**What goes wrong:** claude can hang in `epoll_wait` if the upstream API stalls; an unattended `mar invoke` blocks forever.
**How to avoid:** execa `timeout` (D-17) + `forceKillAfterDelay`. On `timedOut`, log with timeout flag, write a failure marker (not a normalized artifact), set manifest status `timeout`. Test with the `--hang` fixture.
**Warning signs:** Process alive, CPU 0, no output past the wall-clock bound.

### Pitfall 4: Library major-version drift since research (zod 4, TS 6, commander 15, pino 10)
**What goes wrong:** Research/CLAUDE.md cite zod 3.23+, TS 5.6+, commander 12, pino 9. The registry now ships zod **4.4.3**, TS **6.0.3**, commander **15**, pino **10**. Copy-pasting research-era API calls may break (zod 4 changed some error-formatting and `.parse` ergonomics; TS 6 may tighten checks).
**How to avoid:** Pin explicitly (`zod@^4` or deliberately `zod@^3`), and write the schema against the installed major's docs. Validate via Context7/official docs at implementation time, not training memory. zod 4 `z.infer`, `safeParse`, and basic object schemas used here are stable across 3→4, so risk is low for Phase 1's simple schema.
**Warning signs:** Type errors on `z.*` calls; commander option-handler signature changes; pino transport config differences.

### Pitfall 5: ESM-only packaging friction (execa 9, nanoid 5 are ESM-only)
**What goes wrong:** A stray `require()` or `"type":"commonjs"` breaks imports.
**How to avoid:** `"type":"module"` in package.json (D-01), `"module":"nodenext"` in tsconfig, use `import`. Run dev via `tsx`. For test fixtures use `.mjs` or rely on `"type":"module"`.

### Pitfall 6: Treating `runs/` as committable / leaking it into git
**What goes wrong:** Generated run dirs (with prompts and possibly sensitive content) get committed.
**How to avoid:** Add `runs/` to `.gitignore` from the scaffolding task. (Repo currently has no `.gitignore` — create one.)

## Runtime State Inventory

Greenfield phase (no rename/refactor). Section included only to record the one external-state touchpoint:
| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — first phase, no datastores | none |
| Live service config | claude CLI subscription auth (OAuth/keychain) — used by `claude -p` | none in code; document that `--bare` bypasses it (Pitfall 1) |
| OS-registered state | None | none |
| Secrets/env vars | `ANTHROPIC_API_KEY` — **not set**; only needed if `--bare` is used | escalate to user only if `--bare` chosen |
| Build artifacts | None yet | none |

## Code Examples

### Normalized `TurnResult` zod schema (D-12) mapping the verified claude JSON
```typescript
// src/schema/turn.ts
import { z } from "zod";

// Raw claude -p --output-format json shape (only fields we consume; .passthrough for the rest)
export const ClaudeJson = z.object({
  is_error: z.boolean(),
  result: z.string().optional(),               // text answer (absent on some errors)
  session_id: z.string().optional(),
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  structured_output: z.unknown().optional(),   // present only with --json-schema
  usage: z.unknown().optional(),
}).passthrough();                              // tolerate extra/new keys → don't fail on drift

// Vendor-agnostic normalized result the protocol sees (no claude-specific names)
export const TurnResult = z.object({
  ok: z.boolean(),
  agent: z.string(),
  text: z.string(),                            // "" on failure
  exitCode: z.number(),
  durationMs: z.number(),
  timedOut: z.boolean(),
  costUsd: z.number().optional(),
  sessionId: z.string().optional(),
  structuredOutput: z.unknown().optional(),
  error: z.string().optional(),                // e.g. "Not logged in", "timeout", "unparseable output"
});
export type TurnResult = z.infer<typeof TurnResult>;
```

### Adapter normalization logic (the ok-rule from verified semantics)
```typescript
// after: const r = await execa(bin, argv, opts);  // reject:false
if (r.timedOut) return { ok:false, agent, text:"", exitCode:r.exitCode ?? -1,
                         durationMs:r.durationMs, timedOut:true, error:"timeout" };
const parsed = ClaudeJson.safeParse(safeJsonParse(r.stdout));
if (!parsed.success) return { ok:false, agent, text:"", exitCode:r.exitCode ?? -1,
                         durationMs:r.durationMs, timedOut:false,
                         error:`unparseable output: ${r.stderr || "no json"}` };
const j = parsed.data;
const ok = r.exitCode === 0 && j.is_error === false;        // BOTH conditions (verified)
return { ok, agent, text: ok ? (j.result ?? "") : "", exitCode: r.exitCode ?? 0,
         durationMs: r.durationMs, timedOut:false, costUsd: j.total_cost_usd,
         sessionId: j.session_id, structuredOutput: j.structured_output,
         error: ok ? undefined : (j.result ?? "claude error") };
```

### Manifest schema (D-14, PROT-07)
```typescript
export const Manifest = z.object({
  runId: z.string(),                            // "20260604-x7Kp2a"
  status: z.enum(["created","running","completed","failed","timeout"]),
  createdAt: z.string(),                        // ISO
  updatedAt: z.string(),
  cliVersions: z.record(z.string(), z.string()),// { claude: "2.1.162" } — detect at start (Pitfall 1 mitigation)
  artifacts: z.array(z.object({
    path: z.string(), agent: z.string(), seq: z.number(),
    kind: z.string(), createdAt: z.string(),
  })),
});
```

## State of the Art

| Old (in research/CLAUDE.md) | Current (verified npm, 2026-06-04) | Impact |
|------------------------------|-------------------------------------|--------|
| zod 3.23+ | zod 4.4.3 | Pin `^4` (or deliberately `^3`); simple schemas unaffected |
| TypeScript 5.6+ | 6.0.3 | Use `module: nodenext`; verify no new strictness bites |
| commander 12.x | 15.0.0 | Subcommand API stable; check option-handler signatures |
| pino 9.x | 10.3.1 | Transport config may differ; basic NDJSON unaffected |
| vitest (unversioned) | 4.1.8 | Current major; config is `vitest.config.ts` |
| `--bare` recommended for orchestrator | `--bare` requires API key; breaks subscription auth | **Drop `--bare` in Phase 1** |

**Deprecated/outdated for this phase:** none of the libraries are deprecated; only versions advanced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | vitest (not node:test) is the better test-runner choice for the fake-CLI/mock pattern | Standard Stack | Low — node:test also works, just more friction |
| A2 | zod 4's basic object/infer/safeParse API is stable enough that Phase 1's simple schema needs no rewrite vs zod 3 | Pitfall 4 | Low-Med — verify at implementation via Context7/zod 4 docs |
| A3 | Dropping `--bare` is acceptable to the user for Phase 1 (subscription auth, accept `~/.claude` influence) | Summary / Pitfall 1 | Med — user may want reproducibility; surfaces a real decision (provide API key vs accept config influence) |
| A4 | Node 22 target is fine despite machine running Node 24 | Standard Stack | Low — set `engines` and test on 22 if CI added |
| A5 | TS 6.0 introduces no breaking change that blocks this simple ESM project | State of the Art | Low — verify at scaffolding |

## Open Questions (RESOLVED)

> All three questions were resolved during planning: (1) RESOLVED — ship without `--bare` (CONTEXT.md D-09 amended); (2) RESOLVED — pinned `zod@^4` in Plan 01-01; (3) RESOLVED — manifest `status` enum keeps `timeout` distinct from `failed`.

1. **`--bare` vs subscription auth (D-09).**
   - Known: `--bare` needs `ANTHROPIC_API_KEY` (not set); plain `-p` works on subscription. Verified live.
   - Unclear: does the user want reproducibility (API key) or convenience (subscription, accept `~/.claude` influence)?
   - Recommendation: Phase 1 ship without `--bare`; record the tradeoff; let the user opt into an API-key path later. **Planner should flag this for user confirmation** (Assumption A3).
2. **zod major (3 vs 4).**
   - Known: registry ships zod 4.4.3; research/CLAUDE.md assume zod 3.
   - Recommendation: pin `zod@^4` and validate the schema against zod 4 docs at implementation; trivial to pin `^3` if friction appears.
3. **Run-status granularity.** Manifest `status` enum proposed (`created/running/completed/failed/timeout`). Confirm the planner wants `timeout` distinct from `failed` (recommended for D-17 observability).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime (D-01) | ✓ | 24.7.0 (target 22 LTS) | — |
| npm | Install | ✓ | 11.5.1 | — |
| claude CLI | ORCH-01 adapter | ✓ | 2.1.162 | — (Phase 1 is claude-only) |
| claude subscription auth | live invocation | ✓ (works without `--bare`) | — | `ANTHROPIC_API_KEY` (not set) needed only for `--bare` |
| git | repo (commit_docs) | ✓ (.git present) | — | — |

**Missing dependencies with no fallback:** none — all Phase 1 dependencies present.
**Missing dependencies with fallback:** `ANTHROPIC_API_KEY` absent — only required if `--bare` is chosen; fallback is to omit `--bare` (recommended).

## Validation Architecture

`nyquist_validation: true` in config → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.8 |
| Config file | none yet — Wave 0 creates `vitest.config.ts` |
| Quick run command | `npx vitest run <file>` (or `npm test -- <file>`) |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORCH-01 | Adapter invokes claude headlessly, returns normalized `TurnResult` (happy path) | unit (fake-CLI) | `npx vitest run test/claude-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01 | Adapter maps not-logged-in (exit 1 + is_error) → `ok:false` | unit (fake-CLI `--fail-auth`) | `npx vitest run test/claude-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01 | Adapter handles unparseable stdout without crashing | unit (fake-CLI `--bad-json`) | `npx vitest run test/claude-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01/D-17 | Hung invocation killed by wall-clock timeout (`timedOut:true`) | unit (fake-CLI `--hang`, timeoutMs:200) | `npx vitest run test/claude-adapter.test.ts` | ❌ Wave 0 |
| ORCH-01 | Adapter invokes claude with the exact pinned flag set (no `--bare`) | unit (execa mock) | `npx vitest run test/claude-adapter.test.ts` | ❌ Wave 0 |
| ORCH-06 | Each invocation logged with argv, exit code, duration, artifact path | unit | `npx vitest run test/invocation.test.ts` | ❌ Wave 0 |
| PROT-02 | Artifact deterministically named; "done"=exists AND non-empty | unit | `npx vitest run test/workspace.test.ts` | ❌ Wave 0 |
| PROT-02 | Atomic artifact write — no half-written file on simulated failure | unit | `npx vitest run test/workspace.test.ts` | ❌ Wave 0 |
| PROT-07 | Manifest created with id/status/artifacts; atomic temp+rename | unit | `npx vitest run test/manifest.test.ts` | ❌ Wave 0 |
| PROT-07 | Run state re-derivable from disk (load manifest + detect artifacts) | unit | `npx vitest run test/manifest.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>`
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + ONE optional gated live smoke (`MAR_LIVE_CLAUDE=1 npx vitest run test/live`) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` — test config (none exists)
- [ ] `tsconfig.json`, `package.json` (`"type":"module"`), `biome.json`, `.gitignore` (with `runs/`) — project scaffolding
- [ ] `test/fixtures/fake-claude.mjs` — fake-CLI fixture (happy/--fail-auth/--bad-json/--hang)
- [ ] `test/claude-adapter.test.ts`, `test/manifest.test.ts`, `test/workspace.test.ts`, `test/invocation.test.ts`
- [ ] Framework install: `npm install -D vitest@^4 tsx@^4 typescript@^6 @types/node`

## Security Domain

`security_enforcement` not explicitly false → included. Phase 1 is a single-CLI local scaffolding phase with no untrusted external input yet (legal-document inputs and prompt-injection defenses are Phase 5 per PITFALLS Pitfall 8), so the surface is small.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | indirect | Rely on claude CLI's own auth; do NOT store/echo credentials. `ANTHROPIC_API_KEY` (if ever used) read from env only, never logged |
| V3 Session Management | no | Fresh-context per turn; `session_id` captured but not security-sensitive here |
| V4 Access Control | minimal | No multi-user; run dirs are local files |
| V5 Input Validation | yes | zod `safeParse` on all CLI JSON; tolerate-but-validate via `.passthrough()` |
| V6 Cryptography | no | None hand-rolled; nanoid for IDs only (not a secret) |
| V7 Error/Logging | yes | Log argv/exit/duration; do NOT log full prompt content if sensitive — Phase 1 prompts are user-supplied dev inputs; redact in later phases (PITFALLS security table) |

### Known Threat Patterns for {Node CLI + subprocess}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via prompt string | Tampering | execa passes args as an array (no shell) — never use `shell:true` or string-concatenated commands |
| Credential leakage in logs/manifest | Info Disclosure | Never log `ANTHROPIC_API_KEY`; cap what `invocations.ndjson` stores (prompt *reference*, not full content — D-15 already says "prompt reference") |
| Untrusted artifact content treated as instruction | Tampering | Out of scope Phase 1 (single agent, no cross-agent reads); flagged for Phase 5 (PITFALLS Pitfall 8) |
| Half-written/corrupt manifest from crash | Availability | Atomic temp+rename (D-16) |
| Runaway cost from looping invocation | Availability/$$ | No retry in Phase 1 (D-17); timeout bounds each call; per-run budget is Phase 4 (PITFALLS Pitfall 4) |

## Project Constraints (from CLAUDE.md)

- **Drive vendor CLIs as installed, NOT vendor APIs/SDKs** — Phase 1 uses `claude -p`, not the Anthropic SDK. (`--bare`'s API-key requirement does not mean using the SDK; an API key would still drive the CLI.)
- **ESM, Node 22** — no CommonJS.
- **Typed adapter layer is the core architectural asset** — keep `TurnRequest`/`TurnResult` vendor-agnostic; no claude-specific fields leak to protocol.
- **Pin CLI behavior in adapter tests** — flag set drifts between versions; the flag-pinning test is required.
- **GSD workflow enforcement** — file changes go through a GSD command (execution-time concern, not research).
- **Filesystem-first, no daemon/message bus/web UI in v1** — manifest + artifacts are the state.

## Sources

### Primary (HIGH confidence)
- **Live invocation of `claude` 2.1.162 on this machine** — exact `--output-format json` shape, `is_error`/exit-code/`subtype` semantics, `--bare` auth failure, `--json-schema` `structured_output` key. (The load-bearing evidence.)
- `claude --help` (2.1.162) — `--bare` auth constraint text, `--output-format` choices, `--json-schema`.
- execa 9 API docs — https://github.com/sindresorhus/execa/blob/main/docs/api.md — `timeout`, `timedOut`, `killSignal`, `forceKillAfterDelay`, `isForcefullyTerminated`, `reject`, `cleanup`, separate stdout/stderr.
- npm registry (`npm view`) — verified versions: execa 9.6.1, zod 4.4.3, commander 15.0.0, pino 10.3.1, fs-extra 11.3.5, nanoid 5.1.11, vitest 4.1.8, tsx 4.22.4, typescript 6.0.3, @biomejs/biome 2.4.16, @types/node 25.9.1, @types/fs-extra 11.0.4.
- Project research (HIGH): `.planning/research/STACK.md` (flag table), `ARCHITECTURE.md` (filesystem-as-truth, adapter pattern, build order), `PITFALLS.md` (hangs, version drift, half-written artifacts).

### Secondary (MEDIUM confidence)
- zod 4 / TS 6 / commander 15 / pino 10 are newer majors than the project docs assume — API-stability for Phase 1's simple usage is inferred, flagged for verification at implementation (Assumptions A2, A5).

### Tertiary (LOW confidence)
- None relied upon.

## Metadata

**Confidence breakdown:**
- Claude CLI output shape & error semantics: HIGH — verified by live invocation, not training data.
- execa 9 timeout/kill API: HIGH — official docs, exact property names.
- Library versions: HIGH — npm registry queried 2026-06-04.
- Library API stability across major bumps (zod 3→4, TS 5→6): MEDIUM — verify at implementation.
- `--bare`/auth resolution: HIGH on the constraint; the *user's preference* is an open decision (A3).

**Research date:** 2026-06-04
**Valid until:** ~2026-07-04 for libraries; sooner for the claude CLI (vendor churn — re-verify the flag/output shape if claude updates past 2.1.162, and note the June 15 2026 `-p` billing change).
