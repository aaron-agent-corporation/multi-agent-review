# multi-agent-review (`mar`)

Vendor-neutral orchestration of frontier-model CLIs through a structured adversarial
review protocol. Differently-trained models catch each other's blind spots — `mar`
runs Claude Code, Codex CLI, and Gemini CLI (extensible to more) through a 6-phase
review of any document, preserving genuine independence between agents while
eliminating the human copy-paste relay.

## The protocol

```
draft → cross-review → response → evaluation (convergence) → integration → validation
```

1. **Draft** — every agent drafts independently in a scoped workspace. No agent can
   see a peer's draft before the boundary (enforced on disk, not by convention).
2. **Cross-review** — drafts are promoted; each agent reviews its peers' work and
   raises numbered, severity-tagged issues.
3. **Response** — authors answer the issues raised against their drafts: accept,
   rebut, or concede.
4. **Evaluation** — a bounded convergence loop where agents propose which draft
   should be the base. Unanimity or a clear majority resolves it; a deadlock
   escalates (in interactive gated mode, to a human ruling).
5. **Integration** — the designated integrator merges the accepted material into one
   document.
6. **Validation** — every agent verifies the integrated result.

Every run produces an auditable artifact trail in `runs/<id>/` — per-phase markdown
artifacts with structured frontmatter, a manifest, a re-litigation-guarded decision
ledger, and a final decision record (resolved decisions, open decisions, run chain).

Design invariants worth knowing:

- **≥2 distinct vendors, no override.** A model reviewing itself shares its own
  blind spots, so single-vendor runs are refused.
- **Filesystem as the message bus.** Turn-based and artifact-based by design — no
  real-time agent chat, no message broker, no MCP coordination.
- **Coordination lives outside every vendor's runtime.** `mar` drives the CLIs you
  already have installed and authenticated (`claude`, `codex`, `gemini`); it never
  calls vendor APIs.
- **Resumable by re-derivation.** Interrupted, failed, and gate-paused runs resume
  from the on-disk trail (never a serialized state snapshot), with integrity
  re-validation before continuing.

## Install

Requires Node 22+ and at least two authenticated vendor CLIs on your PATH.

```sh
git clone https://github.com/The-Agent-Corporation/multi-agent-review
cd multi-agent-review
npm install
npm run build
npm link        # puts `mar` on your PATH
```

## Quickstart

```sh
mar init        # detect installed vendor CLIs, write a starter mar.config.json
mar preflight   # check each roster agent is installed, authenticated, responsive
mar run document.md --gated      # run the protocol, pausing at each phase gate
mar run document.md --autonomous # run unattended end to end
```

In gated mode each phase boundary prompts: `approve` to continue, `feedback <note>`
to steer the next phase (recorded with attribution in `gate-feedback/`), or `abort`.

### Non-interactive gating (for scripts and agent drivers)

```sh
mar run document.md --gated --pause-and-exit  # run to the first gate, then exit 0
mar resume --last --step                      # approve: run one more phase, pause again
mar resume --last --step --feedback "tighten section 3"  # approve with steering
mar resume --last --abort                     # end the paused run
mar resume <run-id>                           # resume to completion (no more pauses)
```

One `--step` normally runs one phase; the evaluation step carries through
integration in the same step (the convergence result must reach the integrator
in-process). A run whose convergence deadlocks ends with terminal status
`escalated` — it still produces a merged fallback document plus the open decision
in the decision record for a human to settle.

## Claude Code plugin

This repo is also a Claude Code plugin marketplace. Install:

```
claude plugin marketplace add The-Agent-Corporation/multi-agent-review
claude plugin install mar@multi-agent-review
```

Then, in any project, `/mar-review <document>` has Claude drive the whole loop:
preflight the roster, launch a gated run in the background, summarize each phase's
artifacts at every gate, relay your approve/feedback/abort decision, and deliver the
integrated document and decision-record digest at the end. The plugin is a thin
driver — all protocol logic stays in the `mar` CLI, so the coordination layer remains
vendor-neutral.

## Development

```sh
npm test        # vitest — hermetic; vendor CLIs are faked via fixtures
npm run dev     # run the CLI from source (tsx)
npm run lint    # biome
```

The protocol engine is an XState v5 statechart (`src/protocol/engine.ts`); per-vendor
adapters live in `src/adapters/`; artifact schemas (zod) in `src/schema/`. Vendor CLI
flag surfaces drift between minor versions — the adapter behavior is pinned by tests.

## License

MIT
