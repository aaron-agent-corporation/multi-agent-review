# Phase 3: Protocol Engine + Independence Enforcement - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 8 new/modified files
**Analogs found:** 8 / 8 (all have a same-codebase analog)

> **Ratification note (overrides RESEARCH.md A1):** The user has ratified **XState v5** as the
> protocol-engine mechanism. RESEARCH.md recommended a hand-rolled sequential async loop and
> explicitly flagged this as a MEDIUM-confidence judgment call for discuss-phase. That recommendation
> is **superseded** — `src/protocol/engine.ts` is to be built as an XState v5 machine/actor. The
> phase *shape* RESEARCH describes (typed 6-phase descriptor, parallel fan-out per phase, pure
> artifacts-exist gate, scoped-`cwd` independence, promotion at the 1→2 boundary) is unchanged; only
> the engine's control-flow substrate changes from a `for` loop to an XState statechart. Pattern
> assignments below reflect this: the engine has **no in-repo XState analog** (it is the first
> statechart), so its imports/actor wiring must come from the XState v5 docs — but every *primitive
> it orchestrates* (turn seam, gate, manifest, scope) has a concrete analog here and MUST be reused
> unchanged.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/protocol/engine.ts` (NEW) | service / state-machine | event-driven (XState) + batch fan-out | `src/cli.ts` `runInvoke` (lines 112-274) for the turn seam; no in-repo statechart analog | partial (orchestration logic exists; XState substrate is net-new) |
| `src/protocol/phases.ts` (NEW) | config / typed-data | transform (data, not control) | `src/adapters/registry.ts` `FACTORIES` (lines 13-17) — typed `as const` descriptor table | role-match |
| `src/protocol/gate.ts` (NEW) | utility (pure fn) | transform (disk → bool) | `src/gates.ts` (whole file) — pure, no-I/O gate style | exact |
| `src/workspace/scope.ts` (NEW) | utility (workspace) | file-I/O | `src/workspace/artifacts.ts` (lines 43-79) + `manifest.ts` (fs-extra `ensureDir`/`copy`) | role-match |
| `src/cli.ts` (MODIFY: add `run` subcommand) | controller (CLI) | request-response | existing `invoke`/`init`/`preflight` commands in same file (lines 324-353) | exact (same file) |
| `src/adapters/adapter.ts` + 3 adapters (MODIFY: add optional `cwd`) | model (contract) + adapter | request-response | `TurnRequest` (adapter.ts 8-19) + execa call sites (claude.ts 46-57, codex.ts 47-60) | exact (same files) |
| `src/schema/manifest.ts` + `manifest.ts` (MODIFY: phase tracking) | model + service | CRUD | existing `Manifest` schema (manifest.ts schema 20-27) + `addArtifact`/`setStatus` | exact (same files) |
| `test/protocol-engine.test.ts`, `protocol-gate.test.ts`, `scope-independence.test.ts`, `adapter-cwd.test.ts`, `planted-error.test.ts` (NEW) | test | n/a | `test/adapter-stdin.test.ts` (drift-guard), `test/e2e-invoke.test.ts` (integration), `test/fixtures/fake-claude.mjs` | role-match |

---

## Pattern Assignments

### `src/protocol/phases.ts` (config / typed-data, transform)

**Analog:** `src/adapters/registry.ts` lines 13-17 — the typed `as const` descriptor table pattern (a frozen data structure the rest of the code iterates, with `keyof typeof` type-narrowing). RESEARCH.md Pattern 1 (lines 177-194) already gives the exact target shape; this is the in-repo precedent for "protocol as data, not control flow."

**`as const` typed descriptor table** (registry.ts lines 13-17):
```typescript
export const FACTORIES = {
  claude: makeClaudeAdapter,
  codex: makeCodexAdapter,
  gemini: makeGeminiAdapter,
} as const;
```
**Copy:** Define `PHASES: readonly Phase[]` the same way (frozen literal, `readonly` fields per RESEARCH Pattern 1). The `kind` field on each phase feeds straight into `artifactName(seq, agent, kind)` — see layout.ts line 31 default `kind = "output"`, which the comment (layout.ts line 30) already notes "Phase 3 extends kind to protocol phases."

---

### `src/protocol/gate.ts` (utility / pure fn, transform — PROT-03)

**Analog:** `src/gates.ts` (whole file) — the canonical pure-gate style. Its header comment (gates.ts lines 3-6) explicitly says it "mirrors the layout.ts pure-derivation style" and is the thing "Phase 3's `mar run` reuses these directly." The gate primitive `isDone` already exists in `artifacts.ts`.

**Pure-gate style + no-I/O contract** (gates.ts lines 18-23):
```typescript
export function assertReviewable(agents: { vendor: string }[]): void {
  const v = distinctVendors(agents);
  if (v.size < 2) {
    throw new Error(`review needs >=2 distinct vendors; found: ${[...v].join(", ") || "none"}`);
  }
}
```

**The done-definition to call per required file** (artifacts.ts lines 85-87) — DO NOT reimplement with bare `existsSync` (Pitfall 3):
```typescript
export function isDone(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0;   // exists AND non-empty
}
```
**Copy:** `requiredArtifactsExist(...)` returns `expectedFiles.every((p) => isDone(p))` (RESEARCH gate.ts shape, lines 244-249). Build expected paths with `artifactPath(runDir, seq, agent, kind)` (layout.ts 36-43). Gate fails on a 0-byte file *because* `isDone` checks size>0 — this is the belt-and-suspenders for Pitfall 3.

---

### `src/workspace/scope.ts` (utility / workspace, file-I/O — PROT-04)

**Analog:** `src/workspace/artifacts.ts` (fs-extra import + atomic-write discipline) and `src/workspace/manifest.ts` (fs-extra `ensureDir`/`rename` destructure pattern). The independence mechanism (per-agent `cwd`) rides on execa's `cwd` option, which the adapters already call (claude.ts line 46).

**fs-extra default-import + named destructure** (artifacts.ts lines 2-5):
```typescript
import fsExtra from "fs-extra";
import { artifactPath, rawPath } from "./layout.js";

const { ensureDir, rename, writeFile } = fsExtra;
```
**Copy:** `scope.ts` destructures `const { ensureDir, copy } = fsExtra;` (RESEARCH scope.ts shape, lines 215-217). `scopedWorkdir(runDir, agent, inputPath)` → `ensureDir(work/<agent>)`, `copy(inputPath, work/<agent>/input.md)`, return the dir as the execa `cwd`. `promoteDrafts(runDir, agents)` → `copy(work/<agent>/<draft> → shared/)` ONLY at the 1→2 boundary (RESEARCH lines 226-233).

**Path-safety guard to honor** (cli.ts lines 28-30) — never let an agent name or run id escape `runs/`:
```typescript
const RUN_ID_RE = /^[A-Za-z0-9_-]+$/;
```
**Copy:** join everything under `runDir` only; the run id is already charset-gated by `newRunId` (layout.ts 4-8). Assert in test that `readdirSync(work/<agentA>)` does NOT contain agent B's draft (Pitfall 1).

---

### `src/protocol/engine.ts` (service / XState state-machine, event-driven — PROT-01)

**Analog (turn seam — REUSE EXACTLY):** `src/cli.ts` `runInvoke` lines 194-260. This is "the body of one turn" the engine fans out N-wide per phase. RESEARCH Don't-Hand-Roll (lines 263) and Code Examples (lines 332-348) both pin this. **No in-repo XState analog exists** — the engine's actor/machine wiring is net-new from XState v5 docs; only the *invoked primitive* is copied.

**The one turn to wrap in each fan-out branch** (cli.ts lines 197-227, condensed):
```typescript
const adapter = makeAdapter(entry.vendor, entry.bin, entry.model);
const turn = await withRetry(
  () =>
    adapter.invoke({
      agent: entry.name,
      promptText,
      runDir,
      seq,
      timeoutMs,
      // NEW Phase-3 field — PROT-04: cwd: phase.scoped ? scopedDir : undefined,
    }),
  {
    retries,
    classify: CLASSIFY[entry.vendor],
    onAttempt: (t, attempt) =>
      logInvocation(runDir, {
        command: t.redactedCommand,
        promptRef,
        exitCode: t.exitCode,
        durationMs: t.durationMs,
        timedOut: t.timedOut,
        attempt,
      }),
  },
);
```

**Persist-on-success branch** (cli.ts lines 233-251) — reuse for each phase artifact, passing `kind: phase.kind`:
```typescript
if (turn.ok) {
  const written = await writeArtifact(runDir, seq, entry.name, {
    text: turn.text, raw: turn,
    frontmatter: { runId /*, phase: phase.name */ },
  });
  const relPath = written.path.slice(runDir.length + 1);
  await addArtifact(runDir, { path: relPath, agent: entry.name, seq, kind: phase.kind, createdAt: new Date().toISOString() });
}
```

**Monotonic seq (REUSE — never `artifacts.length`)** (cli.ts lines 167-171, anti-pattern at RESEARCH line 254):
```typescript
const onDiskNames = existsSync(runDir) ? readdirSync(runDir) : [];
seq = nextSeq(manifest.artifacts.map((a) => a.path), onDiskNames);
```

**Fan-out (RESEARCH engine.ts shape, lines 197-207)** — `Promise.allSettled` (NOT `Promise.all`, Pitfall 5) + optional `p-limit`; after the fan-out, the gate decides sufficiency (mirrors `applySkipFailed`, gates.ts 30-33). In XState terms: model each phase as a state that invokes a parallel set of child actors (one per agent), transitions on "all settled," runs `promoteDrafts` as an action on exit of the `draft` state, then a `guard` calls `requiredArtifactsExist` before the transition to the next phase state; on guard-false → `setStatus(runDir, "failed")` and a `failed` final state.

---

### `src/cli.ts` — add `mar run <input>` subcommand (controller, request-response — PROT-01)

**Analog:** the three existing subcommands in the SAME file (`invoke` lines 324-339, `init` 341-346, `preflight` 348-353). RESEARCH Code Example lines 316-329 gives the exact target.

**Thin subcommand → set `process.exitCode` from a delegate** (cli.ts lines 324-339):
```typescript
program
  .command("invoke")
  .description("...")
  .requiredOption("--agent <name>", "...")
  .action(async (opts: InvokeOptions) => {
    process.exitCode = await runInvoke(opts);
  });
```
**Copy:** add `.command("run").argument("<input>", "...")`; in the action call `loadConfig()` → `assertReviewable(config.agents)` (NOT exempt — RESEARCH anti-pattern line 256, unlike `invoke` which is exempt per cli.ts line 115) → `newRunId()`/`runDirFor`/`createRun` (cli.ts 180-192) → `process.exitCode = await runProtocol(runDir, config, input)`. Keep the CLI thin: NO vendor argv, NO business logic (02-05 thin-CLI rule). Validate `<input>` is a regular file with the bounded-read pattern from `resolvePrompt` (cli.ts 60-75, 10MB cap WR-05).

---

### `src/adapters/adapter.ts` + `claude.ts`/`codex.ts`/`gemini.ts` — add optional `cwd` (model contract + adapter, request-response — PROT-04)

**Analog:** `TurnRequest` interface (adapter.ts lines 8-19) and the execa call sites (claude.ts 46-57, codex.ts 47-60). This is the ONE additive contract change Phase 3 needs (RESEARCH line 235, A3).

**Where to add the field** (adapter.ts lines 8-19) — append an OPTIONAL `cwd`, default = today's behavior:
```typescript
export interface TurnRequest {
  agent: string;
  promptText: string;
  runDir: string;
  seq: number;
  timeoutMs: number;
  // NEW (PROT-04): optional scoped working directory for the draft phase.
  // cwd?: string;   // omitted → execa uses process cwd (UNCHANGED behavior)
}
```

**Where to thread it** (claude.ts lines 46-57; identical block in codex.ts 47-60, gemini.ts) — add `cwd` to the existing execa options object, preserving every pinned option:
```typescript
const result = await execa(cmd, argv, {
  timeout: req.timeoutMs,
  killSignal: "SIGTERM",
  forceKillAfterDelay: 5000,
  reject: false,
  cleanup: true,
  stdin: "ignore",
  // NEW: ...(req.cwd ? { cwd: req.cwd } : {}),   // omit when unset → unchanged
});
```
**Critical (Pitfall 4):** codex's `--skip-git-repo-check`, `--ephemeral`, `-s read-only` (codex.ts line 19) MUST keep holding under a non-repo `cwd` — verify session/rollout files do NOT appear in `work/<agent>/`. Spread the `cwd` conditionally so the absent case spawns the EXACT same options as today.

---

### `src/schema/manifest.ts` + `src/workspace/manifest.ts` — phase-completion tracking (model + service, CRUD)

**Analog:** the existing `Manifest` zod schema (schema/manifest.ts lines 20-27) and the atomic mutators (`addArtifact` manifest.ts 59-68, `setStatus` 71-76). Any new phase-state field is additive and `.parse()`-validated on every write (manifest.ts 50-51).

**Additive schema field + validated atomic write** (schema/manifest.ts 20-27 → add e.g. `phase`/`completedPhases`; manifest.ts 49-56):
```typescript
export async function writeManifestAtomic(runDir: string, manifest: Manifest): Promise<void> {
  const valid = Manifest.parse(manifest);   // never persist a manifest that won't parse back
  const finalPath = manifestPath(runDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  await rename(tmpPath, finalPath);          // atomic temp-then-rename (D-16)
}
```
**Copy:** if adding a phase field, extend the `Manifest` zod object (make it `.optional()` so existing Phase 1-2 manifests still parse — RESEARCH Runtime State Inventory line 276 confirms no migration) and add a `setPhase`-style mutator mirroring `setStatus` (manifest.ts 71-76). Prefer driving the engine off `readManifest` + on-disk `isDone` (filesystem-as-truth, D-14) rather than introducing new in-memory state.

---

### Test files (test, n/a)

**Drift-guard analog (for `adapter-cwd.test.ts`):** `test/adapter-stdin.test.ts` (whole file) — mocks `execa`, captures the options object, asserts the option at the call site. RESEARCH names this as the exact pattern to mirror (lines 300, 423).

**execa-option capture + assert** (adapter-stdin.test.ts lines 10-26, 42-49):
```typescript
function mockExeca(stdout) {
  const calls = [];
  vi.doMock("execa", () => ({
    execa: (cmd, argv, opts) => { calls.push({ cmd, argv, opts }); return Promise.resolve({ stdout, stderr: "", exitCode: 0, durationMs: 1, timedOut: false, isForcefullyTerminated: false }); },
  }));
  return calls;
}
// ...
await makeCodexAdapter("codex").invoke(req("ping"));
expect(calls[0].opts.stdin).toBe("ignore");
```
**Copy:** assert `calls[0].opts.cwd === <dir>` when `req.cwd` is set, and `calls[0].opts.cwd === undefined` (or absent) when unset.

**Integration analog (for `protocol-engine.test.ts`, `planted-error.test.ts`):** `test/e2e-invoke.test.ts` (whole file) — `mkdtempSync` workdir, write a `mar.config.json` that injects fake bins, drive the CLI via `npx tsx`, assert on-disk side effects (manifest, artifacts, ndjson). Use `vi.setConfig({ testTimeout: 60_000 })` (line 16) for tsx cold-start.

**Fixture analog (for distinct per-phase outputs):** `test/fixtures/fake-claude.mjs` — argv-flag mode switch (`--fail-auth`/`--bad-json`/`--hang`). RESEARCH Wave-0 (line 437) suggests extending these with an `--emit <kind>` mode so a fixture returns distinct per-phase artifacts and so the planted-error A/B (control = shared-context masks error; treatment = independent surfaces it — Pitfall 2) is hermetic and burns zero credits.

---

## Shared Patterns

### Turn execution (spawn + retry + normalize + log)
**Source:** `src/cli.ts` lines 194-227 (`withRetry(makeAdapter(...).invoke(...))` + `onAttempt → logInvocation`)
**Apply to:** every agent turn the engine fans out — `engine.ts`. DO NOT reimplement (RESEARCH Don't-Hand-Roll line 263).

### Pure gates (no I/O, throw-or-return)
**Source:** `src/gates.ts` (whole file) + `isDone` (artifacts.ts 85-87)
**Apply to:** `gate.ts` (`requiredArtifactsExist`) and the `mar run` run-start `assertReviewable` call (NOT exempt).
```typescript
export function assertReviewable(agents: { vendor: string }[]): void {
  const v = distinctVendors(agents);
  if (v.size < 2) throw new Error(`review needs >=2 distinct vendors; found: ${[...v].join(", ") || "none"}`);
}
```

### Atomic filesystem writes (temp-then-rename)
**Source:** `src/workspace/artifacts.ts` lines 43-48 (`writeAtomic`) + `manifest.ts` 49-56
**Apply to:** any new file `scope.ts` or the engine writes; reuse `writeArtifact`/`addArtifact`/`setStatus` rather than new JSON I/O (D-16, RESEARCH line 264).

### Deterministic naming + monotonic seq
**Source:** `src/workspace/layout.ts` — `artifactName(seq, agent, kind)` (31-33), `artifactPath` (36-43), `nextSeq` (68-79)
**Apply to:** every per-phase artifact (thread `kind = phase.kind`); seq from `nextSeq`, NEVER `artifacts.length` (anti-pattern RESEARCH line 254).

### fs-extra import idiom
**Source:** `src/workspace/artifacts.ts` lines 2-5 / `manifest.ts` 1-5 — `import fsExtra from "fs-extra"; const { ... } = fsExtra;`
**Apply to:** `scope.ts` (`ensureDir`, `copy`).

### Path-safety under `runs/`
**Source:** `src/cli.ts` lines 28-30 (`RUN_ID_RE`) + `layout.ts` 4-8 (path-safe nanoid alphabet)
**Apply to:** `scope.ts` and the `mar run` `<input>` validation — `join` under `runDir` only; bounded 10MB input read (cli.ts 60-75).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/protocol/engine.ts` (XState substrate only) | state-machine | event-driven | First XState statechart in the repo — actor/machine/guard/snapshot wiring has no in-repo precedent; take it from XState v5 docs (`createMachine`/`createActor`/`fromPromise`, `setup({ actors, guards, actions })`). NOTE: the *primitives it orchestrates* (turn seam, gate, manifest, scope, naming) ALL have exact analogs above — only the control-flow shell is net-new. Per the ratification override, build the shell as XState v5, not a `for` loop. |

---

## Metadata

**Analog search scope:** `src/` (cli, gates, config, retry, preflight, init, adapters/*, workspace/*, schema/*, log/*), `test/` (drift-guard, e2e, fixtures)
**Files scanned (read):** cli.ts, gates.ts, layout.ts, artifacts.ts, adapter.ts, claude.ts, codex.ts, manifest.ts, registry.ts, log/invocation.ts, schema/turn.ts, schema/manifest.ts, test/adapter-stdin.test.ts, test/e2e-invoke.test.ts, test/fixtures/fake-claude.mjs
**Pattern extraction date:** 2026-06-04
**Engine substrate:** XState v5 (user-ratified; overrides RESEARCH.md A1 sequential-loop recommendation)
