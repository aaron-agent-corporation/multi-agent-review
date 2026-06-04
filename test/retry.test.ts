import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyClaude,
  classifyCodex,
  classifyGemini,
  withRetry,
} from "../src/retry.js";
import type { TurnResult } from "../src/schema/turn.js";

/** A minimal TurnResult builder — classifiers read ONLY timedOut, error, exitCode. */
function turn(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    ok: false,
    agent: "test-agent",
    text: "",
    exitCode: 1,
    durationMs: 100,
    timedOut: false,
    redactedCommand: ["<bin>", "-p", "<prompt>"],
    ...overrides,
  };
}

describe("classifyCodex (D-22, LIVE-VERIFIED strings)", () => {
  const transientErrors = [
    "unexpected status 429 Too Many Requests",
    "RESOURCE_EXHAUSTED",
    "rate limit reached",
    "usage limit hit",
    "Too Many Requests",
    "unexpected status 503 overloaded",
    "the model is overloaded",
  ];
  for (const e of transientErrors) {
    it(`transient for codex error: ${e}`, () => {
      expect(classifyCodex(turn({ error: e }))).toBe("transient");
    });
  }

  const fatalErrors = [
    "unexpected status 401 Unauthorized: Missing bearer or basic authentication",
    "Unauthorized",
    "Missing bearer",
    "not logged in",
    "model is not supported",
  ];
  for (const e of fatalErrors) {
    it(`fatal for codex error: ${e}`, () => {
      expect(classifyCodex(turn({ error: e }))).toBe("fatal");
    });
  }
});

describe("classifyGemini (D-22, LIVE-VERIFIED 41/55 strings)", () => {
  const transientErrors = [
    "429 RESOURCE_EXHAUSTED",
    "RESOURCE_EXHAUSTED",
    "quota exceeded",
    "Too Many Requests",
    "model overloaded 503",
  ];
  for (const e of transientErrors) {
    it(`transient for gemini error: ${e}`, () => {
      expect(classifyGemini(turn({ error: e }))).toBe("transient");
    });
  }

  const fatalErrors = [
    "Please set an Auth method to use Gemini CLI",
    "ProjectIdRequiredError: set GOOGLE_CLOUD_PROJECT",
    "Gemini CLI is not running in a trusted directory",
    "API key not valid",
  ];
  for (const e of fatalErrors) {
    it(`fatal for gemini error: ${e}`, () => {
      expect(classifyGemini(turn({ error: e }))).toBe("fatal");
    });
  }
});

describe("classifyClaude (D-22)", () => {
  it("fatal for 'Not logged in'", () => {
    expect(classifyClaude(turn({ error: "Not logged in" }))).toBe("fatal");
  });
  it("transient for '529'", () => {
    expect(classifyClaude(turn({ error: "529 overloaded_error" }))).toBe("transient");
  });
  it("transient for 'overloaded'", () => {
    expect(classifyClaude(turn({ error: "the service is overloaded" }))).toBe("transient");
  });
});

describe("classification edge cases (D-22) — shared across vendors", () => {
  for (const classify of [classifyCodex, classifyGemini, classifyClaude]) {
    it(`${classify.name}: timedOut TurnResult is transient (a hang is retryable)`, () => {
      expect(classify(turn({ timedOut: true, error: "timeout" }))).toBe("transient");
    });
    it(`${classify.name}: unparseable output is transient (parse fluke)`, () => {
      expect(classify(turn({ error: "unparseable output" }))).toBe("transient");
    });
    it(`${classify.name}: unclassified clean error defaults to fatal (never wastes a retry)`, () => {
      expect(classify(turn({ error: "something went sideways" }))).toBe("fatal");
    });
    it(`${classify.name}: no error string defaults to fatal`, () => {
      expect(classify(turn({ error: undefined }))).toBe("fatal");
    });
  }
});

describe("withRetry (D-22..25) — fake timers, no real waits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const transientFatal = (t: TurnResult): "transient" | "fatal" =>
    t.error === "fatal" ? "fatal" : "transient";

  it("returns ok on the first attempt -> 1 onAttempt call, no retry", async () => {
    const invoke = vi.fn(async () => turn({ ok: true }));
    const onAttempt = vi.fn();
    const result = await withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt,
      baseMs: 0,
    });
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith(expect.objectContaining({ ok: true }), 1);
  });

  it("transient twice then ok -> returns ok after 3 attempts; onAttempt 1,2,3", async () => {
    const results = [
      turn({ ok: false, error: "transient" }),
      turn({ ok: false, error: "transient" }),
      turn({ ok: true }),
    ];
    let i = 0;
    const invoke = vi.fn(async () => results[i++]);
    const onAttempt = vi.fn();
    const promise = withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt,
      baseMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(onAttempt).toHaveBeenCalledTimes(3);
    expect(onAttempt.mock.calls.map((c) => c[1])).toEqual([1, 2, 3]);
  });

  it("fatal on attempt 1 -> returns immediately, onAttempt once, no sleep", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "fatal" }));
    const onAttempt = vi.fn();
    const result = await withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt,
      baseMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it("transient on every attempt, retries:2 -> last failed result after exactly 3 attempts", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "transient" }));
    const onAttempt = vi.fn();
    const promise = withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt,
      baseMs: 0,
    });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(onAttempt).toHaveBeenCalledTimes(3);
  });

  it("backoff is exponential with jitter within [base*2^(n-1), base*2^(n-1)*1.5]", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "transient" }));
    const sleeps: number[] = [];
    const spy = vi.spyOn(globalThis, "setTimeout");
    // Pin jitter to its max contribution (random -> 0.999...) deterministically.
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const base = 1000;
    const cap = 60_000;
    const promise = withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt: vi.fn(),
      baseMs: base,
      maxMs: cap,
    });
    await vi.runAllTimersAsync();
    await promise;
    // Collect the delays passed to the timer scheduler (node:timers/promises uses setTimeout).
    for (const call of spy.mock.calls) {
      const delay = call[1];
      if (typeof delay === "number") sleeps.push(delay);
    }
    randSpy.mockRestore();
    spy.mockRestore();
    // Two sleeps (between attempt 1->2 and 2->3).
    const backoffs = sleeps.filter((s) => s > 0);
    expect(backoffs.length).toBeGreaterThanOrEqual(2);
    for (let n = 1; n <= 2; n++) {
      const expected = Math.min(cap, base * 2 ** (n - 1));
      const lo = expected;
      const hi = expected * 1.5;
      expect(backoffs[n - 1]).toBeGreaterThanOrEqual(lo);
      expect(backoffs[n - 1]).toBeLessThanOrEqual(hi + 1);
    }
  });

  it("retryAfterMs return value overrides the computed backoff", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "transient" }));
    const spy = vi.spyOn(globalThis, "setTimeout");
    const promise = withRetry(invoke, {
      retries: 1,
      classify: transientFatal,
      onAttempt: vi.fn(),
      baseMs: 99_999,
      retryAfterMs: () => 7,
    });
    await vi.runAllTimersAsync();
    await promise;
    const delays = spy.mock.calls
      .map((c) => c[1])
      .filter((d): d is number => typeof d === "number" && d > 0);
    spy.mockRestore();
    expect(delays).toContain(7);
    expect(delays).not.toContain(99_999);
  });
});
