import { afterEach, describe, expect, it } from "vitest";
import { ghJson, ghText, resetGhRunner, setGhRunner } from "../src/github/gh.js";

afterEach(() => {
  resetGhRunner();
});

describe("gh wrapper", () => {
  it("parses JSON output from the injected gh runner", async () => {
    const calls: string[][] = [];
    setGhRunner(async (args) => {
      calls.push(args);
      return { stdout: '{"ok":true}', stderr: "", exitCode: 0 };
    });

    await expect(ghJson(["pr", "view", "7"])).resolves.toEqual({ ok: true });
    expect(calls).toEqual([["pr", "view", "7"]]);
  });

  it("returns text output from the injected gh runner", async () => {
    setGhRunner(async () => ({ stdout: "diff --git a/file b/file\n", stderr: "", exitCode: 0 }));

    await expect(ghText(["pr", "diff", "7", "--patch"])).resolves.toBe(
      "diff --git a/file b/file\n",
    );
  });

  it("throws a useful error when gh exits non-zero", async () => {
    setGhRunner(async () => ({ stdout: "", stderr: "not authenticated", exitCode: 1 }));

    await expect(ghText(["pr", "diff", "7"])).rejects.toThrow("gh pr diff 7 failed");
    await expect(ghText(["pr", "diff", "7"])).rejects.toThrow("not authenticated");
  });
});
