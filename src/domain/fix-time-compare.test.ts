import { describe, expect, it } from "vitest";
import { compareByTime } from "./readiness";

describe("compareByTime", () => {
  it("orders mixed ISO offsets by the instant, not by the string", () => {
    expect(compareByTime({ dueAt: "2026-11-12T10:00:00+02:00" }, { dueAt: "2026-11-12T09:00:00Z" })).toBeLessThan(0);
    expect(compareByTime({ dueAt: "2026-11-12T09:00:00Z" }, { dueAt: "2026-11-12T09:00:00.000Z" })).toBe(0);
  });
  it("treats an unparseable time like no time: after every real time, equal to each other", () => {
    const real = { dueAt: "2026-11-12T09:00:00Z" };
    expect(compareByTime({ dueAt: "not a date" }, real)).toBeGreaterThan(0);
    expect(compareByTime(real, { dueAt: "not a date" })).toBeLessThan(0);
    expect(compareByTime({ dueAt: null }, { dueAt: "not a date" })).toBe(0);
  });
});
