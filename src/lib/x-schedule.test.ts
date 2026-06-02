import { describe, expect, it } from "vitest";
import { recentSinceMs } from "./x-schedule";

describe("recentSinceMs", () => {
  it("subtracts the window in hours from now", () => {
    const now = 1_000_000_000_000;
    expect(recentSinceMs(now, 24)).toBe(now - 24 * 3_600_000);
  });
});
