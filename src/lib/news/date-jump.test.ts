import { describe, expect, it } from "vitest";
import { beforeTsOf, dateFromKey } from "./date-jump";

describe("beforeTsOf", () => {
  it("returns next-day local midnight", () => {
    expect(beforeTsOf("2026-08-06")).toBe(new Date(2026, 7, 7).getTime());
  });

  it("carries over month end", () => {
    expect(beforeTsOf("2026-01-31")).toBe(new Date(2026, 1, 1).getTime());
  });

  it("accepts a leap day and rejects a non-leap Feb 29", () => {
    expect(beforeTsOf("2024-02-29")).toBe(new Date(2024, 2, 1).getTime());
    expect(beforeTsOf("2025-02-29")).toBeNull();
  });

  it("carries over year end", () => {
    expect(beforeTsOf("2026-12-31")).toBe(new Date(2027, 0, 1).getTime());
  });

  it("rejects invalid input", () => {
    expect(beforeTsOf("2026-13-01")).toBeNull();
    expect(beforeTsOf("2026-02-30")).toBeNull();
    expect(beforeTsOf("not-a-date")).toBeNull();
  });
});

describe("dateFromKey", () => {
  it("parses to local midnight", () => {
    expect(dateFromKey("2026-08-06")?.getTime()).toBe(
      new Date(2026, 7, 6).getTime(),
    );
  });
});
