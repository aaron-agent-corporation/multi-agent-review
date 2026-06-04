import { join } from "node:path";
import { ensureDirSync } from "fs-extra";
import pino from "pino";

/**
 * One invocation record (ORCH-06 / D-15). Carries argv, a prompt *reference* (NOT the full
 * prompt body — Security Domain V7 / D-15), exit code, duration, the wall-clock timeout flag,
 * and the output artifact path. Never include `ANTHROPIC_API_KEY` or raw prompt content.
 */
export interface InvocationRecord {
  /** The exact argv the adapter spawned, e.g. ["-p", "<prompt>", "--output-format", "json"]. */
  command: string[];
  /** A reference to the prompt — a file path or short label/hash, NOT the full prompt text. */
  promptRef: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  /** Path to the normalized output artifact (absent on failure with no artifact). */
  artifactPath?: string;
}

const FILE_NAME = "invocations.ndjson";

/**
 * Append exactly ONE NDJSON line to `<runDir>/invocations.ndjson` using pino (D-15).
 *
 * pino (not raw appendFile) guarantees correct, non-interleaved NDJSON — each call writes one
 * complete, independently parseable JSON line. We use a synchronous pino destination so the
 * line is flushed before the function returns (small per-invocation writes, append-only audit
 * trail — throughput is irrelevant here).
 */
export function logInvocation(runDir: string, record: InvocationRecord): void {
  ensureDirSync(runDir);
  const dest = pino.destination({
    dest: join(runDir, FILE_NAME),
    append: true,
    sync: true,
  });
  // Disable pino's default base fields (pid/hostname) and timestamp-key noise so each line is
  // exactly the audit record; a fresh ISO `ts` is added explicitly for ordering.
  const logger = pino({ base: undefined, timestamp: false }, dest);
  logger.info({ ts: new Date().toISOString(), ...record });
  dest.flushSync();
}
