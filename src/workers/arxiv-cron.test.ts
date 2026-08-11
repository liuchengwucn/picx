import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type HFPaper,
  intFromEnv,
  resolveSelection,
  selectPapers,
} from "./arxiv-cron";

function mk(id: string, upvotes: number): HFPaper {
  return { paper: { id, title: `Paper ${id}`, upvotes } };
}

// 打乱的输入：同时验证返回值按 upvotes 降序
const papers: HFPaper[] = [
  mk("a", 40),
  mk("b", 120),
  mk("c", 5),
  mk("d", 50),
  mk("e", 10),
];

const ids = (list: HFPaper[]) => list.map((p) => p.paper.id);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selectPapers - 旧逻辑等价（默认 30/3）", () => {
  it("取所有 upvotes >= 30 的论文，按 upvotes 降序", () => {
    const selected = selectPapers(papers, 30, 3);
    expect(ids(selected)).toEqual(["b", "d", "a"]);
    expect(selected.map((p) => p.paper.upvotes)).toEqual([120, 50, 40]);
  });

  it("阈值是闭区间：upvotes 恰等于阈值算过线", () => {
    const onBoundary = [mk("hit", 30), mk("miss", 29), mk("x", 1), mk("y", 2)];
    expect(ids(selectPapers(onBoundary, 30, 0))).toEqual(["hit"]);
    const atHundred = [mk("hit", 100), mk("miss", 99)];
    expect(ids(selectPapers(atHundred, 100, 0))).toEqual(["hit"]);
  });

  it("过线不足 3 篇时补到 top-3", () => {
    // 阈值 100 只有 b 过线，不足 3 篇 → 退化为 top-3
    const selected = selectPapers(papers, 100, 3);
    expect(ids(selected)).toEqual(["b", "d", "a"]);
  });

  it("全部低于阈值时补到 top-3", () => {
    const allLow = [mk("x", 1), mk("y", 9), mk("z", 3), mk("w", 7)];
    expect(ids(selectPapers(allLow, 30, 3))).toEqual(["y", "w", "z"]);
  });

  it("输入少于 3 篇时全部返回且不报错", () => {
    const few = [mk("x", 2), mk("y", 8)];
    expect(ids(selectPapers(few, 30, 3))).toEqual(["y", "x"]);
    expect(selectPapers([], 30, 3)).toEqual([]);
  });

  it("不修改入参数组（导出的函数不该改动调用方传进来的数组）", () => {
    const input = [mk("a", 40), mk("b", 120), mk("c", 5)];
    const snapshot = ids(input);
    selectPapers(input, 30, 3);
    expect(ids(input)).toEqual(snapshot);
  });
});

describe("selectPapers - 切换终态（100/0）", () => {
  it("只取过线的爆款", () => {
    expect(ids(selectPapers(papers, 100, 0))).toEqual(["b"]);
  });

  it("无人过线时返回空数组，不补底", () => {
    const allLow = [mk("x", 99), mk("y", 30), mk("z", 3)];
    expect(selectPapers(allLow, 100, 0)).toEqual([]);
  });
});

describe("resolveSelection", () => {
  it("未配置任何 env 时 = 旧逻辑 30/3（部署即零变化）", () => {
    expect(resolveSelection({})).toEqual({ minUpvotes: 30, topFallback: 3 });
  });

  it("切换终态：100/0", () => {
    expect(
      resolveSelection({ HF_MIN_UPVOTES: "100", HF_TOP_FALLBACK: "0" }),
    ).toEqual({ minUpvotes: 100, topFallback: 0 });
  });

  it("只设其中一个时，另一个吃默认", () => {
    expect(resolveSelection({ HF_MIN_UPVOTES: "80" })).toEqual({
      minUpvotes: 80,
      topFallback: 3,
    });
    expect(resolveSelection({ HF_TOP_FALLBACK: "0" })).toEqual({
      minUpvotes: 30,
      topFallback: 0,
    });
  });

  it("非法值回落默认", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveSelection({ HF_MIN_UPVOTES: "abc", HF_TOP_FALLBACK: "-2" }),
    ).toEqual({ minUpvotes: 30, topFallback: 3 });
  });
});

describe("intFromEnv", () => {
  it("undefined / 空串 / 纯空白 → fallback", () => {
    expect(intFromEnv(undefined, "HF_MIN_UPVOTES", 30)).toBe(30);
    expect(intFromEnv("", "HF_MIN_UPVOTES", 30)).toBe(30);
    expect(intFromEnv("   ", "HF_MIN_UPVOTES", 30)).toBe(30);
  });

  it("解析合法的非负整数", () => {
    expect(intFromEnv("100", "HF_MIN_UPVOTES", 30)).toBe(100);
    expect(intFromEnv("0", "HF_TOP_FALLBACK", 3)).toBe(0);
  });

  it("非法值 → fallback 并告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const raw of ["abc", "-1", "1.5"]) {
      expect(intFromEnv(raw, "HF_MIN_UPVOTES", 30)).toBe(30);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0]?.[0]).toContain("HF_MIN_UPVOTES");
    expect(warn.mock.calls[0]?.[0]).toContain("abc");
  });
});
