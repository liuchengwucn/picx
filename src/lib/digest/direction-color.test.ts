import { describe, expect, it } from "vitest";
import {
  ACCENT_SLOTS,
  assignDirectionHues,
  directionAccent,
  fnv1a32,
} from "./direction-color";

const D = (slug: string, iso: string) => ({ slug, createdAt: new Date(iso) });

describe("fnv1a32", () => {
  it("是稳定的已知向量（SSR 与客户端必须同结果）", () => {
    // FNV-1a 32 的标准测试向量
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
});

describe("assignDirectionHues", () => {
  const seven = [
    D("formal-math", "2026-01-01T00:00:00Z"),
    D("pretrain-data", "2026-01-02T00:00:00Z"),
    D("moe", "2026-01-03T00:00:00Z"),
    D("efficient-attention", "2026-01-04T00:00:00Z"),
    D("scaling-training", "2026-01-05T00:00:00Z"),
    D("coding-agent", "2026-01-06T00:00:00Z"),
    D("self-improvement", "2026-01-07T00:00:00Z"),
  ];

  it("7 个方向各自拿到不同色相", () => {
    const hues = assignDirectionHues(seven);
    expect(new Set(hues.values()).size).toBe(7);
  });

  it("输入数组顺序不影响结果", () => {
    const a = assignDirectionHues(seven);
    const b = assignDirectionHues([...seven].reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it("新增方向不改变任何老方向的颜色", () => {
    const before = assignDirectionHues(seven);
    const after = assignDirectionHues([
      ...seven,
      D("rl-from-verifier", "2026-06-01T00:00:00Z"),
    ]);
    for (const d of seven) {
      expect(after.get(d.slug)).toBe(before.get(d.slug));
    }
  });

  /**
   * 上面几条只能证明「没人被挤掉」，证不了「让位的是后来者」——那是整套算法的
   * 全部意义所在。这两个 slug 是真实碰撞对（都落 slot 7，见 fnv1a32），所以
   * 谁拿 7 谁顺延到 8 是可以逐字钉住的：先建的 pretrain-data 拿槽 7（hue 130），
   * 后建的 scaling-training 顺延到槽 8（hue 60）。把 sort 方向写反、或改成按
   * slug 排序而非 createdAt，这条就红。
   */
  it("碰撞时先建者留在哈希槽、后建者顺延", () => {
    const hues = assignDirectionHues(seven);
    expect(hues.get("pretrain-data")).toBe(130);
    expect(hues.get("scaling-training")).toBe(60);

    // 把两者的 createdAt 对调, 让位方向必须跟着反过来
    const swapped = assignDirectionHues([
      D("pretrain-data", "2026-01-05T00:00:00Z"),
      D("scaling-training", "2026-01-02T00:00:00Z"),
    ]);
    expect(swapped.get("scaling-training")).toBe(130);
    expect(swapped.get("pretrain-data")).toBe(60);
  });

  /**
   * 槽位→色相是跳步取的（步长 5，与 12 互素），这条钉住：12 个槽位取满 12 个互不
   * 相同的色相。步长若改成与 12 不互素（2/3/4/6），就会漏色 + 重色，而重色出现在
   * 「两个方向撞了同一块颜色」这种只有人眼能发现的地方。
   */
  it("12 个方向取满 12 个互不相同的色相", () => {
    const twelve = Array.from({ length: ACCENT_SLOTS }, (_, i) =>
      D(
        `slot-filler-${i}`,
        `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      ),
    );
    const hues = [...assignDirectionHues(twelve).values()];
    expect(new Set(hues).size).toBe(ACCENT_SLOTS);
    expect([...hues].sort((a, b) => a - b)).toEqual([
      20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130,
    ]);
  });

  /**
   * tRPC 的 JSON 序列化会把 Date 变成 ISO 字符串（SuperJSON 之外的调用点、
   * 或 loaderData 往返之后都可能是字符串形态）。两种形态必须给出同一份映射,
   * 否则 SSR(Date) 与客户端(string) 的颜色会不一致 —— 又是一处只在压缩构建里
   * 报 #418 的 hydration mismatch。
   */
  it("createdAt 传 ISO 字符串与传 Date 结果一致", () => {
    const asDates = assignDirectionHues(seven);
    const asStrings = assignDirectionHues(
      seven.map((d) => ({
        slug: d.slug,
        createdAt: d.createdAt.toISOString(),
      })),
    );
    const asMs = assignDirectionHues(
      seven.map((d) => ({ slug: d.slug, createdAt: d.createdAt.getTime() })),
    );
    expect([...asStrings.entries()]).toEqual([...asDates.entries()]);
    expect([...asMs.entries()]).toEqual([...asDates.entries()]);
  });

  it("超过槽位数仍为每个方向给出色相（开始复用）", () => {
    const many = Array.from({ length: ACCENT_SLOTS + 3 }, (_, i) =>
      D(`dir-${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const hues = assignDirectionHues(many);
    expect(hues.size).toBe(ACCENT_SLOTS + 3);
  });

  it("色相全部落在受限暖色弧内", () => {
    const hues = assignDirectionHues(seven);
    for (const h of hues.values()) {
      expect(h).toBeGreaterThanOrEqual(20);
      // 12 个槽位的最后一个是 20 + 11*10 = 130, 上界 140 是开区间
      expect(h).toBeLessThan(140);
    }
  });
});

describe("directionAccent", () => {
  /**
   * L/C 必须留成 var() 而不是在 JS 里取值：暗色主题是切 .dark 的 class,
   * 组件不重渲染, 只有 CSS 变量能跟着换。
   */
  it("明度与彩度走 CSS 变量, 只把色相烧进字符串", () => {
    expect(directionAccent(90)).toBe(
      "oklch(var(--accent-l) var(--accent-c) 90.0)",
    );
  });
});
