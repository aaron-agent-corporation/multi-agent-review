import { describe, expect, it } from "vitest";
import { parseTimeout } from "../src/cli.js";

describe("parseTimeout (WR-02: strict whole-string validation)", () => {
  it("returns undefined when no value is supplied (caller falls back to the roster timeout)", () => {
    // 02-05: --timeout now defers to the roster's effective timeout (entry override ?? defaults)
    // when omitted, so parseTimeout signals "unset" via undefined rather than hardcoding 600000.
    expect(parseTimeout(undefined)).toBeUndefined();
  });

  it("accepts a clean positive integer string", () => {
    expect(parseTimeout("5000")).toBe(5000);
    expect(parseTimeout("1")).toBe(1);
  });

  it("rejects trailing garbage instead of truncating to the numeric prefix", () => {
    // parseInt would have returned 500; Number(...) yields NaN → rejected.
    expect(parseTimeout("500abc")).toBeNull();
  });

  it("rejects exponential/fractional forms that parseInt would silently mangle", () => {
    // parseInt("1e3") === 1 (a 1ms timeout that kills every real run). Number("1e3") === 1000,
    // which IS an integer, so it is accepted — but a fractional form must be rejected.
    expect(parseTimeout("1.5")).toBeNull();
    expect(parseTimeout("1e3")).toBe(1000); // valid: Number coerces to integer 1000
  });

  it("rejects zero, negative, and non-numeric values", () => {
    expect(parseTimeout("0")).toBeNull();
    expect(parseTimeout("-5")).toBeNull();
    expect(parseTimeout("abc")).toBeNull();
    expect(parseTimeout("")).toBeNull();
  });
});
