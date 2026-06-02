import { describe, expect, it } from "vitest";
import { computeScheduleTimes, recentSinceMs } from "./x-schedule";

describe("computeScheduleTimes", () => {
  it("spreads N times from base by the interval", () => {
    const base = 1_000_000_000_000;
    const out = computeScheduleTimes(3, base, 90);
    expect(out).toEqual([base, base + 90 * 60_000, base + 180 * 60_000]);
  });

  it("returns empty array for zero count", () => {
    expect(computeScheduleTimes(0, 123, 90)).toEqual([]);
  });
});

describe("recentSinceMs", () => {
  it("subtracts the window in hours from now", () => {
    const now = 1_000_000_000_000;
    expect(recentSinceMs(now, 24)).toBe(now - 24 * 3_600_000);
  });
});
