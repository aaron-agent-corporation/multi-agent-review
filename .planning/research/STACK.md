# Stack Research

**Domain:** Vendor-neutral multi-agent CLI orchestration (coordinating heterogeneous frontier-model CLIs via headless invocation + filesystem artifact exchange)
**Researched:** 2026-06-04
**Confidence:** HIGH on CLI invocation flags and language choice; MEDIUM on long-term CLI stability (vendor churn is real — see Gemini→Antigravity below).

## Executive Recommendation

**Build the orchestrator in TypeScript/Node (Node 22 LTS, ESM), using `execa` for subprocess control and `XState v5` for the phase/state machine. Do NOT use a shell-only implementation, and do NOT use vendor SDKs/APIs.**

Rationale in one paragraph: This system's hard problems are (1) spawning long-running, heterogeneous child processes and capturing structured (JSON) output reliably, (2) encoding a strict turn-based 6-phase state machine with gates, and (3) keeping per-vendor invocation quirks behind a stable adapter interface because **the CLIs themselves are changing fast** (Codex was rewritten in Rust; Gemini CLI is being folded into Antigravity CLI with a June 18, 2026 cutoff for free tiers). A typed adapter layer is not optional — it is the core architectural asset. Node + execa + XState is the most mature, best-documented combination for "spawn processes, parse JSON, run a statechart" in mid-2026. Python is a credible alternative (and is what the closest prior art, AWS `cli-agent-orchestrator`, uses) but offers no decisive advantage here and weaker subprocess ergonomics than execa.

## Verified CLI Headless Invocation Reference

This is the load-bearing research. All three installed CLIs support non-interactive invocation with JSON output, but the flags differ and are evolving. Confidence: HIGH (verified against official docs, June 2026).

### Claude Code (installed: 2.1.162)

| Need | Flag / Pattern | Notes |
|------|----------------|-------|
| Non-interactive run | `claude -p "<prompt>"` (alias `--print`) | Reads stdin too; pipe data in, redirect out. Stdin capped at 10MB since v2.1.128. |
| Structured output | `--output-format json` | Returns `{ result, session_id, total_cost_usd, ... }`; text in `.result`. |
| Schema-constrained output | `--output-format json --json-schema '<schema>'` | Structured payload lands in `.structured_output`. **Best fit for machine-parseable review documents.** |
| Streaming events | `--output-format stream-json --verbose --include-partial-messages` | NDJSON event stream; emits `system/init`, `system/api_retry`, etc. |
| Resume conversation | `--resume <session_id>` or `--continue` | Capture `session_id` from JSON output to resume a specific thread. |
| Auto-approve tools | `--allowedTools "Read,Edit,Bash(git diff *)"` | Permission-rule syntax; trailing ` *` = prefix match. |
| Locked-down baseline | `--permission-mode dontAsk` / `acceptEdits` | `dontAsk` = CI-safe deny-by-default. |
| Reproducible CI runs | `--bare` | Skips hooks/skills/plugins/MCP/CLAUDE.md auto-discovery. **Recommended for the orchestrator** so a teammate's `~/.claude` config can't perturb a review run. Will become the `-p` default in a future release. |
| Inject role/persona | `--append-system-prompt "You are reviewer B..."` or `--append-system-prompt-file` | How you assign per-agent reviewer roles. |
| Pass MCP/agents/settings | `--mcp-config`, `--agents`, `--settings`, `--plugin-dir` | Needed under `--bare` since auto-discovery is off. |

**Billing note (important for roadmap):** Starting **June 15, 2026**, `claude -p` / Agent SDK usage on subscription plans draws from a separate monthly Agent SDK credit pool, distinct from interactive limits. Budget assumptions in PROJECT.md ("existing subscriptions cover usage") should be re-validated against this.

### Codex CLI (installed: 0.128.0, Rust rebuild on GPT-5.5)

| Need | Flag / Pattern | Notes |
|------|----------------|-------|
| Non-interactive run | `codex exec "<prompt>"` (alias `codex e`) | Streams progress to **stderr**, prints only final agent message to **stdout**. |
| JSON event stream | `codex exec --json` | NDJSON, one event per state change. Parse stdout line-by-line. |
| Schema-constrained output | `--output-schema <path>` | Model returns final message conforming to provided JSON Schema. Pairs with Claude's `--json-schema` for cross-vendor structured reviews. |
| Final message to file | `-o <path>` / `--output-last-message <path>` | Writes final message to file while still printing to stdout. Convenient for the artifact-per-turn convention. |
| stdin as context | `cmd \| codex exec "instruction"` | Pipe builds context. |
| stdin as full prompt | `cmd \| codex exec -` | Trailing `-` = stdin is the entire prompt. |
| Allow file edits | `--sandbox workspace-write` | Default is read-only; integrator phase needs write. |
| Full auto / CI | `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`) | Use only inside an isolated runner. |
| Resume | `codex exec resume <SESSION_ID>` or `--last` | |
| No session files | `--ephemeral` | Don't persist rollout files. |
| Skip git requirement | `--skip-git-repo-check` | Codex normally requires a git repo. |
| Ignore user config | `--ignore-user-config` | Reproducibility analog to Claude's `--bare`. |

**stderr/stdout split is the key adapter detail:** unlike Claude, Codex puts progress on stderr and the answer on stdout. The adapter must capture streams separately (execa makes this trivial).

### Gemini CLI (installed: 0.45.0) — VENDOR-CHURN RISK

| Need | Flag / Pattern | Notes |
|------|----------------|-------|
| Non-interactive run | `gemini -p "<prompt>"` (alias `--prompt`) | Also reads piped stdin: `echo "..." \| gemini`. |
| Structured output | `--output-format json` | Returns `{ response, stats, error? }`. `error` present only on failure (has `type`, `message`, optional `code`). |
| Auto-approve all | `--yolo` / `-y` | |
| Approval mode | `--approval-mode auto_edit` | Granular alternative to YOLO. |
| Context loading | `--all-files`/`-a`, `--include-directories` | |
| Model select | `--model`/`-m` | |

**CRITICAL FINDING (Confidence: HIGH):** Google announced (May 12–20, 2026) that **Gemini CLI is being transitioned to Antigravity CLI** (Go-based, async multi-agent, not yet open source). The cutoff: **June 18, 2026**, Gemini CLI stops serving requests for free Google AI Pro/Ultra and free Code Assist tiers. Access **remains** for paid Gemini Enterprise / Gemini Code Assist Standard/Enterprise / paid API keys, and the Apache-2.0 repo stays community-maintained for bug/security/model updates. Antigravity CLI keeps the critical features (skills, hooks, subagents, extensions-as-plugins) but **no day-one 1:1 parity**.

Implication for this project: the third agent's transport is the least stable. The orchestrator MUST treat each CLI as a swappable adapter (Gemini today, Antigravity CLI tomorrow, Grok later). Verify which Gemini tier the user is on before relying on free-tier Gemini CLI past June 18, 2026.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS | Runtime | Current LTS through 2026; native ESM, stable `node:child_process`, top-tier async ergonomics for stream handling. The orchestrator is I/O-bound (waiting on subprocesses), Node's exact strength. |
| TypeScript | 5.6+ | Language | Types are the architectural enforcement mechanism — the per-vendor adapter interface, phase enums, artifact schemas, and decision-record shapes all benefit from compile-time contracts. Required for XState v5 type inference (needs TS ≥5.0). |
| execa | 9.6.x | Subprocess execution | Purpose-built wrapper over `child_process`: separate stdout/stderr capture, streaming, timeouts, no-shell-injection, graceful kill, cross-platform. Directly solves the Codex stderr/stdout split and per-CLI process lifecycle. Far better DX than raw `spawn`. |
| XState | 5.x | Phase/state machine | The 6-phase protocol (draft → cross-review → respond → evaluate → integrate → validate) IS a statechart with gates, parallel states (N agents drafting concurrently), and guards (phase gates, human-approval pauses). XState v5's actor model maps cleanly: each agent invocation is an actor; the orchestrator is the parent machine. Zero-dependency, MIT, TS-native. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 3.23+ | Runtime schema validation | Validate JSON coming back from each CLI (Claude `.result`/`.structured_output`, Codex NDJSON events, Gemini `.response`) and validate review-document / decision-record artifacts. Pairs with TS types via `z.infer`. **Strongly recommended** — heterogeneous CLI output is the #1 source of runtime breakage. |
| zod-to-json-schema | latest | Generate JSON Schema from zod | Single source of truth: define the review-artifact schema once in zod, emit JSON Schema to feed Claude `--json-schema` and Codex `--output-schema`. Keeps all three vendors aligned. |
| commander | 12.x | CLI argument parsing | The orchestrator is itself a CLI (per PROJECT.md "CLI/filesystem-first for v1"). Mature, typed. (`yargs` is the alternative.) |
| pino | 9.x | Structured logging | Per-turn, per-agent structured logs for the artifact lineage / audit trail the case study requires. NDJSON logs align with the artifact-on-filesystem philosophy. |
| gray-matter | 4.x | Markdown + frontmatter parsing | Review artifacts are markdown with structured headers (issue number, severity, accept/reject). Frontmatter carries machine-readable metadata (phase, author, turn) on human-readable docs. |
| p-queue / p-limit | latest | Concurrency control | Phase 1 (independent drafting) and Phase 2 (cross-review) run N agents in parallel; bound concurrency and handle per-agent failure without stalling the phase. |
| fs-extra | 11.x | Filesystem operations | Atomic writes, ensureDir for the per-run workspace, copy for artifact promotion. Avoids half-written artifacts on crash. |
| nanoid | 5.x | Run/turn IDs | Stable, URL-safe IDs for run directories and artifact naming. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsx | Run TS directly without a build step | Fast iteration during development; `tsx src/cli.ts`. |
| vitest | Test runner | Native ESM/TS, fast. Mock the adapter layer to test the state machine without burning API credits. |
| @stately/inspect (Stately Inspector) | Visualize/debug the XState machine | Renders the phase statechart live — invaluable for verifying turn-taking and gate logic. |
| biome | Lint + format | Single fast tool (Rust-based) replacing ESLint+Prettier. |

## Installation

```bash
# Core
npm install execa xstate zod zod-to-json-schema commander pino gray-matter p-queue fs-extra nanoid

# Dev dependencies
npm install -D typescript tsx vitest @biomejs/biome @types/node @types/fs-extra

# Requires (NOT installed by this project — must pre-exist and be authenticated):
#   claude (Claude Code 2.1.x), codex (Codex CLI 0.12.x+), gemini (Gemini CLI 0.45.x)
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| TypeScript/Node | **Python 3.12 + `asyncio.subprocess` / `anyio`** | If the team is Python-first, OR if you want to align with prior art: AWS `cli-agent-orchestrator` (the closest existing system) is 92.7% Python. Python has strong subprocess support and `transitions`/`python-statemachine` for FSMs, but no equivalent to execa's polished stream ergonomics and weaker static typing for the adapter contract. Viable, not superior. |
| TypeScript/Node | **Go** | If you later need a single static binary with no runtime dependency (relevant since Antigravity CLI itself is Go). Heavier upfront for a v1 whose bottleneck is subprocess I/O, not raw perf. |
| execa | `node:child_process` (raw) | Only if you want zero dependencies. You'll reimplement stream capture, kill semantics, and timeouts — execa exists precisely to avoid this. |
| XState v5 | `transitions` (Python) / hand-rolled switch | A hand-rolled FSM works for a single linear 6-phase flow, but breaks down once you add parallel drafting, debate sub-loops, human-gate pauses, and resumability. XState's statecharts model all of these and persist/restore state for pause/resume (maps to your `/gsd:pause-work` workflow). |
| zod | `ajv` / manual parsing | ajv is faster for huge schemas but zod's TS inference + `zod-to-json-schema` round-trip (feed schemas to the CLIs) is the decisive integration win here. |
| Custom build | **Fork/adopt AWS `cli-agent-orchestrator` (CAO)** | If you want a head start: CAO already runs Claude/Codex/Gemini in isolated tmux sessions, coordinates via MCP supervisor-worker, localhost HTTP. BUT its model is real-time MCP message-passing, which **contradicts this project's explicit design** (turn-based, artifact-based, no real-time agent chat — see PROJECT.md Out of Scope). Study it for the adapter/process-isolation layer; don't adopt its coordination model. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Vendor SDKs / direct APIs** (Anthropic SDK, OpenAI SDK, Gemini API) | Explicitly out of scope (PROJECT.md): v1 coordinates the user's already-authenticated CLIs. Going to APIs means re-solving auth/billing per vendor and abandons vendor-neutrality-by-CLI. | `claude -p`, `codex exec`, `gemini -p` via execa adapters. |
| **Claude Agent SDK as orchestrator core** | It's an Anthropic runtime — putting coordination logic inside it violates the "coordination layer cannot live inside any one vendor's runtime" constraint. | A vendor-neutral Node orchestrator that shells out to all CLIs equally. |
| **Pure shell / bash orchestrator** | Tempting for "just spawn CLIs," but the protocol needs: typed artifact schemas, JSON parsing across 3 different output shapes, a resumable state machine, parallel-with-failure-handling, and a decision record. Bash makes all of these fragile and untestable. Shell is fine for thin per-CLI wrapper scripts, not the orchestrator. | Node + execa + XState (use shell only inside adapters if needed). |
| **Real-time message bus** (Redis pub/sub, WebSocket agent chat) | PROJECT.md: "Real-time agent-to-agent chat — out of scope; protocol is turn-based and artifact-based by design." A bus adds infra for a problem the filesystem already solves. | Filesystem as the message bus: artifact-per-turn in a per-run workspace dir. |
| **MCP as the coordination transport** (the CAO model) | MCP couples agents into a live conversation; this project wants strict independence and turn isolation (no anchoring before cross-review). | Filesystem artifacts + orchestrator-enforced phase gates. |
| **Hard dependency on free-tier Gemini CLI post-June-18-2026** | Free Google AI Pro/Ultra tiers lose Gemini CLI access; the surface is moving to Antigravity CLI. | Keep Gemini behind a swappable adapter; plan an Antigravity CLI adapter; confirm the user's tier. |
| **CommonJS** | execa 9 and XState 5 are ESM-first; the modern Node ecosystem has largely migrated. | ESM (`"type": "module"`), Node 22. |

## Stack Patterns by Variant

**If the team prefers Python (or wants to align with AWS CAO prior art):**
- Use Python 3.12 + `asyncio.subprocess` + `python-statemachine` (or `transitions`) + `pydantic` v2 (the zod analog).
- Because: equivalent capability, larger overlap with the only mature multi-CLI prior art. Cost: weaker subprocess DX, weaker compile-time adapter contracts.

**If a single distributable binary becomes a requirement:**
- Use Go, mirroring Antigravity CLI's own choice.
- Because: static binary, no runtime install. Cost: more boilerplate for a v1 whose value is protocol logic, not perf.

**If adding a 4th/5th vendor (Grok, Antigravity CLI):**
- No core change — implement a new adapter conforming to the `CLIAdapter` interface (`invoke(prompt, opts) → { stdout, stderr, json, sessionId }`). This is the entire point of the typed adapter layer.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| xstate@5 | typescript@>=5.0 | v5 type inference requires TS 5.0+. |
| execa@9 | node@>=18.19 / 20+ | Node 22 LTS recommended; execa 9 is ESM with CJS interop. |
| zod@3 + zod-to-json-schema | Claude `--json-schema`, Codex `--output-schema` | Generated JSON Schema must use a dialect both CLIs accept (Draft 2020-12 is safe). Validate output empirically per CLI. |
| All adapters | claude 2.1.x / codex 0.12.x+ / gemini 0.45.x | Flag surface verified June 2026; **pin behavior in adapter tests** because CLI flags drift between minor versions (Codex's flag set changed notably across 0.12x). |

## Open Questions / Flags for Roadmap

1. **JSON Schema dialect parity** — Confirm empirically that the same zod-generated schema is honored by both `claude --json-schema` and `codex --output-schema` (and how Gemini handles structured output; its docs show `--output-format json` but schema-constraint support is less documented). MEDIUM confidence; needs a spike.
2. **Claude `-p` billing change (June 15, 2026)** — separate Agent SDK credit pool. Re-validate the "subscriptions cover usage" assumption.
3. **Gemini → Antigravity CLI (June 18, 2026)** — verify user's tier; scope an Antigravity CLI adapter as near-term follow-on.
4. **Session resume vs. fresh-context per turn** — Each CLI supports resume (`--resume`, `codex exec resume`), but the protocol's independence requirement may favor fresh contexts per turn with explicit artifact reads instead. Architecture-level decision, not a stack one — flagged for ARCHITECTURE.md.

## Sources

- https://code.claude.com/docs/en/headless — Claude Code `-p`, `--output-format json/stream-json`, `--json-schema`, `--bare`, `--resume`, `--allowedTools`, billing note (June 15, 2026). HIGH.
- https://developers.openai.com/codex/noninteractive — `codex exec`, `--json`, `--output-schema`, `-o`, stdout/stderr split, resume, `--ephemeral`. HIGH.
- https://developers.openai.com/codex/cli/reference — Codex CLI flag reference. HIGH.
- https://google-gemini.github.io/gemini-cli/docs/cli/headless.html — Gemini `-p`, `--output-format json`, `--yolo`, `--approval-mode`, JSON response shape. HIGH.
- https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/ — Gemini CLI → Antigravity CLI transition, June 18, 2026 cutoff, paid-tier continuity. HIGH.
- https://github.com/awslabs/cli-agent-orchestrator — Closest prior art: Python, tmux isolation, MCP supervisor-worker (coordination model differs from this project). HIGH on facts.
- https://github.com/bradAGI/awesome-cli-coding-agents and https://github.com/andyrewlee/awesome-agent-orchestrators — Ecosystem survey of CLI orchestrators / "agentmaxxing" pattern. MEDIUM (curated lists).
- https://www.npmjs.com/package/execa — execa 9.6.x, stdout/stderr handling, ESM+CJS. HIGH.
- https://stately.ai/docs/xstate + https://www.npmjs.com/package/xstate — XState v5 actor model, TS ≥5.0 requirement. HIGH.

---
*Stack research for: vendor-neutral multi-agent CLI orchestration*
*Researched: 2026-06-04*
