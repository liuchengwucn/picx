import { describe, expect, it } from "vitest";
import {
  LAST_SEEN_STAMP_INTERVAL_MS,
  shouldStampLastSeen,
} from "./user-extensions";

describe("shouldStampLastSeen", () => {
  const now = new Date("2026-09-05T10:00:00Z");

  it("stamps when there is no previous value", () => {
    expect(shouldStampLastSeen(null, now)).toBe(true);
  });

  it("does not stamp within the interval", () => {
    const prev = new Date(now.getTime() - 59 * 60 * 1000);
    expect(shouldStampLastSeen(prev, now)).toBe(false);
  });

  it("stamps once the interval has elapsed", () => {
    const prev = new Date(now.getTime() - LAST_SEEN_STAMP_INTERVAL_MS);
    expect(shouldStampLastSeen(prev, now)).toBe(true);
    const older = new Date(now.getTime() - 61 * 60 * 1000);
    expect(shouldStampLastSeen(older, now)).toBe(true);
  });
});
