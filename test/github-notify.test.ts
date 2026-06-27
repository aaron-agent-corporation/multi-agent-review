import { afterEach, describe, expect, it } from "vitest";
import { resetGhRunner, setGhRunner } from "../src/github/gh.js";
import {
  type NotificationRequest,
  notifyPullRequestCompletion,
  parseCommitNotificationMarker,
  parsePullRequestNotificationMarker,
} from "../src/github/notify.js";

afterEach(() => {
  resetGhRunner();
});

describe("PR completion notifications", () => {
  it("parses a mar-notify-v1 marker from the PR body", () => {
    const marker = parsePullRequestNotificationMarker(`
# Feature PR

<!-- mar-notify-v1
kind: claude-code-channel
target: mar-relay:abc123
label: local-terminal
-->

Normal PR text.
`);

    expect(marker).toEqual({
      kind: "claude-code-channel",
      target: "mar-relay:abc123",
      fields: {
        kind: "claude-code-channel",
        target: "mar-relay:abc123",
        label: "local-terminal",
      },
    });
  });

  it("ignores absent or incomplete notification markers", () => {
    expect(parsePullRequestNotificationMarker("No marker here.")).toBeUndefined();
    expect(
      parsePullRequestNotificationMarker(`<!-- mar-notify-v1
kind: claude-code-channel
-->`),
    ).toBeUndefined();
  });

  it("parses a MAR-Notify trailer from a commit message", () => {
    expect(
      parseCommitNotificationMarker(`feat: add review completion relay

Body text.

MAR-Notify: claude-code-channel mar-relay:abc123
`),
    ).toEqual({
      kind: "claude-code-channel",
      target: "mar-relay:abc123",
      fields: {
        kind: "claude-code-channel",
        target: "mar-relay:abc123",
      },
    });
  });

  it("posts a small completion payload to the configured relay when the PR opts in", async () => {
    const ghCalls: string[][] = [];
    const requests: NotificationRequest[] = [];

    setGhRunner(async (args) => {
      ghCalls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 42,
            url: "https://github.com/acme/widgets/pull/42",
            title: "Improve widget parser",
            body: `<!-- mar-notify-v1
kind: claude-code-channel
target: mar-relay:abc123
-->`,
            headRefOid: "abc123",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: `unexpected gh call: ${args.join(" ")}`, exitCode: 1 };
    });

    const result = await notifyPullRequestCompletion("42", {
      status: "success",
      repository: "acme/widgets",
      runUrl: "https://github.com/acme/widgets/actions/runs/99",
      reviewUrl: "https://github.com/acme/widgets/pull/42",
      statusContext: "MAR multi-agent review",
      webhookUrl: "https://relay.example.test/mar",
      webhookToken: "secret-token",
      send: async (request) => {
        requests.push(request);
        return { ok: true, status: 202, text: "accepted" };
      },
    });

    expect(result).toMatchObject({ sent: true });
    expect(ghCalls).toEqual([["pr", "view", "42", "--json", "number,url,title,body,headRefOid"]]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://relay.example.test/mar");
    expect(requests[0].headers.authorization).toBe("Bearer secret-token");
    expect(requests[0].payload).toEqual({
      event: "mar.review.completed",
      status: "success",
      kind: "claude-code-channel",
      target: "mar-relay:abc123",
      repository: "acme/widgets",
      pr: {
        number: 42,
        url: "https://github.com/acme/widgets/pull/42",
        title: "Improve widget parser",
      },
      headSha: "abc123",
      runUrl: "https://github.com/acme/widgets/actions/runs/99",
      reviewUrl: "https://github.com/acme/widgets/pull/42",
      statusContext: "MAR multi-agent review",
    });
    expect(JSON.stringify(requests[0].payload)).not.toContain("mar-notify-v1");
  });

  it("does not call the relay when the PR body has no marker", async () => {
    let sent = false;
    setGhRunner(async (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 42,
            url: "https://github.com/acme/widgets/pull/42",
            title: "Improve widget parser",
            body: "No notification requested.",
            headRefOid: "abc123",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "api") {
        return {
          stdout: JSON.stringify({ commit: { message: "feat: no notification trailer\n" } }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: `unexpected gh call: ${args.join(" ")}`, exitCode: 1 };
    });

    const result = await notifyPullRequestCompletion("42", {
      status: "failure",
      repository: "acme/widgets",
      runUrl: "https://github.com/acme/widgets/actions/runs/99",
      webhookUrl: "https://relay.example.test/mar",
      send: async () => {
        sent = true;
        return { ok: true, status: 202, text: "" };
      },
    });

    expect(result).toEqual({ sent: false, reason: "marker-not-found" });
    expect(sent).toBe(false);
  });

  it("reports marker-not-found before webhook setup when the PR never opted in", async () => {
    let sent = false;
    setGhRunner(async (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 42,
            url: "https://github.com/acme/widgets/pull/42",
            title: "Improve widget parser",
            body: "No notification requested.",
            headRefOid: "abc123",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "api") {
        return {
          stdout: JSON.stringify({ commit: { message: "feat: no notification trailer\n" } }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: `unexpected gh call: ${args.join(" ")}`, exitCode: 1 };
    });

    const result = await notifyPullRequestCompletion("42", {
      status: "failure",
      repository: "acme/widgets",
      runUrl: "https://github.com/acme/widgets/actions/runs/99",
      send: async () => {
        sent = true;
        return { ok: true, status: 202, text: "" };
      },
    });

    expect(result).toEqual({ sent: false, reason: "marker-not-found" });
    expect(sent).toBe(false);
  });

  it("reports missing webhook only after the PR opts in", async () => {
    let sent = false;
    setGhRunner(async (args) => {
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 42,
            url: "https://github.com/acme/widgets/pull/42",
            title: "Improve widget parser",
            body: `<!-- mar-notify-v1
kind: claude-code-channel
target: mar-relay:abc123
-->`,
            headRefOid: "abc123",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: `unexpected gh call: ${args.join(" ")}`, exitCode: 1 };
    });

    const result = await notifyPullRequestCompletion("42", {
      status: "failure",
      repository: "acme/widgets",
      runUrl: "https://github.com/acme/widgets/actions/runs/99",
      send: async () => {
        sent = true;
        return { ok: true, status: 202, text: "" };
      },
    });

    expect(result).toEqual({ sent: false, reason: "missing-webhook-url" });
    expect(sent).toBe(false);
  });

  it("falls back to the head commit MAR-Notify trailer when the PR body has no marker", async () => {
    const ghCalls: string[][] = [];
    const requests: NotificationRequest[] = [];

    setGhRunner(async (args) => {
      ghCalls.push(args);
      if (args[0] === "pr" && args[1] === "view") {
        return {
          stdout: JSON.stringify({
            number: 42,
            url: "https://github.com/acme/widgets/pull/42",
            title: "Improve widget parser",
            body: "No notification marker in the PR body.",
            headRefOid: "abc123",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "api") {
        return {
          stdout: JSON.stringify({
            commit: {
              message: `feat: add parser

MAR-Notify: claude-code-channel mar-relay:from-commit
`,
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: `unexpected gh call: ${args.join(" ")}`, exitCode: 1 };
    });

    const result = await notifyPullRequestCompletion("42", {
      status: "success",
      repository: "acme/widgets",
      runUrl: "https://github.com/acme/widgets/actions/runs/99",
      webhookUrl: "https://relay.example.test/mar",
      send: async (request) => {
        requests.push(request);
        return { ok: true, status: 202, text: "accepted" };
      },
    });

    expect(result).toMatchObject({ sent: true });
    expect(ghCalls).toEqual([
      ["pr", "view", "42", "--json", "number,url,title,body,headRefOid"],
      ["api", "repos/acme/widgets/commits/abc123"],
    ]);
    expect(requests[0].payload.kind).toBe("claude-code-channel");
    expect(requests[0].payload.target).toBe("mar-relay:from-commit");
  });
});
