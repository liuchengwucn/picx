import { describe, expect, it } from "vitest";
import { groupPapersByMonth, monthKeyOf } from "./papers-group";

describe("monthKeyOf", () => {
  it("uses local-time year and month, zero padded", () => {
    expect(monthKeyOf(new Date(2026, 7, 11))).toBe("2026-08");
    expect(monthKeyOf(new Date(2026, 0, 1))).toBe("2026-01");
  });

  it("accepts an ISO string as well as a Date", () => {
    const d = new Date(2025, 10, 3, 12, 0, 0);
    expect(monthKeyOf(d.toISOString())).toBe("2025-11");
  });
});

describe("groupPapersByMonth", () => {
  it("returns no groups for an empty list", () => {
    expect(groupPapersByMonth([])).toEqual([]);
  });

  it("groups consecutive same-month papers and preserves order", () => {
    const list = [
      { id: "1", createdAt: new Date(2026, 7, 9) },
      { id: "2", createdAt: new Date(2026, 7, 2) },
      { id: "3", createdAt: new Date(2026, 6, 29) },
    ];
    const groups = groupPapersByMonth(list);
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-08", "2026-07"]);
    expect(groups[0].papers.map((p) => p.id)).toEqual(["1", "2"]);
    expect(groups[1].papers.map((p) => p.id)).toEqual(["3"]);
  });

  it("anchors each group date to the first of that month", () => {
    const groups = groupPapersByMonth([
      { id: "1", createdAt: new Date(2026, 7, 9, 23, 30) },
    ]);
    expect(groups[0].date.getDate()).toBe(1);
    expect(groups[0].date.getMonth()).toBe(7);
    expect(groups[0].date.getFullYear()).toBe(2026);
  });

  it("opens a new group when the same month reappears after a gap", () => {
    // 列表按 createdAt desc 排序时不该出现,但分组函数不应默默合并
    const groups = groupPapersByMonth([
      { id: "1", createdAt: new Date(2026, 7, 9) },
      { id: "2", createdAt: new Date(2026, 6, 1) },
      { id: "3", createdAt: new Date(2026, 7, 1) },
    ]);
    expect(groups.map((g) => g.monthKey)).toEqual([
      "2026-08",
      "2026-07",
      "2026-08",
    ]);
  });
});
