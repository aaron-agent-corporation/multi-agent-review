import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { readManifest } from "../workspace/manifest.js";
import { type GhRunOptions, ghText } from "./gh.js";

export interface UnifiedReview {
  path: string;
  body: string;
  integrationArtifact: string;
}

function normalizeBody(body: string): string {
  const trimmed = body.trim();
  return trimmed ? `${trimmed}\n` : "";
}

export function extractAgentMarkdownBody(raw: string): string {
  const outer = matter(raw);
  const inner = outer.content.trimStart();
  const direct = matter(inner);
  if (direct.data && Object.keys(direct.data).length > 0) {
    return normalizeBody(direct.content);
  }
  const delimiter = inner.match(/^---\s*$/m);
  if (delimiter?.index !== undefined && delimiter.index > 0) {
    return normalizeBody(matter(inner.slice(delimiter.index)).content);
  }
  return normalizeBody(inner);
}

export async function writeUnifiedReview(runDir: string): Promise<UnifiedReview> {
  const manifest = await readManifest(runDir);
  const integration = manifest.artifacts
    .filter((artifact) => artifact.kind === "integration")
    .sort((a, b) => a.seq - b.seq)
    .at(-1);
  if (!integration) {
    throw new Error(`run ${manifest.runId} has no integration artifact to publish`);
  }

  const artifactPath = join(runDir, integration.path);
  const raw = await readFile(artifactPath, "utf8");
  const body = extractAgentMarkdownBody(raw);
  const outputPath = join(runDir, "github-review.md");
  await writeFile(outputPath, body, "utf8");
  return { path: outputPath, body, integrationArtifact: integration.path };
}

export async function postPullRequestReview(
  selector: string,
  bodyFile: string,
  opts: GhRunOptions = {},
): Promise<void> {
  await ghText(["pr", "review", selector, "--comment", "--body-file", bodyFile], opts);
}
