import { z } from "zod";
import { type GhRunOptions, ghJson, ghText } from "./gh.js";

export const PR_VIEW_FIELDS = [
  "number",
  "url",
  "title",
  "body",
  "author",
  "baseRefName",
  "headRefName",
  "state",
  "isDraft",
  "additions",
  "deletions",
  "changedFiles",
  "commits",
  "files",
] as const;

const Author = z
  .object({
    login: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const Commit = z
  .object({
    oid: z.string().optional(),
    messageHeadline: z.string().optional(),
    committedDate: z.string().optional(),
  })
  .passthrough();

const ChangedFile = z
  .object({
    path: z.string(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
    changeType: z.string().optional(),
  })
  .passthrough();

export const PullRequestView = z
  .object({
    number: z.number().int().positive(),
    url: z.string().min(1),
    title: z.string().min(1),
    body: z.string().nullable().optional(),
    author: Author,
    baseRefName: z.string().min(1),
    headRefName: z.string().min(1),
    state: z.string().min(1),
    isDraft: z.boolean(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    changedFiles: z.number().int().nonnegative(),
    commits: z.array(Commit).default([]),
    files: z.array(ChangedFile).default([]),
  })
  .passthrough();

export type PullRequestView = z.infer<typeof PullRequestView>;

export interface PullRequestContext {
  selector: string;
  pr: PullRequestView;
  diff: string;
  diffTruncated: boolean;
}

export interface PullRequestContextOptions extends GhRunOptions {
  maxDiffBytes?: number;
}

export interface RenderPullRequestBriefOptions {
  maxDiffBytes?: number;
}

const DEFAULT_MAX_DIFF_BYTES = 900_000;

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, truncated: false };
  return {
    text: Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  };
}

function authorLabel(pr: PullRequestView): string {
  return pr.author?.login ?? pr.author?.name ?? "unknown";
}

function fileLine(file: PullRequestView["files"][number]): string {
  const change = file.changeType ? ` ${file.changeType}` : "";
  const additions = file.additions ?? 0;
  const deletions = file.deletions ?? 0;
  return `- \`${file.path}\`${change} (+${additions}/-${deletions})`;
}

function commitLine(commit: PullRequestView["commits"][number]): string {
  const oid = commit.oid ? commit.oid.slice(0, 12) : "unknown";
  const headline = commit.messageHeadline ?? "(no commit headline)";
  const date = commit.committedDate ? ` (${commit.committedDate})` : "";
  return `- \`${oid}\` ${headline}${date}`;
}

export async function fetchPullRequestContext(
  selector: string,
  opts: PullRequestContextOptions = {},
): Promise<PullRequestContext> {
  const prRaw = await ghJson(["pr", "view", selector, "--json", PR_VIEW_FIELDS.join(",")], opts);
  const pr = PullRequestView.parse(prRaw);
  const diffRaw = await ghText(["pr", "diff", selector, "--patch"], opts);
  const diff = truncateUtf8(diffRaw, opts.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES);
  return { selector, pr, diff: diff.text, diffTruncated: diff.truncated };
}

export function renderPullRequestBrief(
  context: PullRequestContext,
  opts: RenderPullRequestBriefOptions = {},
): string {
  const diff = truncateUtf8(context.diff, opts.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES);
  const diffTruncated = context.diffTruncated || diff.truncated;
  const pr = context.pr;
  const body = pr.body?.trim() ? pr.body.trim() : "No PR body provided.";
  const files = pr.files.length > 0 ? pr.files.map(fileLine).join("\n") : "- No files reported.";
  const commits =
    pr.commits.length > 0 ? pr.commits.map(commitLine).join("\n") : "- No commits reported.";
  const truncationNote = diffTruncated
    ? `\n> Diff truncated to ${opts.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES} bytes before review. Treat missing context as an explicit limitation and call it out when relevant.\n`
    : "";

  return `# Pull Request Review Brief

## Review Objective

Produce a GitHub-ready PR review for this pull request. Focus on correctness,
security, regressions, missing tests, maintainability, and behavior that changed in
the patch. The final integrated review should contain blocking findings first,
then non-blocking recommendations, tests/verification notes, and open questions.

## Pull Request

- Selector: \`${context.selector}\`
- PR: #${pr.number}
- URL: ${pr.url}
- Title: ${pr.title}
- Author: ${authorLabel(pr)}
- State: ${pr.state}
- Draft: ${pr.isDraft ? "yes" : "no"}
- Base: \`${pr.baseRefName}\`
- Head: \`${pr.headRefName}\`
- Changed files: ${pr.changedFiles}
- Additions: ${pr.additions}
- Deletions: ${pr.deletions}

## PR Description

${body}

## Commits

${commits}

## Changed Files

${files}

## Patch
${truncationNote}
\`\`\`diff
${diff.text}
\`\`\`
`;
}
