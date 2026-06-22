import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyClaude,
  classifyCodex,
  classifyGemini,
  classifyGrok,
  DEFAULT_RETRIES,
  withRetry,
} from "../src/retry.js";
import type { TurnResult } from "../src/schema/turn.js";

// Record every backoff delay withRetry asks for, and resolve instantly — no real waits and no
// dependence on fake-timer interplay with node:timers/promises internals. `vi.mock` is hoisted
// above all imports by vitest, so this intercepts the sleep withRetry imports.
const recordedSleeps: number[] = [];
vi.mock("node:timers/promises", () => ({
  setTimeout: (ms?: number) => {
    recordedSleeps.push(ms ?? 0);
    return Promise.resolve();
  },
}));

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

describe("classifyGrok (xAI Grok Build)", () => {
  it("fatal for login/API-key errors", () => {
    expect(classifyGrok(turn({ error: "Authentication required: run grok login" }))).toBe("fatal");
    expect(classifyGrok(turn({ error: "Invalid API key" }))).toBe("fatal");
  });

  it("transient for rate limits and overloads", () => {
    expect(classifyGrok(turn({ error: "429 Too Many Requests" }))).toBe("transient");
    expect(classifyGrok(turn({ error: "service overloaded" }))).toBe("transient");
  });
});

describe("classification edge cases (D-22) — shared across vendors", () => {
  for (const classify of [classifyCodex, classifyGemini, classifyClaude, classifyGrok]) {
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

describe("withRetry (D-22..25) — fake timers + mocked sleep, no real waits", () => {
  // `vi.useFakeTimers()` is asserted by the plan; the mocked node:timers/promises setTimeout
  // (top of file) makes every backoff resolve instantly AND records the requested delay, so the
  // suite never waits 15-60s and the backoff math is observable.
  beforeEach(() => {
    vi.useFakeTimers();
    recordedSleeps.length = 0;
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
    expect(recordedSleeps).toHaveLength(0); // no backoff on success
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
    const result = await withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt,
      baseMs: 0,
    });
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
    expect(recordedSleeps).toHaveLength(0); // never scheduled a backoff
  });

  it("transient on every attempt, retries:2 -> last failed result after exactly 3 attempts", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "transient" }));
    const onAttempt = vi.fn();
    const result = await withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt,
      baseMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(onAttempt).toHaveBeenCalledTimes(3);
    // 2 backoffs between the 3 attempts; no sleep after the final exhausted attempt.
    expect(recordedSleeps).toHaveLength(2);
  });

  it("backoff is exponential with jitter within [base*2^(n-1), base*2^(n-1)*1.5] when below the cap", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "transient" }));
    // Pin jitter to its max contribution (random -> ~0.999) deterministically.
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const base = 1000;
    const cap = 60_000; // both raw values (1000, 2000) stay well below the cap here
    await withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt: vi.fn(),
      baseMs: base,
      maxMs: cap,
    });
    randSpy.mockRestore();
    expect(recordedSleeps).toHaveLength(2); // between attempt 1->2 and 2->3
    for (let n = 1; n <= 2; n++) {
      const raw = base * 2 ** (n - 1);
      // raw + jitter, with jitter bounded by raw/2 → total in [raw, raw*1.5].
      expect(recordedSleeps[n - 1]).toBeGreaterThanOrEqual(raw);
      expect(recordedSleeps[n - 1]).toBeLessThanOrEqual(raw * 1.5 + 1);
    }
  });

  it("WR-01: maxMs is a TRUE ceiling — jitter is added inside the cap, never on top of it", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "transient" }));
    // Max jitter: with the OLD (buggy) code (cap applied first, jitter added after) the sleep
    // would reach cap*1.5; with the fix the total raw+jitter is clamped to cap, so the sleep
    // must NEVER exceed cap regardless of jitter.
    const randSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const base = 1000;
    const cap = 1000; // raw (1000, 2000) already meets/exceeds the cap on both attempts
    await withRetry(invoke, {
      retries: 2,
      classify: transientFatal,
      onAttempt: vi.fn(),
      baseMs: base,
      maxMs: cap,
    });
    randSpy.mockRestore();
    expect(recordedSleeps).toHaveLength(2);
    for (const slept of recordedSleeps) {
      // The defect this guards: old code allowed up to cap*1.5 (=1500) here.
      expect(slept).toBeLessThanOrEqual(cap);
    }
  });

  it("retryAfterMs return value overrides the computed backoff", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "transient" }));
    await withRetry(invoke, {
      retries: 1,
      classify: transientFatal,
      onAttempt: vi.fn(),
      baseMs: 99_999,
      retryAfterMs: () => 7,
    });
    expect(recordedSleeps).toContain(7);
    expect(recordedSleeps).not.toContain(99_999);
  });

  it("default retries is 2 (3 attempts) when wired via DEFAULT_RETRIES", async () => {
    const invoke = vi.fn(async () => turn({ ok: false, error: "transient" }));
    await withRetry(invoke, {
      retries: DEFAULT_RETRIES,
      classify: transientFatal,
      onAttempt: vi.fn(),
      baseMs: 0,
    });
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
