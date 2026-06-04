# Phase 2: Adapter Layer + Roster + Pre-flight - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 2-Adapter Layer + Roster + Pre-flight
**Areas discussed:** Roster config design, Retry policy, Pre-flight check depth, Multi-vendor failure UX

---

## Roster config design

| Option | Description | Selected |
|--------|-------------|----------|
| mar.config.json at root | Single JSON at project root, zod-validated | ✓ |
| .mar/roster.json | Dot-directory indirection | |
| YAML | Human-friendly but adds dependency | |

| Option | Description | Selected |
|--------|-------------|----------|
| Structured fields | { name, vendor, bin?, model?, timeoutMs?, extraArgs? } + defaults block | ✓ |
| Free-form command template | Full command string per entry (injection risk) | |
| Hybrid | Structured + argv-array escape hatch | |

| Option | Description | Selected |
|--------|-------------|----------|
| Roster names only | --agent = roster entry name; missing roster errors | ✓ |
| Names + bare vendor fallback | Two resolution paths | |

| Option | Description | Selected |
|--------|-------------|----------|
| Error + example only | Smallest scope | |
| Ship mar init | PATH-probing scaffolder | ✓ |

**Notes:** User chose `mar init` over the recommended minimal option — onboarding convenience valued.

## Retry policy

| Option | Description | Selected |
|--------|-------------|----------|
| Transient only | Timeouts, rate limits, JSON flukes; never auth | ✓ |
| Everything except auth | Simpler, wastes credits | |
| Timeouts only | Misses rate-limit recovery | |

| Option | Description | Selected |
|--------|-------------|----------|
| 2 retries, exp + jitter | ~15s → 60s, honor retry-after | ✓ |
| 1 retry, fixed delay | May not outlast rate window | |
| 3+ retries, long backoff | Delays whole run | |

| Option | Description | Selected |
|--------|-------------|----------|
| Global default + per-agent override, log every attempt | Wrapper-level, attempt numbers in NDJSON | ✓ |
| Global only | Can't tune per vendor | |
| CLI flag only | No persistence | |

## Pre-flight check depth

| Option | Description | Selected |
|--------|-------------|----------|
| Tiered: version + live probe | Only reliable auth check | ✓ |
| Version only | installed ≠ authenticated | |
| Auth-file inspection | Fragile, undocumented formats | |

| Option | Description | Selected |
|--------|-------------|----------|
| `mar preflight` + auto before runs | ~10 min cache; invoke exempt | ✓ |
| Explicit command only | Forgettable | |
| Auto only | No standalone health check | |

| Option | Description | Selected |
|--------|-------------|----------|
| Per-agent status table + exit code | Scriptable, actionable hints | ✓ |
| Minimal pass/fail | Less debuggable | |

## Multi-vendor failure UX

| Option | Description | Selected |
|--------|-------------|----------|
| Hard refusal, no override | Single-vendor review is out of scope | ✓ |
| --allow-single-vendor escape hatch | Risk of becoming default | |

| Option | Description | Selected |
|--------|-------------|----------|
| Block by default, --skip-failed if gate holds | Diversity invariant preserved | ✓ |
| Always block | One flaky CLI strands the roster | |
| Warn and proceed | Reintroduces mid-run hangs | |

| Option | Description | Selected |
|--------|-------------|----------|
| Preflight hints only | Gemini stays a plain adapter | ✓ |
| Warn on every gemini use | Noisy | |
| Ignore | Loses actionable hint | |

## Claude's Discretion

- Probe prompt content + probe timeout value
- Codex/gemini adapter flag specifics (per STACK.md tables, pinned in tests)
- Preflight cache location/format
- Config zod schema details and validation error formatting
- extraArgs merge semantics

## Deferred Ideas

- Antigravity CLI / Grok adapters (v2 ORCH-07)
- Cost/token tracking (v2 COST-01)
