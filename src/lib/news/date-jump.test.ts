import { describe, expect, it } from "vitest";
import { beforeTsOf, dateFromKey } from "./date-jump";

describe("beforeTsOf", () => {
  it("returns next-day local midnight", () => {
    expect(beforeTsOf("2026-08-06")).toBe(new Date(2026, 7, 7).getTime());
  });

  it("carries over month end", () => {
    expect(beforeTsOf("2026-01-31")).toBe(new Date(2026, 1, 1).getTime());
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
