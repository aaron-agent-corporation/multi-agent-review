import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface InstallNotificationHookOptions {
  gitDir: string;
  kind: string;
  target: string;
}

export interface InstallNotificationHookResult {
  hookPath: string;
}

const BEGIN = "# >>> mar-notify-hook";
const END = "# <<< mar-notify-hook";
const MANAGED_BLOCK_RE = /# >>> mar-notify-hook\n[\s\S]*?# <<< mar-notify-hook\n?/m;

function assertHookValue(name: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`${name} is required`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} must be a single line`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function managedBlock(kind: string, target: string): string {
  return `${BEGIN}
MAR_NOTIFY_KIND=${shellQuote(kind)}
MAR_NOTIFY_TARGET=${shellQuote(target)}
case "\${2:-}" in
  merge|squash) exit 0 ;;
esac
if [ -n "\${MAR_NOTIFY_TARGET}" ] && ! grep -qi '^MAR-Notify:' "$1"; then
  git interpret-trailers --in-place --trailer "MAR-Notify: \${MAR_NOTIFY_KIND} \${MAR_NOTIFY_TARGET}" "$1"
fi
${END}
`;
}

function resolveGitDir(gitDir: string): string {
  if (!existsSync(gitDir) || !statSync(gitDir).isFile()) {
    return gitDir;
  }

  const raw = readFileSync(gitDir, "utf8").trim();
  const match = raw.match(/^gitdir:\s*(.+)$/i);
  if (!match) {
    return gitDir;
  }

  const target = match[1].trim();
  return isAbsolute(target) ? target : resolve(dirname(gitDir), target);
}

export function installPrepareCommitMessageNotificationHook(
  opts: InstallNotificationHookOptions,
): InstallNotificationHookResult {
  const kind = opts.kind.trim();
  const target = opts.target.trim();
  assertHookValue("kind", kind);
  assertHookValue("target", target);

  const hooksDir = join(resolveGitDir(opts.gitDir), "hooks");
  const hookPath = join(hooksDir, "prepare-commit-msg");
  mkdirSync(hooksDir, { recursive: true });

  const block = managedBlock(kind, target);
  const existing = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : "";
  const next = existing
    ? existing.match(MANAGED_BLOCK_RE)
      ? existing.replace(MANAGED_BLOCK_RE, block)
      : `${existing.trimEnd()}\n\n${block}`
    : `#!/bin/sh\n${block}`;

  writeFileSync(hookPath, next, "utf8");
  chmodSync(hookPath, 0o755);
  return { hookPath };
}
