import { describe, expect, it } from "vitest";
import { pickEventPublishedAt } from "./event-date";

const at = (iso: string, score: number | null = 70) => ({
  publishedAt: new Date(iso),
  relevanceScore: score,
});

// 生产 story 7ye5bB 的真实形状：1 条 8/23 前置报道（88 分）+ 5 条 8/26 发布报道（400 分）
const GLM_FLASH = [
  at("2026-08-23T16:24:21Z", 88),
  at("2026-08-26T14:08:50Z", 85),
  at("2026-08-26T14:26:48Z", 85),
  at("2026-08-26T14:58:54Z", 65),
  at("2026-08-26T15:58:17Z", 85),
  at("2026-08-26T16:01:41Z", 80),
];

describe("pickEventPublishedAt", () => {
  it("空成员返回 null", () => {
    expect(pickEventPublishedAt([])).toBeNull();
  });

  it("单条目返回该条目时间", () => {
    expect(pickEventPublishedAt([at("2026-08-26T14:08:50Z")])).toEqual(
      new Date("2026-08-26T14:08:50Z"),
    );
  });

  it("跨度小于 24h 的成员是同一簇，返回首条时间", () => {
    const result = pickEventPublishedAt([
      at("2026-08-26T02:00:00Z"),
      at("2026-08-26T14:00:00Z"),
      at("2026-08-26T23:00:00Z"),
    ]);
    expect(result).toEqual(new Date("2026-08-26T02:00:00Z"));
  });

  it("跨午夜的一簇不被切开（按间隔切，不按自然日）", () => {
    // 这两条在 Asia/Shanghai 分别是 8/26 22:08 与 8/27 00:01，按自然日会被切成两簇
    const result = pickEventPublishedAt([
      at("2026-08-26T14:08:50Z", 85),
      at("2026-08-26T16:01:41Z", 80),
    ]);
    expect(result).toEqual(new Date("2026-08-26T14:08:50Z"));
  });

  it("后簇压倒性更重时改锚到后簇首条（7ye5bB 形状）", () => {
    expect(pickEventPublishedAt(GLM_FLASH)).toEqual(
      new Date("2026-08-26T14:08:50Z"),
    );
  });

  it("成员乱序传入结果不变", () => {
    const shuffled = [
      GLM_FLASH[3],
      GLM_FLASH[0],
      GLM_FLASH[5],
      GLM_FLASH[1],
      GLM_FLASH[4],
      GLM_FLASH[2],
    ];
    expect(pickEventPublishedAt(shuffled)).toEqual(
      new Date("2026-08-26T14:08:50Z"),
    );
  });

  it("两簇平票不改锚（65 vs 65）", () => {
    const result = pickEventPublishedAt([
      at("2026-08-10T10:00:00Z", 65),
      at("2026-08-12T10:00:00Z", 65),
    ]);
    expect(result).toEqual(new Date("2026-08-10T10:00:00Z"));
  });

  it("差额未达 2 倍不改锚（72 vs 75）", () => {
    const result = pickEventPublishedAt([
      at("2026-08-21T10:00:00Z", 72),
      at("2026-08-23T10:00:00Z", 75),
    ]);
    expect(result).toEqual(new Date("2026-08-21T10:00:00Z"));
  });

  it("最大簇在中间时选中间那簇，不选最后一簇", () => {
    const result = pickEventPublishedAt([
      at("2026-08-14T10:00:00Z", 72),
      at("2026-08-16T10:00:00Z", 55),
      // 8/18：6 条 × 70 = 420
      ...Array.from({ length: 6 }, (_, i) => at(`2026-08-18T1${i}:00:00Z`, 70)),
      at("2026-08-22T10:00:00Z", 75),
      // 8/25：5 条 × 79 = 395，比 420 小
      ...Array.from({ length: 5 }, (_, i) => at(`2026-08-25T1${i}:00:00Z`, 79)),
    ]);
    expect(result).toEqual(new Date("2026-08-18T10:00:00Z"));
  });

  it("分数全为 NULL 时不因 base=0 滑到最后一簇", () => {
    const result = pickEventPublishedAt([
      at("2026-08-10T10:00:00Z", null),
      at("2026-08-12T10:00:00Z", null),
      at("2026-08-14T10:00:00Z", null),
    ]);
    // 三簇权重都是 FALLBACK_SCORE(60)，无一达到 2 倍门槛 → 留在第一簇
    expect(result).toEqual(new Date("2026-08-10T10:00:00Z"));
  });
});
