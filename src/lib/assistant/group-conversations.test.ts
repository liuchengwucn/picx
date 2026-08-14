import { describe, expect, it } from "vitest";
import {
  conversationTimeLabel,
  groupConversations,
} from "./group-conversations";

/** 2026-08-14 周五 15:00 本地时间 */
const NOW = new Date(2026, 7, 14, 15, 0, 0).getTime();
const DAY = 86_400_000;

function at(ts: number) {
  return { updatedAt: new Date(ts) };
}

describe("groupConversations", () => {
  it("空列表返回空数组", () => {
    expect(groupConversations([], NOW)).toEqual([]);
  });

  it("按今天 / 昨天 / 本周 / 月份分四组，顺序不变", () => {
    const groups = groupConversations(
      [
        at(NOW),
        at(NOW - DAY),
        at(NOW - 3 * DAY),
        at(new Date(2026, 6, 20, 10, 0, 0).getTime()),
      ],
      NOW,
    );

    expect(groups.map((g) => g.kind)).toEqual([
      "today",
      "yesterday",
      "week",
      "month",
    ]);
    expect(groups[3]?.key).toBe("2026-07");
    expect(groups[3]?.date).toEqual(new Date(2026, 6, 1));
  });

  it("同一个月的多条合并成一组", () => {
    const groups = groupConversations(
      [at(new Date(2026, 6, 20).getTime()), at(new Date(2026, 6, 3).getTime())],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("跨年的同名月份不会被并到一起", () => {
    const groups = groupConversations(
      [at(new Date(2026, 0, 5).getTime()), at(new Date(2025, 0, 5).getTime())],
      NOW,
    );

    expect(groups.map((g) => g.key)).toEqual(["2026-01", "2025-01"]);
  });

  it("未来时间戳落进今天", () => {
    const groups = groupConversations([at(NOW + 60_000)], NOW);
    expect(groups[0]?.kind).toBe("today");
  });

  it("今天零点整算今天，前一毫秒算昨天", () => {
    const midnight = new Date(2026, 7, 14, 0, 0, 0).getTime();
    const groups = groupConversations([at(midnight), at(midnight - 1)], NOW);
    expect(groups.map((g) => g.kind)).toEqual(["today", "yesterday"]);
  });

  it("本周下边界：恰好 6 天前算 week，7 天前算 month", () => {
    const weekStart = new Date(2026, 7, 8, 0, 0, 0).getTime(); // 6 天前本地零点
    const groups = groupConversations([at(weekStart), at(weekStart - 1)], NOW);
    expect(groups.map((g) => g.kind)).toEqual(["week", "month"]);
  });

  it("跨夏令时回拨（25 小时的一天）仍把「昨天」的会话分进 yesterday", () => {
    // process.env.TZ 在本 Node 版本下对之后新建的 Date 是即时生效的（已用
    // `node -e` 验证过），且 vitest 默认给每个测试文件独立的 worker/进程，
    // 不会污染其他文件；这里仍用 try/finally 显式复位，避免影响同文件里
    // 后续用例（它们依赖运行机器的本地时区，本机是 Asia/Shanghai，不实行 DST）。
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 2026-11-01 美东实行冬令时回拨（DST 结束），当天有 25 小时。
      // "今天" 定在次日 2026-11-02，用真实的月历日期减法算出的 yesterdayStart
      // 应该正好是 11-01 00:00 本地零点；如果退化成「减固定 24 小时」，
      // yesterdayStart 会晚 1 小时落在 11-01 01:00，导致 11-01 00:30 的会话
      // 被误判成不属于「昨天」（掉进下一档 week）。
      const dstNow = new Date(2026, 10, 2, 15, 0, 0).getTime();
      const justAfterFallBackMidnight = new Date(
        2026,
        10,
        1,
        0,
        30,
        0,
      ).getTime();

      const groups = groupConversations(
        [at(justAfterFallBackMidnight)],
        dstNow,
      );

      expect(groups[0]?.kind).toBe("yesterday");
    } finally {
      process.env.TZ = originalTz;
    }
  });
});

describe("conversationTimeLabel", () => {
  it("今天与昨天给 24 小时制时刻", () => {
    const ts = new Date(2026, 7, 14, 14, 2).getTime();
    expect(conversationTimeLabel(ts, "today", "en-US")).toBe("14:02");
    expect(conversationTimeLabel(ts, "yesterday", "en-US")).toBe("14:02");
  });

  it("本周给周几", () => {
    const ts = new Date(2026, 7, 11, 9, 0).getTime();
    expect(conversationTimeLabel(ts, "week", "en-US")).toBe("Tue");
  });

  it("更早给 MM-DD", () => {
    const ts = new Date(2026, 6, 28, 9, 0).getTime();
    expect(conversationTimeLabel(ts, "month", "en-US")).toBe("07-28");
  });
});
