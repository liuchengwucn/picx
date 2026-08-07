/**
 * 来源熔断与自愈。
 *
 * 抓取连续失败达到 MAX_SOURCE_FAILURES 即熔断（enabled=false），此后不再每轮空转，
 * 改为按指数退避周期性探活；探活成功即自动恢复（enabled=true、失败计数归零）。
 *
 * 为什么需要自愈：熔断原本是永久的，而 fetch 只遍历 enabled=1 的源，
 * 于是上游一次短暂抖动（实测量子位 RSSHub 连续 503）就会让来源永久停摆，只能人工复位。
 *
 * 为什么不能无脑唤醒所有 enabled=0 的源：enabled 这一位同时承载「人为停用」和「故障熔断」
 * 两种语义。判据是失败计数——人为停用的源 consecutiveFailures 为 0，永远不满足探活条件。
 */

/** 连续失败达到此值即熔断。达到后不再增长 enabled，转入探活。 */
export const MAX_SOURCE_FAILURES = 10;

/** 每轮最多探活几个熔断源：探活走完整抓取，死源要吃满 60s 超时，不能让它们挤占健康源的预算。 */
export const MAX_PROBES_PER_ROUND = 3;

const PROBE_BASE_MS = 60 * 60_000;
const PROBE_MAX_MS = 24 * 60 * 60_000;

export type SourceHealth = {
  enabled: boolean;
  consecutiveFailures: number;
  lastAttemptAt: Date | null;
};

/**
 * 熔断后第 n 次探活的间隔：1h、2h、4h…封顶 24h。
 *
 * 上游抖动最多损失 1 小时；真死源一天才空转一次——比「永不重试」和「每轮重试」都划算。
 * 未熔断时返回 0（无意义，调用方不会用到）。
 */
export function probeBackoffMs(consecutiveFailures: number): number {
  const overshoot = consecutiveFailures - MAX_SOURCE_FAILURES;
  if (overshoot < 0) return 0;
  return Math.min(PROBE_BASE_MS * 2 ** overshoot, PROBE_MAX_MS);
}

/** 熔断源是否到了该探活的时刻。仅对熔断源为真，健康源与人为停用的源恒为假。 */
export function shouldProbe(source: SourceHealth, now: number): boolean {
  if (source.enabled) return false;
  if (source.consecutiveFailures < MAX_SOURCE_FAILURES) return false;
  // 本次改造之前熔断的源没有 lastAttemptAt，立刻探活一次而不是干等一个退避周期
  if (!source.lastAttemptAt) return true;
  return (
    now - source.lastAttemptAt.getTime() >=
    probeBackoffMs(source.consecutiveFailures)
  );
}

/**
 * 把候选源排成本轮的抓取顺序：健康源在前，到点的熔断源探活在后。
 *
 * 顺序不是美观问题：死源要吃满 60s 超时，而 fetch 循环在超预算时会 break，
 * 探活排前面就可能把健康源挤出本轮。探活数量同样要设上限。
 *
 * 入参是「enabled=1 或 失败计数已达阈值」的候选集（人为停用的源不在其中）。
 */
export function selectFetchTargets<T extends SourceHealth>(
  candidates: T[],
  now: number,
): { targets: T[]; probes: T[] } {
  const probes = candidates
    .filter((source) => shouldProbe(source, now))
    .slice(0, MAX_PROBES_PER_ROUND);
  const healthy = candidates.filter((source) => source.enabled);
  return { targets: [...healthy, ...probes], probes };
}
