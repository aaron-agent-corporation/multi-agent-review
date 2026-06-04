# Phase 2: Adapter Layer + Roster + Pre-flight - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 22 (11 source + 11 test/fixture)
**Analogs found:** 22 / 22 (every new file has a Phase-1 analog — this phase is "replicate the claude-adapter discipline twice more + three thin orchestration modules")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/adapters/codex.ts` | adapter | streaming (NDJSON parse) | `src/adapters/claude.ts` | exact (same role + subprocess flow) |
| `src/adapters/gemini.ts` | adapter | request-response (single JSON) | `src/adapters/claude.ts` | exact |
| `src/adapters/registry.ts` | registry/factory | transform (vendor→adapter) | `makeClaudeAdapter` factory in `src/adapters/claude.ts` | role-match |
| `src/schema/turn.ts` (MODIFY) | schema | transform | existing `ClaudeJson` in same file | exact (extend in place) |
| `src/schema/config.ts` | schema | transform/validation | `src/schema/manifest.ts` | exact (zod object + `z.infer`) |
| `src/config.ts` | config loader | file-I/O + validation | `readManifest` in `src/workspace/manifest.ts` | role-match (read+zod-parse) |
| `src/retry.ts` | utility (wrapper) | event-driven (retry loop) | no direct analog — RESEARCH Pattern 3 | partial (see No Analog) |
| `src/preflight.ts` | service | request-response + file-I/O | `detectClaudeVersion` (cli.ts) + adapter invoke | role-match (composed) |
| `src/preflight` cache writer | utility | file-I/O (atomic) | `writeManifestAtomic` in `src/workspace/manifest.ts` | exact |
| `src/gates.ts` | utility (pure fn) | transform | `nextSeq`/`seqFromArtifactName` in `src/workspace/layout.ts` | role-match (pure derivation) |
| `src/init.ts` | utility | file-I/O + PATH detect | `createRun` (atomic write) + RESEARCH Pattern 5 | partial |
| `src/cli.ts` (MODIFY) | CLI | request-response | existing `invoke` command in same file | exact (add subcommands) |
| `test/fixtures/fake-codex.mjs` | test fixture | streaming | `test/fixtures/fake-claude.mjs` | exact |
| `test/fixtures/fake-gemini.mjs` | test fixture | request-response | `test/fixtures/fake-claude.mjs` | exact |
| `test/codex-adapter.test.ts` | test | — | `test/claude-adapter.test.ts` | exact |
| `test/gemini-adapter.test.ts` | test | — | `test/claude-adapter.test.ts` | exact |
| `test/retry.test.ts` | test | — | `test/claude-adapter.test.ts` (mock/fake-timer style) | role-match |
| `test/config.test.ts` | test | — | `test/manifest.test.ts` | role-match |
| `test/preflight.test.ts` | test | — | `test/claude-adapter.test.ts` | role-match |
| `test/gates.test.ts` | test | — | `test/manifest.test.ts` (pure-fn assertions) | role-match |
| `test/init.test.ts` | test | — | `test/manifest.test.ts` | role-match |

---

## Pattern Assignments

### `src/adapters/codex.ts` (adapter, streaming/NDJSON)

**Analog:** `src/adapters/claude.ts` (the reference adapter — copy its full skeleton)

Copy these utilities VERBATIM from `claude.ts` (they are vendor-agnostic and should be shared, not re-derived): `splitBin` (lines 39-48), `safeJsonParse` (lines 51-57), `redactArgv`/`PROMPT_PLACEHOLDER` (lines 23-28). **Recommend: export `splitBin`/`safeJsonParse`/`redactArgv` from a shared module (e.g. a small `adapters/common.ts`) so codex/gemini import rather than copy-paste — claude already `export`s `splitBin`.**

**Imports pattern** (claude.ts lines 1-4) — mirror exactly, swapping the schema import:
```typescript
import { existsSync } from "node:fs";
import { execa } from "execa";
import { CodexEvent, type TurnResult } from "../schema/turn.js";
import type { AgentAdapter, TurnRequest } from "./adapter.js";
```

**buildArgv pattern** (claude.ts lines 14-16) — codex argv from RESEARCH Pattern 1 (LIVE-VERIFIED). Prompt is the TRAILING positional (matters for `redactArgv` — it replaces the arg equal to `req.promptText`):
```typescript
function buildArgv(promptText: string, model?: string): string[] {
  const a = ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only"];
  if (model) a.push("-m", model);
  a.push(promptText);          // trailing positional → redactArgv swaps THIS for "<prompt>"
  return a;
}
```

**execa call** — copy claude.ts lines 79-86 EXACTLY (`timeout: req.timeoutMs`, `killSignal:"SIGTERM"`, `forceKillAfterDelay:5000`, `reject:false`, `cleanup:true`). Do not change these options.

**Timeout guard** — copy claude.ts lines 90-102 verbatim (the `result.timedOut || result.isForcefullyTerminated` block returning `error:"timeout"`).

**Core pattern — NDJSON terminal-event parse** (REPLACES claude.ts single-`safeParse` at lines 105-121). From RESEARCH Pattern 1 + the codex ok-rule. Parse `result.stdout` line-by-line:
```typescript
let completed = false, failed = false, lastText = "", lastErr = "";
for (const line of result.stdout.split("\n")) {
  if (!line.trim()) continue;
  const ev = CodexEvent.safeParse(safeJsonParse(line));   // zod, drift-safe .passthrough()
  if (!ev.success) continue;
  const e = ev.data;
  if (e.type === "item.completed" && e.item?.type === "agent_message") lastText = e.item.text ?? "";
  else if (e.type === "turn.completed") completed = true;
  else if (e.type === "turn.failed") { failed = true; lastErr = e.error?.message ?? "turn failed"; }
  else if (e.type === "error") lastErr = e.message ?? lastErr;
}
// codex ok-rule (RESEARCH): positive terminal event AND exit 0 AND no turn.failed — mirror the
// claude discipline of NEVER trusting a single ambiguous field.
const ok = result.exitCode === 0 && completed && !failed;
```
If no parseable terminal event is seen, treat as failure (mirror claude.ts lines 106-117 "unparseable output" branch — `error: \`unparseable output: ${result.stderr || "no json"}\``).

**TurnResult return** — mirror claude.ts lines 123-135 shape exactly (camelCase, `text: ok ? lastText : ""`, `error: ok ? undefined : (lastErr || "codex error")`, `redactedCommand`). Capture codex `usage` into the optional raw/cost slot if convenient (zero-cost, per Deferred note) but build no cost UX.

**Version note (Pitfall 2):** codex `--version` prints `codex-cli 0.128.0` (two tokens). The Phase-1 `detectClaudeVersion` (cli.ts line 84) does `split(/\s+/)[0]` → returns `"codex-cli"`. Use a per-vendor extractor or `/\d+\.\d+\.\d+/` regex match. Do NOT reuse `split()[0]` for codex/gemini.

---

### `src/adapters/gemini.ts` (adapter, request-response)

**Analog:** `src/adapters/claude.ts` — structurally CLOSER to claude than codex (single JSON object, not NDJSON).

**buildArgv** (RESEARCH Pattern 2, LIVE-VERIFIED flags — `--skip-trust` is REQUIRED, pin it in the flag test):
```typescript
function buildArgv(promptText: string, model?: string): string[] {
  const a = ["-p", promptText, "--output-format", "json", "--skip-trust"];
  if (model) a.push("-m", model);
  return a;
}
```

**Core pattern — parse stdout-OR-stderr** (the one structural divergence from claude, which is stdout-only). REPLACES claude.ts line 105:
```typescript
// CRITICAL (RESEARCH Pitfall 3): gemini's error JSON routes to STDERR on the auth-failure path.
const parsed = GeminiJson.safeParse(safeJsonParse(result.stdout) ?? safeJsonParse(result.stderr));
if (!parsed.success) { /* mirror claude.ts 106-117 "unparseable output" branch */ }
const j = parsed.data;
// gemini ok-rule: exit 0 AND a response string AND no error key (RESEARCH). Do NOT allowlist
// exit codes (undocumented 41/55 observed live).
const ok = result.exitCode === 0 && j.error == null && typeof j.response === "string";
const text = ok ? (j.response ?? "") : "";
const error = ok ? undefined : (j.error?.message ?? result.stderr ?? "gemini error");
```

Everything else (imports, execa options, timeout guard, TurnResult shape) — copy claude.ts. **Gemini is built/tested ENTIRELY against `fake-gemini.mjs`** (D-32, real CLI auth broken on this machine); do not gate CI on a live gemini success.

---

### `src/adapters/registry.ts` (registry/factory, vendor→adapter)

**Analog:** the `makeClaudeAdapter(bin)` factory shape (`src/adapters/claude.ts` line 70) — three sibling factories selected by vendor.

This is the ORCH-03 seam. A map keyed on the `vendor` literal returning the matching `make*Adapter`. Each entry takes the resolved `bin` (roster `bin` override or vendor default `"claude"`/`"codex"`/`"gemini"`). Adding a vendor = adding one entry, zero protocol change.
```typescript
import { makeClaudeAdapter } from "./claude.js";
import { makeCodexAdapter } from "./codex.js";
import { makeGeminiAdapter } from "./gemini.js";
import type { AgentAdapter } from "./adapter.js";
const FACTORIES = { claude: makeClaudeAdapter, codex: makeCodexAdapter, gemini: makeGeminiAdapter } as const;
export function makeAdapter(vendor: keyof typeof FACTORIES, bin?: string): AgentAdapter {
  return FACTORIES[vendor](bin);   // each factory defaults its own bin
}
```

---

### `src/schema/turn.ts` (MODIFY — add CodexEvent + GeminiJson)

**Analog:** the existing `ClaudeJson` in the SAME file (lines 9-21).

Mirror the `ClaudeJson` style EXACTLY: `z.object({...}).passthrough()` (drift-safe), declare ONLY consumed fields, export `z.infer` type, keep the "MUST NOT leak past the adapter (D-12)" doc comment. `TurnResult` (lines 27-47) is UNCHANGED — both new adapters normalize into it. Schemas from RESEARCH Code Examples:
```typescript
export const CodexEvent = z.object({
  type: z.string(),
  item: z.object({ type: z.string(), text: z.string().optional() }).partial().optional(),
  error: z.object({ message: z.string() }).partial().optional(),
  message: z.string().optional(),
  usage: z.unknown().optional(),
}).passthrough();

export const GeminiJson = z.object({
  response: z.string().optional(),
  stats: z.unknown().optional(),
  session_id: z.string().optional(),
  error: z.object({ type: z.string().optional(), message: z.string(), code: z.number().optional() }).optional(),
}).passthrough();
```

---

### `src/schema/config.ts` (schema, validation)

**Analog:** `src/schema/manifest.ts` (zod object + `z.infer` + derived status-type pattern).

Mirror manifest.ts: top-level `z.object`, exported `z.infer` types, sub-object (`ManifestArtifact` → `Agent`). NEW element vs the analog: a `discriminatedUnion("vendor", [...])` and a `superRefine` for name-uniqueness (RESEARCH Pattern 4):
```typescript
const Base = { name: z.string().min(1), bin: z.string().optional(), model: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(), extraArgs: z.array(z.string()).optional() };
const Agent = z.discriminatedUnion("vendor", [
  z.object({ vendor: z.literal("claude"), ...Base }),
  z.object({ vendor: z.literal("codex"),  ...Base }),
  z.object({ vendor: z.literal("gemini"), ...Base }),
]);
export const MarConfig = z.object({
  agents: z.array(Agent).min(1),
  defaults: z.object({ timeoutMs: z.number().int().positive().default(600_000),
                       retries: z.number().int().min(0).default(2) }).default({}),
}).superRefine((c, ctx) => { /* duplicate-name check → ctx.addIssue({code:"custom", ...}) */ });
```
**Do NOT enforce the >=2-distinct-vendor rule here** (RESEARCH Anti-Pattern) — that is a run-start GATE (`gates.ts`), because a single-vendor config is legitimate for `mar invoke` (D-29 exemption). `defaults.retries` default is **2** (D-23; the CONTEXT example shows 1 but the discussion settled on 2).

---

### `src/config.ts` (config loader, file-I/O + validation)

**Analog:** `readManifest` in `src/workspace/manifest.ts` (lines 40-43) — read file, `JSON.parse`, zod-`.parse`.

```typescript
// mirror readManifest: read → JSON.parse → schema.parse, but with a CLEAR missing-file error (D-20)
export async function loadConfig(path = "mar.config.json"): Promise<MarConfig> {
  if (!existsSync(path)) throw new Error(`no roster: ${path} not found (run \`mar init\`)`);
  return MarConfig.parse(JSON.parse(await readFile(path, "utf8")));
}
```
Add `resolveAgent(config, name): AgentEntry` — the SINGLE name-resolution path (D-20); throw a clear error naming valid agent names on miss. For zod error formatting, iterate `err.issues` (path+message) or `z.treeifyError` (zod 4) — verify the exact API at implementation (RESEARCH A7).

---

### `src/preflight.ts` (service, request-response + file-I/O)

**Analogs:**
- version tier → `detectClaudeVersion` (`src/cli.ts` lines 74-88) — `splitBin` + `execa(..., ["--version"], { reject:false, timeout })`.
- probe tier → an `adapter.invoke()` call (the probe IS a tiny adapter invocation via the registry — do NOT re-implement CLI calls).
- cache write → `writeManifestAtomic` (`src/workspace/manifest.ts` lines 49-56) — temp+rename.

Per RESEARCH: tier 1 = bin on PATH + `--version` parses → installed (use the per-vendor version extractor, NOT `split()[0]`); tier 2 = probe `withRetry(adapter.invoke, { retries: 0 })` with the "Reply with exactly: pong" prompt and ~30s timeout (D-33; codex retries auth 5x internally — Pitfall 5, size generously). Emit the per-agent status line + failure hint (D-28/D-31 gemini-auth + Antigravity hint text). Cache JSON validated by a `PreflightCache` zod schema (RESEARCH Code Examples), written atomically OUTSIDE `runs/` (e.g. `.mar/preflight.json`, gitignored), TTL ~10 min vs `checkedAt`.

**Atomic cache write — copy the `writeManifestAtomic` recipe** (validate-then-temp-then-rename), do NOT `writeFile`-and-hope.

---

### `src/gates.ts` (pure fn, transform)

**Analog:** `nextSeq`/`seqFromArtifactName` in `src/workspace/layout.ts` (lines 55-79) — small, pure, fully-unit-testable derivation functions over arrays.

```typescript
export function distinctVendors(agents: { vendor: string }[]): Set<string> {
  return new Set(agents.map((a) => a.vendor));
}
export function assertReviewable(agents: { vendor: string }[]): void {  // D-29 hard gate
  const v = distinctVendors(agents);
  if (v.size < 2) throw new Error(`review needs >=2 distinct vendors; found: ${[...v].join(", ") || "none"}`);
}
// --skip-failed (D-30): drop failing agents, re-check >=2 distinct remain healthy.
```
No I/O, no side effects (like `layout.ts`). Build now; Phase 3 `mar run` consumes.

---

### `src/init.ts` (utility, file-I/O + PATH detect)

**Analogs:** atomic write → `createRun`/`writeManifestAtomic` (`src/workspace/manifest.ts`); JSON-write style → manifest's `JSON.stringify(valid, null, 2) + "\n"`. PATH detection has NO analog → RESEARCH Pattern 5 (`onPath` Node PATH-walk, no shell).

Probe PATH for claude/codex/gemini; write a starter `mar.config.json` listing each DETECTED vendor as one agent + the `defaults` block (D-21). Match the manifest writer's `JSON.stringify(x, null, 2) + "\n"` formatting. No shell (`existsSync` over `PATH.split(delimiter)`) — consistent with the no-shell-injection posture (T-01-05).

---

### `src/cli.ts` (MODIFY — add `init`, `preflight`; roster-resolve `invoke`)

**Analog:** the existing `invoke` command + `buildProgram()` in the SAME file (lines 230-247).

- Add `program.command("init")` and `program.command("preflight")` mirroring the existing `.command("invoke").description(...).option(...).action(...)` chain (commander).
- `invoke` change (D-20): REPLACE the hardcoded `opts.agent !== "claude"` guard (lines 92-97) and the `MAR_CLAUDE_BIN` default (line 99) with roster-name resolution → `loadConfig` + `resolveAgent` + `makeAdapter(entry.vendor, entry.bin)`. `mar invoke` stays EXEMPT from the >=2-vendor gate and does NOT auto-preflight (D-27/D-29).
- Wrap the adapter invoke in `withRetry` (D-24) and log EVERY attempt via `logInvocation` with the new `attempt` field (D-25).
- Keep CLI thin (RESEARCH Anti-Pattern "Building Phase-3 `mar run`"): business logic lives in `config.ts`/`preflight.ts`/`gates.ts`/`retry.ts` so Phase 3 reuses them. Preserve the existing "ONE human-readable line, never raw JSON" console discipline (lines 218-225) and "branch ONLY on turn.ok" rule (line 176 / T-01-13).

---

### Fixtures: `test/fixtures/fake-codex.mjs`, `test/fixtures/fake-gemini.mjs`

**Analog:** `test/fixtures/fake-claude.mjs` — copy its structure EXACTLY: `#!/usr/bin/env node`, `const args = process.argv.slice(2)`, mode-select via `args.includes("--flag")`, `process.stdout.write(JSON.stringify(...))` + `process.exit(code)`, and a `--hang` mode (`setInterval(() => {}, 1e9)`) for timeout tests.

- **fake-codex.mjs** — emit the LIVE-VERIFIED NDJSON (multiple `stdout.write` lines: `thread.started` → `turn.started` → `item.completed{agent_message}` → `turn.completed`). Modes: happy / `--fail-auth` (repeated `error` 401 events + `turn.failed`, exit 1) / `--rate-limit` (429/`RESOURCE_EXHAUSTED` in a `turn.failed` for the retry test) / `--bad-json` / `--hang`.
- **fake-gemini.mjs** — happy = docs `{response, stats}` on stdout, exit 0. Failure modes write the `{error}` JSON to **stderr** (`process.stderr.write`) with exit 41/55 (the JSON-on-stderr gotcha — Pitfall 3), plus `--rate-limit` (429) and `--hang`.

### Tests: `*-adapter.test.ts`, `retry/config/preflight/gates/init.test.ts`

**Analog:** `test/claude-adapter.test.ts` — copy its exact structure:
- `FIXTURE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url))` (lines 1-10).
- `req(promptText, timeoutMs)` helper (lines 32-34).
- happy / fail-auth / unparseable / `--hang` timeout cases (lines 37-86).
- **Flag-pinning test** (lines 88-116) — the load-bearing drift guard (Pitfall 7): `vi.doMock("execa", ...)` + `vi.resetModules()` + re-import, then assert the EXACT argv. For codex assert `["exec","--json","--skip-git-repo-check","--ephemeral","-s","read-only", prompt]`; for gemini assert `["-p", prompt, "--output-format","json","--skip-trust"]` and `.not.toContain("--yolo")`. Pin EVERY flag.
- `retry.test.ts` — use vitest fake timers (`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`) so backoff sleeps don't slow the suite (RESEARCH); assert transient retried, fatal NOT retried, each attempt logged.
- `config/gates/init.test.ts` — mirror `test/manifest.test.ts` (pure assertions over zod parse / pure fns / written file).

---

## Shared Patterns

### Injectable bin via `splitBin` + no-shell argv arrays
**Source:** `src/adapters/claude.ts` lines 39-48 (already `export`ed).
**Apply to:** codex.ts, gemini.ts, preflight.ts version tier, init.ts.
Single-whitespace split (keeps spaced paths intact), or whole-path-if-exists. execa always receives `(cmd, argvArray, opts)` — never a shell string (T-01-05). Tests inject the fake fixture as `bin`.

### redactedCommand audit invariant (WR-04 / D-15)
**Source:** `src/adapters/claude.ts` lines 23-28 + 78.
**Apply to:** ALL adapters. The redacted argv is the SAME array spawned, with the arg equal to `req.promptText` swapped for `"<prompt>"` — one source of truth shared with the spawn, never hand-rebuilt. The prompt body is NEVER in the log. (Codex/gemini place the prompt at different argv positions; `redactArgv` matches by value, so it works unchanged.)

### Verified ok-rule discipline (never trust one ambiguous field)
**Source:** `src/adapters/claude.ts` lines 119-121 (`exitCode === 0 && is_error === false`, `result.type` deliberately ignored).
**Apply to:** codex (`exit 0 && turn.completed && !turn.failed`), gemini (`exit 0 && error == null && typeof response === "string"`). Success is decided in the ADAPTER tier (`turn.ok`), NEVER re-derived at the CLI tier (T-01-13).

### Graceful failure normalization (no throw, no crash)
**Source:** `src/adapters/claude.ts` — timeout guard (lines 90-102) and unparseable-output branch (lines 105-117).
**Apply to:** codex.ts, gemini.ts. Timeout/kill → `error:"timeout"` without trusting stdout; unparseable → `ok:false, error:"unparseable output: ..."`. Vendor quirks (codex NDJSON, gemini stderr-JSON) must NOT leak past the adapter (D-12).

### Atomic temp+rename for on-disk state
**Source:** `src/workspace/manifest.ts` `writeManifestAtomic` lines 49-56 (validate → write `.tmp-<pid>` → `rename`).
**Apply to:** preflight cache (`.mar/preflight.json`), `mar init` config write. Crash-safe; reuse the proven recipe. Match the `JSON.stringify(x, null, 2) + "\n"` formatting.

### Per-vendor version extraction (Pitfall 2)
**Source:** `detectClaudeVersion` in `src/cli.ts` lines 74-88 — but its `split(/\s+/)[0]` is claude-only.
**Apply to:** preflight tier 1 + `mar init` version capture. claude=`2.1.162 (Claude Code)` (first token), codex=`codex-cli 0.128.0` (second token), gemini=`0.45.0` (bare). Use `/\d+\.\d+\.\d+/` regex or per-vendor logic — NEVER blind `split()[0]` for codex/gemini (it yields `"codex-cli"`).

### Per-attempt invocation logging (D-25)
**Source:** `logInvocation` + `InvocationRecord` in `src/log/invocation.ts`.
**Apply to:** retry.ts `onAttempt` callback + cli.ts. EXTEND `InvocationRecord` with an `attempt: number` field rather than creating a parallel log — one audit trail. pino sync NDJSON append is unchanged.

---

## No Analog Found

Files whose CORE mechanism has no Phase-1 precedent (planner should use the cited RESEARCH patterns; skeleton/IO still borrow Phase-1 analogs above):

| File | Role | Data Flow | Reason / Use Instead |
|------|------|-----------|----------------------|
| `src/retry.ts` | utility wrapper | event-driven retry loop | No retry/backoff code exists in Phase 1. Use **RESEARCH Pattern 3** (`withRetry`, ~30 lines plain TS): `node:timers/promises setTimeout` for backoff, transient-vs-fatal `classify` reading only normalized `TurnResult` signals + a vendor tag, exp-backoff+jitter, honor retry-after, `onAttempt` → `logInvocation`. No new dependency (p-retry rejected, D-35). |
| PATH-detection in `src/init.ts` | utility | PATH walk | No PATH-detection code in Phase 1. Use **RESEARCH Pattern 5** (`onPath`: walk `process.env.PATH.split(delimiter)` + `existsSync`, PATHEXT on win32, no shell). The config-WRITE half DOES have an analog (`createRun`/atomic write above). |
| transient-classification fns (in `retry.ts` or per-adapter) | utility | transform | No precedent. Use the LIVE-VERIFIED string sets in RESEARCH "codex/gemini transient-classification": transient = `429`/`RESOURCE_EXHAUSTED`/`rate limit`/`usage limit`/`Too Many Requests`/`5xx`/`overloaded`; fatal = `401`/`Unauthorized`/`Missing bearer`/`not logged in`/`invalid_request`/`model not supported` (codex), `Auth method`/`ProjectIdRequired`/`trusted directory`/`API key not valid`/codes {41,42,55} (gemini). Do NOT abort on the FIRST gemini 429 (false-positive #17906 — Pitfall 4). |

## Metadata

**Analog search scope:** `src/` (9 files), `test/` (9 files) — full Phase-1 tree (small, exhaustively read).
**Files scanned:** 18 source/test + 3 schema; all Phase-1 files read in full (each ≤ 255 lines).
**Pattern extraction date:** 2026-06-04
