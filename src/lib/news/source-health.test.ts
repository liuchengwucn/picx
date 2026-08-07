import { describe, expect, it } from "vitest";
import {
  MAX_PROBES_PER_ROUND,
  MAX_SOURCE_FAILURES,
  probeBackoffMs,
  selectFetchTargets,
  shouldProbe,
} from "./source-health";

const HOUR = 60 * 60_000;
const NOW = Date.UTC(2026, 7, 7, 12, 0, 0);

function source(overrides: {
  enabled?: boolean;
  consecutiveFailures?: number;
  lastAttemptAt?: Date | null;
}) {
  return {
    enabled: overrides.enabled ?? false,
    consecutiveFailures: overrides.consecutiveFailures ?? MAX_SOURCE_FAILURES,
    lastAttemptAt: overrides.lastAttemptAt ?? null,
  };
}

describe("probeBackoffMs", () => {
  it("熔断当次退避 1 小时，之后逐次翻倍", () => {
    expect(probeBackoffMs(MAX_SOURCE_FAILURES)).toBe(HOUR);
    expect(probeBackoffMs(MAX_SOURCE_FAILURES + 1)).toBe(2 * HOUR);
    expect(probeBackoffMs(MAX_SOURCE_FAILURES + 2)).toBe(4 * HOUR);
    expect(probeBackoffMs(MAX_SOURCE_FAILURES + 3)).toBe(8 * HOUR);
  });

  it("封顶 24 小时，不随失败次数无限增长", () => {
    expect(probeBackoffMs(MAX_SOURCE_FAILURES + 5)).toBe(24 * HOUR);
    expect(probeBackoffMs(MAX_SOURCE_FAILURES + 100)).toBe(24 * HOUR);
    // 2 ** overshoot 在极端值下会溢出为 Infinity，Math.min 必须仍给出封顶值
    expect(probeBackoffMs(5000)).toBe(24 * HOUR);
  });

  it("未熔断时无意义，返回 0", () => {
    expect(probeBackoffMs(0)).toBe(0);
    expect(probeBackoffMs(MAX_SOURCE_FAILURES - 1)).toBe(0);
  });
});

describe("shouldProbe", () => {
  it("健康源永不探活", () => {
    expect(shouldProbe(source({ enabled: true }), NOW)).toBe(false);
    // 即使失败计数已到阈值（同一轮里刚被写回但还没熔断的竞态），enabled 为真就不探活
    expect(
      shouldProbe(
        source({ enabled: true, consecutiveFailures: MAX_SOURCE_FAILURES }),
        NOW,
      ),
    ).toBe(false);
  });

  it("人为停用的源永不被唤醒（失败计数为 0）", () => {
    expect(
      shouldProbe(
        source({ enabled: false, consecutiveFailures: 0, lastAttemptAt: null }),
        NOW,
      ),
    ).toBe(false);
  });

  it("失败次数未达熔断阈值的停用源也不唤醒", () => {
    expect(
      shouldProbe(
        source({
          enabled: false,
          consecutiveFailures: MAX_SOURCE_FAILURES - 1,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("改造前熔断的存量源（无 lastAttemptAt）立即探活", () => {
    expect(shouldProbe(source({ lastAttemptAt: null }), NOW)).toBe(true);
  });

  it("退避未到不探活，到点即探活", () => {
    const justTripped = source({
      consecutiveFailures: MAX_SOURCE_FAILURES,
      lastAttemptAt: new Date(NOW - 59 * 60_000),
    });
    expect(shouldProbe(justTripped, NOW)).toBe(false);

    const due = source({
      consecutiveFailures: MAX_SOURCE_FAILURES,
      lastAttemptAt: new Date(NOW - HOUR),
    });
    expect(shouldProbe(due, NOW)).toBe(true);
  });

  it("失败越多退避越长：4 小时前的尝试对第 12 次失败不够", () => {
    const attemptedAt = new Date(NOW - 4 * HOUR);
    expect(
      shouldProbe(
        source({
          consecutiveFailures: MAX_SOURCE_FAILURES + 1,
          lastAttemptAt: attemptedAt,
        }),
        NOW,
      ),
    ).toBe(true);
    expect(
      shouldProbe(
        source({
          consecutiveFailures: MAX_SOURCE_FAILURES + 3,
          lastAttemptAt: attemptedAt,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("死源封顶后每 24 小时探活一次", () => {
    const failures = MAX_SOURCE_FAILURES + 50;
    expect(
      shouldProbe(
        source({
          consecutiveFailures: failures,
          lastAttemptAt: new Date(NOW - 23 * HOUR),
        }),
        NOW,
      ),
    ).toBe(false);
    expect(
      shouldProbe(
        source({
          consecutiveFailures: failures,
          lastAttemptAt: new Date(NOW - 24 * HOUR),
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("selectFetchTargets", () => {
  const healthy = (id: string) => ({
    id,
    enabled: true,
    consecutiveFailures: 0,
    lastAttemptAt: null,
  });
  const tripped = (
    id: string,
    hoursAgo: number,
    failures = MAX_SOURCE_FAILURES,
  ) => ({
    id,
    enabled: false,
    consecutiveFailures: failures,
    lastAttemptAt: new Date(NOW - hoursAgo * HOUR),
  });

  it("健康源全部入选，探活排在最后", () => {
    const { targets, probes } = selectFetchTargets(
      [tripped("dead", 5), healthy("a"), healthy("b")],
      NOW,
    );
    expect(targets.map((s) => s.id)).toEqual(["a", "b", "dead"]);
    expect(probes.map((s) => s.id)).toEqual(["dead"]);
  });

  it("退避未到的熔断源不入选", () => {
    const { targets, probes } = selectFetchTargets(
      [healthy("a"), tripped("recent", 0.5)],
      NOW,
    );
    expect(targets.map((s) => s.id)).toEqual(["a"]);
    expect(probes).toHaveLength(0);
  });

  it("探活数量受上限约束，健康源不受影响", () => {
    const many = Array.from({ length: MAX_PROBES_PER_ROUND + 4 }, (_, i) =>
      tripped(`dead-${i}`, 48),
    );
    const { targets, probes } = selectFetchTargets(
      [...many, healthy("a"), healthy("b")],
      NOW,
    );
    expect(probes).toHaveLength(MAX_PROBES_PER_ROUND);
    expect(targets).toHaveLength(2 + MAX_PROBES_PER_ROUND);
    expect(targets.slice(0, 2).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("没有熔断源时行为与改造前一致", () => {
    const { targets, probes } = selectFetchTargets(
      [healthy("a"), healthy("b")],
      NOW,
    );
    expect(targets.map((s) => s.id)).toEqual(["a", "b"]);
    expect(probes).toHaveLength(0);
  });
});
