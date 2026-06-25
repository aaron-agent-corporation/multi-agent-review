import { execa } from "execa";

export type TerminalMode = "headless" | "tmux";

const TMUX_SESSION_RE = /^[A-Za-z0-9_-]+$/;

export function tmuxSessionName(runId: string): string {
  const name = `mar-${runId}`;
  if (!TMUX_SESSION_RE.test(name)) {
    throw new Error(`unsafe tmux session name derived from run id "${runId}"`);
  }
  return name;
}

export async function assertTmuxAvailable(bin = "tmux"): Promise<void> {
  const result = await execa(bin, ["-V"], { reject: false, stdin: "ignore", timeout: 10_000 });
  if (result.exitCode !== 0) {
    throw new Error("tmux mode requested but tmux is not available on PATH");
  }
}

export async function assertTerminalModeSupported(
  mode: TerminalMode,
  runId: string,
): Promise<{ tmuxSession?: string }> {
  if (mode === "headless") return {};
  await assertTmuxAvailable();
  const session = tmuxSessionName(runId);
  throw new Error(
    `tmux mode is configured for session "${session}", but pane-backed reviewer execution is not implemented in this MAR build`,
  );
}
