import { describe, expect, it } from "vitest";
import {
  pickDateOnlyOffsets,
  refineFeedPublishedAt,
  refinePublishedAt,
} from "./published-at";

const HOUR = 3_600_000;
const UTC_MIDNIGHT = 0;
const CST_MIDNIGHT = 16 * 3600; // 北京时间零点在 UTC 时间轴上的位置

/** 生成 n 条同一日内秒偏移、逐日递减的发布时间 */
const stamps = (offsetSec: number, n: number, fromDay = "2026-08-27") => {
  const base = Date.parse(`${fromDay}T00:00:00Z`) + offsetSec * 1000;
  return Array.from({ length: n }, (_, i) => new Date(base - i * 24 * HOUR));
};
/** 生成 n 条时分秒各不相同的发布时间（真实时间戳的形状） */
const scattered = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => new Date(Date.parse("2026-08-27T00:00:00Z") - i * 3_671_000),
  );

const refine = (published: string, fetched: string, offsets: number[]) =>
  refinePublishedAt(
    new Date(published),
    new Date(fetched),
    new Set(offsets),
  ).toISOString();

describe("pickDateOnlyOffsets", () => {
  // src-anthropic-news 的镜像 feed：活取 258 条全是 `00:00:00 +0000`
  it("整个 feed 都落在同一零点时命中该偏移", () => {
    expect(pickDateOnlyOffsets(stamps(UTC_MIDNIGHT, 12))).toEqual(
      new Set([UTC_MIDNIGHT]),
    );
  });

  // src-techcrunch-ai（20 条 20 个不同值）/ src-verge-ai（10 条 10 个值）：最高峰只有 5%~10%
  it("时分秒各不相同的真实时间戳一个都不命中", () => {
    expect(pickDateOnlyOffsets(scattered(20))).toEqual(new Set());
  });

  // src-metr 活 feed：07:00Z 占 44%、08:00Z 占 24%，分别是 PDT 与 PST 的零点
  it("夏令时切换造成的两个峰都要命中，不能只取众数", () => {
    const offsets = pickDateOnlyOffsets([
      ...stamps(7 * 3600, 42),
      ...stamps(8 * 3600, 23, "2026-02-01"),
      ...scattered(31),
    ]);
    expect(offsets).toEqual(new Set([7 * 3600, 8 * 3600]));
  });

  // src-openai-blog 活 feed 1155 条：00:00Z 29%（补的零点）、07:00Z 20%（PDT 零点）、
  // 10:00Z 13%（真实定时发布）。同一个源三种性质并存，10:00Z 必须落在阈值外。
  it("混合源只命中过阈值的峰，真实定时发布不受影响", () => {
    const offsets = pickDateOnlyOffsets([
      ...stamps(UTC_MIDNIGHT, 330),
      ...stamps(10 * 3600, 152),
      ...scattered(442),
    ]);
    expect(offsets).toEqual(new Set([UTC_MIDNIGHT]));
  });

  it("只出现一次的偏移不算证据，哪怕在小 feed 里占比很高", () => {
    expect(
      pickDateOnlyOffsets([...stamps(CST_MIDNIGHT, 1), ...scattered(2)]),
    ).toEqual(new Set());
  });

  it("空输入返回空集", () => {
    expect(pickDateOnlyOffsets([])).toEqual(new Set());
  });
});

describe("refinePublishedAt", () => {
  // 生产条目 fuyvpu（腾讯混元 "Introducing Hy4 preview"）：RSSHub 出的 pubDate 是
  // `Thu, 27 Aug 2026 16:00:00 GMT` = 北京时间 8/28 零点，我们当天下午才抓到。
  // 修正前页面显示「15 小时前」，同一条在别处显示「十几分钟前」。
  it("把源时区零点修正为首次抓到的时刻", () => {
    expect(
      refine("2026-08-27T16:00:00Z", "2026-08-28T06:01:27Z", [CST_MIDNIGHT]),
    ).toBe("2026-08-28T06:01:27.000Z");
  });

  it("抓到时那天已经过完则退回当日末尾，不拉到今天", () => {
    expect(
      refine("2026-08-20T00:00:00Z", "2026-08-28T06:00:00Z", [UTC_MIDNIGHT]),
    ).toBe("2026-08-20T23:59:59.000Z");
  });

  it("同一条重复修正结果不变（幂等）", () => {
    const once = refine("2026-08-27T16:00:00Z", "2026-08-28T06:01:27Z", [
      CST_MIDNIGHT,
    ]);
    expect(refine(once, "2026-08-28T06:01:27Z", [CST_MIDNIGHT])).toBe(once);
  });

  // 误报回归：dry-run 里 src-openai-blog 的 09:00Z 与 src-zhipu-news 的 14:00Z
  // 都是真实发布时间（feed 自身延迟数小时才更新），不在各自源的零点偏移集合里
  it("落在源零点偏移之外的整点时间戳不动，哪怕滞后很久", () => {
    expect(
      refine("2026-08-27T09:00:00Z", "2026-08-27T17:00:30Z", [UTC_MIDNIGHT]),
    ).toBe("2026-08-27T09:00:00.000Z");
  });

  it("命中偏移但当轮就抓到的不动", () => {
    expect(
      refine("2026-08-28T00:00:00Z", "2026-08-28T00:30:00Z", [UTC_MIDNIGHT]),
    ).toBe("2026-08-28T00:00:00.000Z");
  });

  it("滞后恰好达到 3h 阈值即修正，差一秒则不动", () => {
    expect(
      refine("2026-08-28T00:00:00Z", "2026-08-28T03:00:00Z", [UTC_MIDNIGHT]),
    ).toBe("2026-08-28T03:00:00.000Z");
    expect(
      refine("2026-08-28T00:00:00Z", "2026-08-28T02:59:59Z", [UTC_MIDNIGHT]),
    ).toBe("2026-08-28T00:00:00.000Z");
  });

  // rss.ts 的未来钳制漏网时（hunyuan 路由确实出过一条 2027 年的 pubDate）不能倒着改
  it("发布时间晚于抓取时刻时原样返回", () => {
    expect(
      refine("2027-08-05T16:00:00Z", "2026-08-06T07:01:27Z", [CST_MIDNIGHT]),
    ).toBe("2027-08-05T16:00:00.000Z");
  });
});

describe("refineFeedPublishedAt", () => {
  it("整批 feed 上定偏移后逐条修正，未命中的条目保持同一对象", () => {
    const fetchedAt = new Date("2026-08-28T06:00:00Z");
    const items = [
      ...stamps(CST_MIDNIGHT, 4).map((publishedAt) => ({ publishedAt })),
      { publishedAt: new Date("2026-08-27T02:00:00Z") },
      ...scattered(3).map((publishedAt) => ({ publishedAt })),
    ];
    const out = refineFeedPublishedAt(items, fetchedAt);

    // 最近一条 8/27 16:00Z 命中且当天还没过完 → 修正为抓取时刻
    expect(out[0].publishedAt.toISOString()).toBe("2026-08-28T06:00:00.000Z");
    // 更早的几条那天已经过完 → 退回当日末尾。注意「当日」是源时区的一天，
    // 8/26 16:00Z 起的一天末尾落在 UTC 的 8/27——修正结果不会离开源那边的 8/27
    expect(out[1].publishedAt.toISOString()).toBe("2026-08-27T15:59:59.000Z");
    // 02:00Z 不在偏移集合里，对象原样透传
    expect(out[4]).toBe(items[4]);
    expect(out).toHaveLength(items.length);
  });

  it("真实时间戳的 feed 整批原样返回", () => {
    const items = scattered(20).map((publishedAt) => ({ publishedAt }));
    expect(refineFeedPublishedAt(items, new Date("2026-08-28T06:00:00Z"))).toBe(
      items,
    );
  });
});
