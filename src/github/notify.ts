import { z } from "zod";
import { type GhRunOptions, ghJson } from "./gh.js";

export type NotificationStatus = "success" | "failure";

export interface PullRequestNotificationMarker {
  kind: string;
  target: string;
  fields: Record<string, string>;
}

export interface NotificationPayload {
  event: "mar.review.completed";
  status: NotificationStatus;
  kind: string;
  target: string;
  repository: string;
  pr: {
    number: number;
    url: string;
    title: string;
  };
  headSha?: string;
  runUrl: string;
  reviewUrl?: string;
  statusContext?: string;
}

export interface NotificationRequest {
  url: string;
  headers: Record<string, string>;
  payload: NotificationPayload;
  timeoutMs: number;
}

export interface NotificationResponse {
  ok: boolean;
  status: number;
  text: string;
}

export type NotificationSender = (request: NotificationRequest) => Promise<NotificationResponse>;

export type NotificationResult =
  | { sent: true; payload: NotificationPayload; responseStatus: number }
  | { sent: false; reason: "missing-webhook-url" | "marker-not-found" };

export interface NotifyPullRequestCompletionOptions extends GhRunOptions {
  status: NotificationStatus;
  runUrl: string;
  reviewUrl?: string;
  statusContext?: string;
  repository?: string;
  headSha?: string;
  webhookUrl?: string;
  webhookToken?: string;
  timeoutMs?: number;
  send?: NotificationSender;
}

const NOTIFICATION_MARKER_RE = /<!--\s*mar-notify-v1\s*\r?\n([\s\S]*?)-->/m;
const COMMIT_TRAILER_RE = /^MAR-Notify:\s*(\S+)\s+(.+?)\s*$/gim;
const MARKER_KEY_RE = /^[a-z][a-z0-9_-]*$/;
const NOTIFY_PR_FIELDS = ["number", "url", "title", "body", "headRefOid"] as const;

const NotifyPullRequestView = z
  .object({
    number: z.number().int().positive(),
    url: z.string().min(1),
    title: z.string().min(1),
    body: z.string().nullable().optional(),
    headRefOid: z.string().optional(),
  })
  .passthrough();

const CommitView = z
  .object({
    commit: z
      .object({
        message: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export function parsePullRequestNotificationMarker(
  body: string | null | undefined,
): PullRequestNotificationMarker | undefined {
  if (!body) return undefined;
  const match = body.match(NOTIFICATION_MARKER_RE);
  if (!match) return undefined;

  const fields: Record<string, string> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf(":");
    if (separator <= 0) return undefined;

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!MARKER_KEY_RE.test(key) || !value) return undefined;
    fields[key] = value;
  }

  const kind = fields.kind;
  const target = fields.target;
  if (!kind || !target || kind.length > 80 || target.length > 512) {
    return undefined;
  }

  return { kind, target, fields };
}

export function parseCommitNotificationMarker(
  message: string | null | undefined,
): PullRequestNotificationMarker | undefined {
  if (!message) return undefined;

  let marker: PullRequestNotificationMarker | undefined;
  COMMIT_TRAILER_RE.lastIndex = 0;
  let match = COMMIT_TRAILER_RE.exec(message);
  while (match !== null) {
    const kind = match[1].trim();
    const target = match[2].trim();
    if (kind && target && kind.length <= 80 && target.length <= 512) {
      marker = {
        kind,
        target,
        fields: { kind, target },
      };
    }
    match = COMMIT_TRAILER_RE.exec(message);
  }
  return marker;
}

async function defaultNotificationSender(
  request: NotificationRequest,
): Promise<NotificationResponse> {
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.payload),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

function bearerTokenHeader(token: string | undefined): Record<string, string> {
  const trimmed = token?.trim();
  return trimmed ? { authorization: `Bearer ${trimmed}` } : {};
}

async function fetchCommitNotificationMarker(
  repository: string,
  headSha: string,
  opts: GhRunOptions,
): Promise<PullRequestNotificationMarker | undefined> {
  const commitRaw = await ghJson(["api", `repos/${repository}/commits/${headSha}`], opts);
  const commit = CommitView.parse(commitRaw);
  return parseCommitNotificationMarker(commit.commit.message);
}

export async function notifyPullRequestCompletion(
  selector: string,
  opts: NotifyPullRequestCompletionOptions,
): Promise<NotificationResult> {
  const prRaw = await ghJson(["pr", "view", selector, "--json", NOTIFY_PR_FIELDS.join(",")], opts);
  const pr = NotifyPullRequestView.parse(prRaw);
  const repository = opts.repository ?? process.env.GITHUB_REPOSITORY ?? "unknown";
  const headSha = opts.headSha ?? pr.headRefOid;
  const marker =
    parsePullRequestNotificationMarker(pr.body) ??
    (repository !== "unknown" && headSha
      ? await fetchCommitNotificationMarker(repository, headSha, opts)
      : undefined);
  if (!marker) return { sent: false, reason: "marker-not-found" };

  const webhookUrl = opts.webhookUrl ?? process.env.MAR_NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) return { sent: false, reason: "missing-webhook-url" };

  const payload: NotificationPayload = {
    event: "mar.review.completed",
    status: opts.status,
    kind: marker.kind,
    target: marker.target,
    repository,
    pr: {
      number: pr.number,
      url: pr.url,
      title: pr.title,
    },
    ...(headSha ? { headSha } : {}),
    runUrl: opts.runUrl,
    ...(opts.reviewUrl ? { reviewUrl: opts.reviewUrl } : {}),
    ...(opts.statusContext ? { statusContext: opts.statusContext } : {}),
  };

  const request: NotificationRequest = {
    url: webhookUrl,
    headers: {
      "content-type": "application/json",
      "user-agent": "mar-pr-notify",
      ...bearerTokenHeader(opts.webhookToken ?? process.env.MAR_NOTIFY_WEBHOOK_TOKEN),
    },
    payload,
    timeoutMs: opts.timeoutMs ?? 5_000,
  };
  const response = await (opts.send ?? defaultNotificationSender)(request);
  if (!response.ok) {
    const detail = response.text ? `: ${response.text}` : "";
    throw new Error(`notification webhook returned HTTP ${response.status}${detail}`);
  }

  return { sent: true, payload, responseStatus: response.status };
}
