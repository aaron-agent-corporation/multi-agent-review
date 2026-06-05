/**
 * The 6-phase review protocol as TYPED DATA, not control flow (RESEARCH Pattern 1). Mirrors the
 * `as const` descriptor-table idiom from adapters/registry.ts: a frozen array the engine iterates,
 * never a hand-rolled switch. Each phase's `kind` feeds straight into
 * artifactName(seq, agent, kind) (layout.ts), so kind === name keeps artifact filenames aligned
 * with the phase that produced them.
 *
 * `scoped` is true ONLY for "draft" — the one phase that runs each agent in an isolated cwd
 * (PROT-04 independence boundary). `participants` is "all" for every phase in Phase 3 (the single
 * integrator designation is deferred to Phase 4 / REVW-04).
 */
export interface Phase {
  readonly name: "draft" | "review" | "response" | "evaluation" | "integration" | "validation";
  readonly kind: string;
  readonly scoped: boolean;
  readonly participants: "all" | "integrator";
}

export const PHASES: readonly Phase[] = [
  { name: "draft", kind: "draft", scoped: true, participants: "all" },
  { name: "review", kind: "review", scoped: false, participants: "all" },
  { name: "response", kind: "response", scoped: false, participants: "all" },
  { name: "evaluation", kind: "evaluation", scoped: false, participants: "all" },
  { name: "integration", kind: "integration", scoped: false, participants: "all" },
  { name: "validation", kind: "validation", scoped: false, participants: "all" },
] as const;
