---
phase: 05-hardening-resume-gating-majority-guards
date: 2026-06-05
status: complete
mapper: gsd-pattern-mapper
sources:
  - 05-CONTEXT.md (D-50..D-65)
  - 05-RESEARCH.md (Q1..Q7, recommended approaches)
---

# Phase 5 Pattern Map — Hardening: Resume, Gating, Majority, Guards

Each target file below carries: **role** (classification + data flow), the **closest existing
analog** (file:lines, read live), the concrete **excerpt** to imitate, and **deviations to watch**.
The dominant finding holds: nearly every Phase-5 need has a direct, on-disk analog already in the
tree. This phase is wiring around existing primitives, plus one genuinely-new artifact
(`resolved-decisions.md`) and one shared-reader extraction.

Legend for data-flow roles:
- **CLI controller** — thin command surface, parses args, delegates to engine/business logic.
- **Engine/orchestration** — XState machine + phase drivers.
- **Pure logic** — guards/tally/comparison, no I/O.
- **Disk I/O** — manifest/artifact read-modify-write, atomic temp-then-rename.
- **Schema** — zod module under `src/schema/`.
- **Template/contract** — the seeded format-contract `.tmpl`.
- **Test/fixture** — vitest + fake-CLI fixtures.

---

## 1. `src/cli.ts` — new `mar resume` subcommand + run-start mode prompt (MODIFY)

**Role:** CLI controller. New `resume <run-id>` / `resume --last` command (D-55) and a run-start
gated/autonomous mode prompt (D-53) on `mar run`. Must stay thin (02-05 thin-CLI rule): load roster,
re-derive state from manifest, delegate phase/business logic to the engine. Reads manifest status to
decide resumability; writes nothing the engine can't.

**Analog — subcommand registration (`buildProgram`), cli.ts:370–414:**
```ts
program
  .command("run")
  .description("Run the 6-phase review protocol on an input document")
  .argument("<input>", "path to the input document")
  .action(async (input: string) => {
    process.exitCode = await runRun(input);
  });
```
Pattern to imitate exactly: `.command(...).description(...).argument/.option(...).action(async () => { process.exitCode = await runX(...) })`. Every command sets `process.exitCode` from its
`runX` handler return value; handlers return a numeric exit code (0 ok, 1 failure, 2 usage error).

**Analog — a `runX` handler shape, `runRun` cli.ts:326–368:**
```ts
async function runRun(input: string): Promise<number> {
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig();
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  // ...gates / validation, each failure → stderr + `return 2`...
  const runId = newRunId();
  const runDir = runDirFor(runId);
  await createRun({ runDir, runId, status: "running" });
  return await runProtocol(runDir, config, input);
}
```

**Analog — run-id validation + existing-run re-derivation, `runInvoke` cli.ts:148–168:**
```ts
if (!RUN_ID_RE.test(opts.run)) {
  process.stderr.write(`error: invalid --run id "${opts.run}"\n`);
  return 2;
}
runId = opts.run;
runDir = runDirFor(runId);
if (!existsSync(runDir)) {
  process.stderr.write(`error: run "${runId}" does not exist (no --run creates a new run)\n`);
  return 2;
}
const manifest = await readManifest(runDir); // re-derive state from disk (PROT-07)
```
`RUN_ID_RE` (cli.ts:30) is the tampering guard a `<run-id>` arg MUST be validated against.
`--last` resolution: enumerate `runs/` via `readdirSync` (already imported, cli.ts:2), `readManifest`
each, filter by a `RESUMABLE_STATUSES` set (Q7), pick most-recent by `updatedAt`.

**Analog — TTY-safe interactive prompt (none exists yet; build per Q2):** use
`node:readline/promises` behind an injectable `ask()` seam, guarded by `process.stdin.isTTY`. There
is NO existing prompt in the codebase — the closest convention is the test-only env seam
`numEnv("MAR_RETRY_BASE_MS")` (cli.ts:273–279) for injecting behavior hermetically. Mirror that
spirit: a small `ask: (q) => Promise<string>` seam so unit tests stub it; non-TTY + no `--mode` flag
→ default autonomous (never call `question()`).

**Deviations to watch:**
- Keep the controller thin: resume's re-validation (manifest parse + per-artifact schema +
  preflight) and the machine-rebuild belong in the engine, not cli.ts (mirror how `runRun` hands off
  to `runProtocol`). cli.ts should call ONE `resumeProtocol(runDir, config)`-style entry.
- D-53 non-TTY bypass is a hard requirement (Pitfall 5): a bare scripted `mar run` must not hang.
  Guard EVERY `question()` with `process.stdin.isTTY`.
- Flag names are Claude's discretion (`--mode`/`--gated`/`--autonomous`/`--pause-and-exit`); register
  them with `.option(...)` exactly like `--timeout`/`--run` (cli.ts:382–386).
- `mar invoke` is gate-exempt and does NOT auto-preflight (cli.ts:111–112) — `resume` is NOT exempt;
  it re-runs preflight (D-56) like `mar run` enforces `assertReviewable`.

---

## 2. `src/protocol/engine.ts` — gate hooks (phase-boundary pause/prompt) + resume entry (MODIFY)

**Role:** Engine/orchestration. Two changes: (a) a resume entry that rebuilds the machine with
`initial` set to the resume phase and `context.roster` rehydrated from the manifest (Q1); (b)
phase-boundary gate hooks (prompt/pause) for gated mode (D-50). Re-derivation only — NO XState
snapshot persistence (Pitfall 2).

**Analog — machine construction + `initial`, `buildMachine` engine.ts:607–615:**
```ts
return setup({
  types: {} as { context: ProtocolContext; input: ProtocolInput },
  actors: { phaseActor, promoteActor, convergenceActor },
}).createMachine({
  id: "protocol",
  initial: PHASES[0].name,
  context: ({ input }) => ({ input, roster: input.config.agents }),
  states: states as never,
});
```
This is the resume lever: the machine is built FRESH every run, `initial` is a phase NAME, and
`context.roster` is derived from input at construction. Resume = pass a resume-phase name to
`buildMachine`/`runProtocol` and rehydrate `roster` (survivors vs full per D-57). The per-phase
states are built programmatically from `PHASES` (engine.ts:499–582), so re-entering at any phase
name "just works" — `draft`'s `next` is `"promote"` (engine.ts:502), so resuming at `review` skips
promotion correctly (Pitfall 1).

**Analog — the run driver + terminal branch, `runProtocol` engine.ts:628–664:**
```ts
const machine = buildMachine();
const actor = createActor(machine, { input: { runDir, config, inputPath } });
actor.start();
await toPromise(actor);
const snapshot = actor.getSnapshot();
if (snapshot.value === "done") {
  // ...
  await writeDecisionRecord(runDir, snapshot.context.convergence);
  await setStatus(runDir, escalated ? "escalated" : "completed");
  return 0;
}
```
A `resumeProtocol` mirrors this exactly, differing only in `buildMachine(resumePhase)` and the
roster rehydration. State derives entirely from disk (`runProtocol` branches on `snapshot.value`, not
manifest status — engine.ts:638), so the pause path is orthogonal.

**Analog — per-phase `invoke` with onDone-guard array (the gate-hook insertion point), engine.ts:542–581:**
```ts
states[phase.name] = {
  invoke: {
    src: "phaseActor",
    input: ({ context }) => ({ phase, roster: context.roster, input: context.input, integrator: context.integrator }),
    onDone: [
      { guard: ({ event }) => "survivors" in event.output, target: next, actions: assign({ roster: ... }) },
      { target: "failed", actions: assign({ failure: ... }) },
    ],
    onError: { target: "failed", actions: assign({ failure: ... }) },
  },
};
```
Gate hooks (D-50): a phase-boundary prompt/pause inserts as either a transient state BETWEEN phases
(mirror the `promote` transient, engine.ts:586–602) or an extra guarded `onDone` branch that targets
a pause-final state. The `promote` transient is the cleanest model:
```ts
states.promote = {
  invoke: {
    src: "promoteActor",
    input: ({ context }) => ({ roster: context.roster, input: context.input }),
    onDone: { target: "review" },
    onError: { target: "failed", actions: assign({ failure: ... }) },
  },
};
states.done = { type: "final" };
states.failed = { type: "final" };
```
A `paused` final state joins `done`/`failed` (engine.ts:604–605); the pause-and-exit path writes
`paused-awaiting-approval` and returns from `runProtocol` like the failure branch
(engine.ts:655–663).

**Analog — the tolerant frontmatter reader to EXTRACT, `parseFront` engine.ts:198–206:**
```ts
const parseFront = (text: string): unknown => {
  const direct = matter(text).data;
  if (direct && Object.keys(direct).length > 0) return direct;
  const delim = text.match(/^---\s*$/m);
  if (delim?.index !== undefined && delim.index > 0) {
    return matter(text.slice(delim.index)).data;
  }
  return direct;
};
```
This is the canonical tolerant reader; resume re-validation must reuse it (see file #7).

**Deviations to watch:**
- Pitfall 1: resume entry is a phase NAME; do NOT re-run `promote` when resuming at `review`. Test
  asserts no new draft artifacts.
- Pitfall 2: never reach for `getPersistedSnapshot`/`createActor(..., {snapshot})` — mid-flight
  `fromPromise` actors don't restart (silent hang). D-14/D-54 already make re-derivation correct.
- D-57: roster source differs by reason — `paused`/interrupted `running` → survivors
  (`config.agents` minus `manifest.droppedAgents`); `failed`/`timeout` → FULL `config.agents`.
- Preserve the 04-05 live-checkpoint hardening (tolerant reader, YAML-errors-feed-retry at
  engine.ts:210–220, OUTPUT CHANNEL contract) through any refactor — carried-forward constraint.
- `expectedParticipantCount(phase, survivors)` (engine.ts:405) must recompute from the RESUMED
  roster, not the original-completed one (Pitfall 10).

---

## 3. `src/protocol/converge.ts` — majority tie-break before escalation (MODIFY)

**Role:** Pure logic + disk I/O. Insert a `clearMajority(signals, rosterSize)` check (`bestCount >
size/2`, D-59) BETWEEN cap/deadlock detection and `escalate(...)`, returning a result tagged
`resolver: "majority"`. The tally primitives already exist.

**Analog — existing tally primitives, converge.ts:118–136:**
```ts
function tallyBases(signals: RoundSignal[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const s of signals) tally.set(s.proposedBase, (tally.get(s.proposedBase) ?? 0) + 1);
  return tally;
}
function mostSupportedBase(signals: RoundSignal[]): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [base, count] of tallyBases(signals)) {
    if (count > bestCount) { best = base; bestCount = count; }
  }
  return best;
}
```
`clearMajority` mirrors `mostSupportedBase` but adds the `> size/2` test and returns `null` when no
base clears the threshold. Do NOT reuse `mostSupportedBase` for the tie-break — it returns the
plurality on a 1-1 tie (Pitfall 3), which would wrongly resolve D-60's escalate case.

**Analog — the exact escalate guards (insertion points), converge.ts:221–249:**
```ts
// Guard 2: cap reached (D-41c)
if (round === cap) {
  return escalate(signals, round, concessions, `convergence cap (${cap}) reached ...`);
}
// Guard 3: explicit unresolvable deadlock (D-41b)
// ... stableStuckRounds logic ...
if (stableStuckRounds >= UNRESOLVABLE_STABLE_ROUNDS) {
  return escalate(signals, round, concessions, `unresolvable disagreement: ...`);
}
```
Before each `escalate(...)`, compute `clearMajority(signals, roster.length)`; on a non-null base
return `{ base, integrator: integratorFor(base, signals), rounds: round, status: "agreed",
concessions, resolver: "majority" }`. The fallback path (`escalate`, converge.ts:275–297) keeps using
`mostSupportedBase` unchanged.

**Analog — the agreed return shape to extend, converge.ts:210–219:**
```ts
if (isAgreed(signals)) {
  const base = signals[0].proposedBase;
  return { base, integrator: integratorFor(base, signals), rounds: round, status: "agreed", concessions };
}
```
The unanimous-agreement return gains `resolver: "convergence"`; the majority return uses
`resolver: "majority"` (D-61).

**Deviations to watch:**
- `ConvergenceResult` (converge.ts:22–35) gains an optional `resolver` field — additive, like
  `openDecision`. Mirror the existing optional-field doc-comment style.
- D-59 anti-anchoring: the tally is computed ONLY at the exit boundary (post-cap/deadlock), NEVER
  injected into a round prompt. The loop already never injects it — preserve that.
- Open Q4: majority may fire at BOTH guards (early on deadlock, late on cap). Cost is not a
  constraint (D-43); planner decides, both are testable.
- 2-vendor 1-1: `clearMajority` returns null (1 is not > 1) → escalates, exactly D-60.

---

## 4. `src/workspace/manifest.ts` + `src/schema/manifest.ts` — `paused-awaiting-approval` status (MODIFY)

**Role:** Schema + disk I/O. Add the non-terminal status to the enum and let `setStatus` write it
(it already takes any `ManifestStatus`). Define `RESUMABLE_STATUSES` / `TERMINAL_DONE` sets in one
place (Q7) — terminal-vs-resumable is not enforced anywhere today, so this is the single source.

**Analog — the status enum, schema/manifest.ts:36–54:**
```ts
export const Manifest = z.object({
  runId: z.string(),
  status: z.enum(["created", "running", "completed", "failed", "timeout", "escalated"]),
  // ...
  droppedAgents: z.array(DroppedAgent).default([]),
  failureReason: z.string().optional(),
});
export type ManifestStatus = Manifest["status"];
```
Add `"paused-awaiting-approval"` to the enum array. The `escalated` doc-comment (schema/manifest.ts:39–40)
is the precedent for "additive status, prior manifests parse unchanged" — mirror it.

**Analog — `setStatus` (already generic over status), manifest.ts:119–135:**
```ts
export async function setStatus(runDir, status, failureReason?) {
  return serializeWrite(runDir, async () => {
    const current = await readManifest(runDir);
    const next: Manifest = {
      ...current, status, updatedAt: new Date().toISOString(),
      ...(failureReason !== undefined ? { failureReason } : {}),
    };
    await writeManifestAtomic(runDir, next);
    return next;
  });
}
```
No change needed to write the new status — `setStatus(runDir, "paused-awaiting-approval")` works as
is. The `serializeWrite` per-runDir chain (manifest.ts:33–49) is the read-modify-write idiom any new
mutator (e.g. the resolved-decisions append, file #6) must follow.

**Deviations to watch:**
- `paused-awaiting-approval` is NON-terminal. No code reads `manifest.status` to branch today
  (Pitfall 6) — the ONLY new reader is `mar resume`'s resumability filter. Define the
  `RESUMABLE_STATUSES` set (`running`, `failed`, `timeout`, `paused-awaiting-approval`) and
  `TERMINAL_DONE` (`completed`, `escalated`) once, near the schema, so the filter is testable.
- e2e tests assert `manifest.status` literals (protocol-run.e2e.test.ts:90) — adding an enum member
  does not break them; a gated-abort/pause test asserts the new literal.

---

## 5. `src/schema/resolved-decisions.ts` — NEW rolling-ledger schema (CREATE)

**Role:** Schema. New zod module mirroring `ResolvedDecision` plus the `resolver` field (D-61), for
the rolling `shared/resolved-decisions.md` artifact. Follow the established schema-module shape.

**Analog — full schema-module structure, schema/decision-record.ts:1–48:**
```ts
import { z } from "zod";

const LineageRef = z.string().min(1);

export const ResolvedDecision = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  lineage: z.array(LineageRef).default([]),
});
export type ResolvedDecision = z.infer<typeof ResolvedDecision>;
// ...
export const DecisionRecordFrontmatter = z.object({
  runId: z.string().min(1),
  resolvedDecisions: z.array(ResolvedDecision).default([]),
  // ...
});
export type DecisionRecordFrontmatter = z.infer<typeof DecisionRecordFrontmatter>;
```
Every schema module: `import { z } from "zod"` → small named building blocks → one exported object
schema → `export type X = z.infer<typeof X>`. Use `.min(1)` for required non-empty strings,
`.default([])` for additive arrays (so prior artifacts parse unchanged), rich doc-comments citing the
decision IDs.

**Analog — the `resolver` enum precedent (none yet — model on schema/manifest.ts status enum):**
add `resolver: z.enum(["convergence", "majority", "integrator", "human"])` to the resolved-decision
shape (D-61). Mirror the additive-enum doc-comment style from schema/manifest.ts:39–40.

**Analog — a minimal phase-frontmatter schema (for the artifact wrapper), schema/evaluation.ts:10–17:**
```ts
export const EvaluationFrontmatter = z.object({
  phase: z.literal("evaluation"),
  author: z.string().min(1),
  round: z.number().int().positive(),
  proposedBase: z.string().min(1),
  remainingDisagreements: z.array(z.string()),
  citations: z.array(z.string()).default([]),
});
```
If `resolved-decisions.md` carries a `phase`-like discriminator, use a `z.literal(...)` the way
evaluation does.

**Deviations to watch:**
- The schema is gray-matter-frontmatter for a SHARED peer artifact (D-63), not an agent turn — its
  frontmatter holds the machine-readable settled decisions; the body holds one-line rationales (the
  digest). Decide whether each `resolver` value is per-decision or whole-file.
- Keep it additive: a run with zero settled forks must still produce a parseable empty ledger
  (`resolvedDecisions: []`).

---

## 6. `src/protocol/resolved-decisions.ts` (NEW) + `src/protocol/decision-record.ts` resolver sourcing (MODIFY)

**Role:** Disk I/O + assembly. New module appends to the rolling `shared/resolved-decisions.md` as
forks settle (D-63) and enforces the re-litigation drop (D-64); decision-record.ts inverts to read
FROM the rolling file and to source the `resolver` field (D-61/D-63).

**Analog — injection-safe writer to REUSE, decision-record.ts:34–88:**
```ts
function yamlScalar(v: string | number): string {
  if (typeof v === "number") return String(v);
  const flattened = v.replace(/\r?\n/g, " ").replace(CONTROL_CHARS, "");
  return JSON.stringify(flattened);
}
function serializeFrontmatter(record: DecisionRecordFrontmatter): string {
  const lines: string[] = [];
  lines.push(`runId: ${yamlScalar(record.runId)}`);
  // ...block sequences with each scalar escaped...
  return `---\n${lines.join("\n")}\n---\n`;
}
```
gray-matter stays READ-only (T-04-07); the WRITE path is this hand-rolled, scalar-escaping serializer
— NEVER `matter.stringify`. The rolling-ledger writer reuses `yamlScalar` and the block-sequence
emit pattern verbatim (rationale strings are agent-authored prose — CR-01 injection risk).

**Analog — atomic temp-then-rename write, decision-record.ts:257–263:**
```ts
await ensureDir(runDir);
const finalPath = join(runDir, RECORD_FILE);
const tmpPath = `${finalPath}.tmp-${process.pid}`;
await writeFile(tmpPath, content, "utf8");
await rename(tmpPath, finalPath);
```
The rolling file is APPEND-as-forks-settle — read current, add the new entry, re-serialize, atomic
rename (decision-record assembles whole; the ledger rebuilds-and-replaces). Route appends through the
`serializeWrite(runDir, ...)` per-dir chain (manifest.ts:35–49) to avoid the concurrent-append race
(Pitfall 7) — or append only at sequential phase boundaries (the engine drives phases sequentially,
the safer option).

**Analog — the integrator drop to GENERALIZE for enforcement, decision-record.ts:179–209:**
```ts
for (const add of integration.additions) {
  const lineage = [`${art.path} addition ${add.additionRef}`, `base: ${integration.base}`];
  if (add.verdict === "merged") { unanimousTally += 1; }
  else if (add.verdict === "merged-with-change") { resolvedDecisions.push({ id: `integration-${add.additionRef}`, summary: ..., rationale: add.change, lineage }); }
  else { /* dropped — conflicts-with-resolved */ resolvedDecisions.push({ id: `integration-${add.additionRef}`, summary: `integrator dropped ${add.additionRef}`, rationale: add.reason, lineage }); }
}
```
This `dropped` / conflicts-with-resolved path is exactly what D-64's `re-litigation` drop generalizes:
when a later-phase artifact reopens a decision present in the ledger (matched by decision `id`), drop
that position with a `re-litigation` reason, continue the run, note the violation in the record.

**Analog — the agent-frontmatter reader (the STRICT one to replace), decision-record.ts:100–110:**
```ts
async function readAgentFrontmatter(path: string): Promise<unknown | null> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return null; }
  const outer = matter(raw);
  const inner = matter(outer.content.trimStart());
  return inner.data;
}
```
This strict double-parse silently drops a preamble-prefixed artifact the live gate accepts (Pitfall
4) — replace its call sites with the shared tolerant reader (file #7).

**Deviations to watch:**
- Open Q1: full inversion (terminal record reads ONLY the rolling file) vs additive (rolling file for
  in-run injection, terminal record still re-derives from the trail as a cross-check). Planner picks.
- Append triggers (D-63): response verdicts after the response phase; convergence concessions after
  the convergence actor resolves; integrator calls after integration; human rulings (D-52) when an
  escalation is arbitrated. The `resolver` value differs per trigger
  (`convergence`/`majority`/`integrator`/`human`).
- Concurrent-append race (Pitfall 7): use `serializeWrite` or sequential-boundary appends only.

---

## 7. `src/protocol/frontmatter.ts` — NEW shared tolerant frontmatter reader (CREATE/EXTRACT)

**Role:** Pure logic. Extract the tolerant `parseFront` (engine.ts:198–206) into ONE shared util and
replace the three near-duplicate STRICT double-parses (converge.ts:82–102,
decision-record.ts:100–110) so the gate, converge, decision-record, and the new resume path share
one reader — fixing the strict-vs-tolerant divergence (Pitfall 4, latent bug).

**Analog — the tolerant variant to LIFT, engine.ts:198–206** (excerpt in file #2 above) — first-`---`
fallback for preamble-prefixed artifacts.

**Analog — the strict double-parse callers to REPLACE:**
- `readEvaluationSignal`, converge.ts:82–102 (`matter(file)` → `matter(outer.content.trimStart())`).
- `readAgentFrontmatter`, decision-record.ts:100–110 (same double-parse).

Both read the AGENT frontmatter (after the engine-metadata wrapper); the shared util must do the
double-strip (`matter(raw)` → strip wrapper) AND the tolerant first-`---` fallback on the inner body.

**Deviations to watch:**
- The on-disk `.md` has the engine-metadata wrapper FIRST; the agent frontmatter SECOND. The shared
  reader must strip the wrapper then tolerantly parse the inner — do not skip the `.trimStart()`
  (gray-matter only recognizes frontmatter at position 0, converge.ts:89–94).
- Resume re-validation must use this tolerant reader, not the strict one, or it wrongly refuses valid
  runs written by live models with preamble (Pitfall 4).
- Keep schema validation strict (fail-closed, D-38) — leniency applies ONLY to WHERE frontmatter is
  found, never to its shape (engine.ts:196–197 comment).

---

## 8. `package.json` — dist `.tmpl` build fix + `files` (MODIFY)

**Role:** Build config. `tsc` (build script) emits no non-TS assets, so
`dist/templates/agent-instructions.md.tmpl` is missing and the built `mar` ENOENTs at draft fan-out
(Q6a). Add a copy step + ship dist in the tarball.

**Analog — current scripts, package.json:12–18:**
```json
"scripts": {
  "test": "vitest run",
  "dev": "tsx src/cli.ts",
  "build": "tsc",
  "lint": "biome check .",
  "format": "biome format --write ."
},
```
Change `build` to copy templates after compile. Portable form (Q6a):
`"build": "tsc && node -e \"require('fs').cpSync('src/templates','dist/templates',{recursive:true})\""`.
Add `"files": ["dist"]` so the `.tmpl` ships (package.json has `bin` at :9–11 but no `files`).

**Analog — the resolver that ENOENTs, instructions.ts:22 + 43:**
```ts
const TEMPLATE_URL = new URL("../templates/agent-instructions.md.tmpl", import.meta.url);
// ...
const template = await readFile(fileURLToPath(TEMPLATE_URL), "utf8");
```
From compiled `dist/protocol/instructions.js` this resolves to `dist/templates/...` — the copy step
is what makes it exist.

**Deviations to watch:**
- Pitfall 9: `npm run dev` (tsx from source) always finds the template; only the built binary
  breaks. Add a guard test that runs `npm run build` then asserts
  `dist/templates/agent-instructions.md.tmpl` exists (file #11).
- Rejected alternatives (do not take): embedding the template as a TS string, or a bundler.

---

## 9. `src/templates/agent-instructions.md.tmpl` — strengthen "ignore ancestors" + ledger read (MODIFY)

**Role:** Template/contract. Strengthen the "ignore ancestor instructions" directive and add a
"read `shared/resolved-decisions.md` before proposing changes" directive (Q5/Q6b). No `--bare` is
added (auth-break is real, leakage measured zero live).

**Analog — the existing ancestor-ignore directive, agent-instructions.md.tmpl:15–17:**
```
Ignore any other instruction files you may discover from ancestor directories (e.g. a
project's own workflow/GSD directives). THIS file's format contract is the only
instruction set in effect for the review protocol.
```
Strengthen toward the Q6b wording: "Read CLAUDE.md/AGENTS.md/GEMINI.md in this folder as your sole
format contract; ignore any ancestor or global instructions."

**Analog — section structure to mirror for the new ledger directive, agent-instructions.md.tmpl:19–32**
(the `## OUTPUT CHANNEL — read this first` section). Add a parallel `## RESOLVED DECISIONS — do not
re-litigate` section directing agents to read `shared/resolved-decisions.md` and not reopen settled
forks (D-62/D-63/D-65 digest-as-peer-artifact model — keeps per-turn prompts thin, D-37).

**Deviations to watch:**
- The seeded file is currently copied into the SCOPED draft cwd only (scope.ts:53–67); later phases
  run non-scoped in the run dir (engine.ts:119–122). Per Q5 option (b), rely on
  `shared/resolved-decisions.md` living in the shared workspace every non-scoped phase reaches —
  cleaner than re-seeding the instruction file everywhere.
- Q6b: also fix the now-stale scope.ts:46–51 / instructions.ts:32–40 comments that claim `--bare` is
  the neutralization mechanism (the claude adapter, claude.ts:14–24, deliberately omits it).

---

## 10. `src/adapters/claude.ts` — `--bare` decision pin (NO functional change; comment + test target)

**Role:** Adapter. Q6b keeps `--bare` OMITTED. The flag-pinning test (file #11) asserts the exact
argv so a future drift fails loudly.

**Analog — the pinned argv builder, claude.ts:20–24:**
```ts
function buildArgv(promptText: string, model?: string): string[] {
  const a = ["-p", promptText, "--output-format", "json"];
  if (model) a.push("--model", model);
  return a;
}
```
The doc-comment at claude.ts:12–19 already explains WHY the config-isolation flag is omitted — this
is the documented decision Q6b reaffirms. No code change; a test pins it.

**Deviations to watch:** do NOT add `--bare` (breaks subscription auth). The only change is
strengthening the seeded template (file #9) + fixing the stale scope.ts/instructions.ts comments.

---

## 11. Test files + fixture extensions (CREATE/MODIFY)

**Role:** Test/fixture. Hermetic vitest on fake-CLI fixtures (D-49). New tests for each requirement;
small fixture extensions noted per feature.

**Analog — e2e harness driving `mar` via execa, protocol-run.e2e.test.ts:50–98:**
```ts
const result = await execa("npx", ["tsx", cliEntry, "run", inputPath], {
  cwd: workdir,
  reject: false,
  env: { ...process.env, MAR_EMIT_BASE: "claude" },
});
expect(result.exitCode).toBe(0);
// ...readManifest, assert manifest.status, count artifacts per phase kind...
```
This is the template for the resume e2e (drive to phase N, truncate later artifacts + set status,
`mar resume <id>`, assert completion + seq monotonicity), the non-TTY autonomous test (pass
`stdin: "ignore"`, no mode flag → completes without prompting, Pitfall 5), and the gated tests (feed
the `ask()` seam stub).

**Analog — convergence loop unit test over hermetic fixtures, converge.test.ts:1–70:**
```ts
beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), "mar-converge-"));
  runDir = join(workdir, "runs", "20260605-converge");
  await createRun({ runDir, runId: "20260605-converge", status: "running" });
});
// writeEvalFixture(dir, author, vendor, proposedBase, disagreements) → per-author stance
const result = await runConvergence(roster, input);
```
The RSLV-02 majority tests reuse `writeEvalFixture` with DIVERGENT per-author `proposedBase`: a
2-1 split at cap/deadlock → assert `resolver: "majority"` on the 2-base; 1-1-1 → escalate; 2-vendor
1-1 → escalate with `openDecision` (Pitfall 3 / D-60).

**Analog — fixture per-author base steering to EXTEND, structured-shared.mjs:33–36:**
```ts
export function proposedBase(author) {
  return process.env.MAR_EMIT_BASE || author;
}
```
Today `MAR_EMIT_BASE` forces ONE shared base. RSLV-02 needs PER-AUTHOR steering (the one real fixture
change): add `MAR_EMIT_BASE_<author>` or a JSON env (`MAR_EMIT_BASES='{"claude":"claude",...}'`,
Open Q3) so each fixture can emit a DIFFERENT base. `flagValue` / `phaseFromArgs`
(structured-shared.mjs:14–26) are the existing argv-parsing helpers to mirror for any new fixture
flag (e.g. a re-litigation emit mode, a "did I read the ledger" echo mode for RCRD-02).

**Analog — failed-then-succeed fixture toggle (none exists; Q5/PROT-06):** D-57's failed-run resume
needs a fixture that fails on the first run and succeeds on resume. Closest existing pattern is the
env-driven mode steering above (`MAR_EMIT_BASE`, `--emit-malformed`) — add a `MAR_FAIL_ONCE` env or a
marker-file the test creates between runs (mirror the `process.env` checks in
structured-shared.mjs:34).

**Analog — the thin-prompt assertion to extend (D-65/D-37), protocol-gate.test.ts:47** (referenced in
RESEARCH): assert per-turn prompts still carry no decision content after the ledger is added.

**Deviations to watch:**
- Tests assert artifact COUNTS per phase kind (protocol-run.e2e.test.ts:94–98) and `manifest.status`
  literals (:90) — resume/majority/gating tests follow the same assertion style.
- `PHASE_KINDS` (protocol-run.e2e.test.ts:38) uses the per-round `evaluation-r1` kind — majority
  tests that drive multiple rounds expect `evaluation-r1`, `evaluation-r2`, ... kinds (Pitfall 3
  per-round kind disambiguation, converge.ts:56–58).
- Carry-over tests: a `npm run build` + dist-`.tmpl`-exists guard (Pitfall 9); a claude argv
  flag-pinning assertion confirming `--bare` is still omitted (mirrors the existing
  claude-adapter.test.ts flag-pinning test).

---

## Cross-cutting reuse summary

| Need | Reuse (file:lines) |
|------|--------------------|
| New CLI subcommand + handler | cli.ts:370–414 (registration), :326–368 (handler) |
| Run-id validation / re-derive | cli.ts:30 (`RUN_ID_RE`), :148–168 |
| Machine rebuild with `initial`=phase | engine.ts:607–615; driver :628–664 |
| Transient phase-boundary state (gate model) | engine.ts:586–602 (`promote`) |
| Tolerant frontmatter reader (extract) | engine.ts:198–206 |
| Strict readers to replace | converge.ts:82–102; decision-record.ts:100–110 |
| Tally primitives (add `clearMajority`) | converge.ts:118–136 |
| Escalate insertion points | converge.ts:221–249 |
| Status enum (add `paused-awaiting-approval`) | schema/manifest.ts:36–54 |
| `setStatus` (already generic) | manifest.ts:119–135 |
| Per-runDir serialized write chain | manifest.ts:33–49 |
| zod schema-module shape | schema/decision-record.ts:1–48; schema/evaluation.ts:10–17 |
| Injection-safe YAML writer (reuse) | decision-record.ts:34–88 |
| Atomic temp-then-rename write | decision-record.ts:257–263; manifest.ts:88–95 |
| Integrator drop to generalize (re-litigation) | decision-record.ts:179–209 |
| Template ancestor-ignore directive | agent-instructions.md.tmpl:15–17, :19–32 |
| Build/`tsc` script | package.json:12–18 |
| Pinned argv (`--bare` omitted) | claude.ts:20–24, :12–19 |
| e2e execa harness | protocol-run.e2e.test.ts:50–98 |
| Convergence unit-test harness | converge.test.ts:1–70 |
| Per-author base fixture steering | structured-shared.mjs:33–36; argv helpers :14–26 |

## PATTERN MAPPING COMPLETE

Mapped 11 Phase-5 target files (CLI resume+mode, engine resume/gate hooks, converge majority,
manifest paused status, new resolved-decisions schema+module, decision-record resolver sourcing,
shared frontmatter reader, package.json dist fix, template hardening, claude `--bare` pin, tests +
fixture extensions) to live analogs with file:line excerpts and per-file deviation notes;
05-PATTERNS.md written, no other files modified.
