import { execa } from "execa";
import { splitBin } from "../adapters/common.js";

export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GhRunOptions {
  cwd?: string;
}

export type GhRunner = (args: string[], opts?: GhRunOptions) => Promise<GhResult>;

export class GhError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly result: GhResult,
  ) {
    super(message);
    this.name = "GhError";
  }
}

async function defaultGhRunner(args: string[], opts: GhRunOptions = {}): Promise<GhResult> {
  const { cmd, preArgs } = splitBin(process.env.MAR_GH_BIN ?? "gh");
  const result = await execa(cmd, [...preArgs, ...args], {
    reject: false,
    stdin: "ignore",
    cleanup: true,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? (result.failed ? 1 : 0),
  };
}

let runner: GhRunner = defaultGhRunner;

export function setGhRunner(next: GhRunner): GhRunner {
  const previous = runner;
  runner = next;
  return previous;
}

export function resetGhRunner(): void {
  runner = defaultGhRunner;
}

function commandLabel(args: string[]): string {
  return `gh ${args.join(" ")}`;
}

export async function ghText(args: string[], opts: GhRunOptions = {}): Promise<string> {
  const result = await runner([...args], opts);
  if (result.exitCode !== 0) {
    const detail = result.stderr || result.stdout || `exit ${result.exitCode}`;
    throw new GhError(`${commandLabel(args)} failed: ${detail}`, args, result);
  }
  return result.stdout;
}

export async function ghJson<T = unknown>(args: string[], opts: GhRunOptions = {}): Promise<T> {
  const text = await ghText(args, opts);
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${commandLabel(args)} returned invalid JSON: ${message}`);
  }
}
