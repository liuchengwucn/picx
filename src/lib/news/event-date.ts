export interface BurstMember {
  publishedAt: Date;
  relevanceScore: number | null;
}

// 相邻两条成员间隔超过该值即断成新簇。按间隔切而不是按自然日：GLM-5.3-Flash 那一簇
// 落在 UTC 14:08–16:01 = 北京时间 22:08 至次日 00:01，按自然日会被午夜切成 4+1，
// 且答案随访客时区变化（分日本来就是在客户端按访客时区做的）。
export const BURST_GAP_HOURS = 24;

// 后续簇权重达到首簇的该倍数才改锚。生产 108 条多条目 story 上，1.5 / 2 / 2.5 三个取值
// 结果完全一致（同样 7 条换日），不是刀刃参数；完全不设门槛则 23 条换日，其中大半是
// 「1条65分 vs 1条65分」这种平票抖动——不是二次爆发，改锚只是白白改写历史归档。
export const DOMINANCE_FACTOR = 2;

// relevanceScore 为 NULL 时的兜底权重（接近入选阈值）。纯防御：若整簇分数为 NULL 导致
// base = 0，`w >= base * DOMINANCE_FACTOR` 会恒真、一路改锚到最后一簇。
export const FALLBACK_SCORE = 60;

const GAP_MS = BURST_GAP_HOURS * 60 * 60 * 1000;

/**
 * 按 BURST_GAP_HOURS 把（已按时间排序或未排序的）成员切成簇：相邻两条间隔超过
 * GAP_MS 即断成新簇。空输入返回 []。
 */
export function splitBursts(members: BurstMember[]): BurstMember[][] {
  if (members.length === 0) return [];

  const sorted = [...members].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime(),
  );

  const bursts: BurstMember[][] = [];
  let current: BurstMember[] = [];
  let prev: BurstMember | null = null;
  for (const member of sorted) {
    if (
      prev &&
      member.publishedAt.getTime() - prev.publishedAt.getTime() > GAP_MS
    ) {
      bursts.push(current);
      current = [];
    }
    current.push(member);
    prev = member;
  }
  bursts.push(current);
  return bursts;
}

export function weightOf(burst: BurstMember[]): number {
  const sum = burst.reduce(
    (acc, m) => acc + (m.relevanceScore ?? FALLBACK_SCORE),
    0,
  );
  // 下限 1：与 FALLBACK_SCORE 一起构成 base = 0 的双保险
  return Math.max(1, sum);
}

/**
 * story 的事件锚点 = 主导报道簇的起始时间。
 *
 * 为什么不是「最早成员发布时间」：一条几天前的前置报道（传闻、同话题旧闻、聚类误判）
 * 会把整条 story 钉死在起源日。而聚类窗口是滚动的（有新成员就续期），所以持续发酵的
 * 话题永远回不到近几天的视图里。生产案例 7ye5bB：1 条 8/23 的前置报道 + 5 条 8/26 的
 * 发布报道，整条被归到 8/23。
 *
 * 为什么不是「最新成员发布时间」：会把「事件当天 + 次日跟进解读」这种更常见的形状
 * 拖到次日，且长尾话题每天重回今日、霸占当天头条位。
 *
 * 算法：按 BURST_GAP_HOURS 切簇 → 簇权重取 Σ 分数 → 后续簇权重达到首簇
 * DOMINANCE_FACTOR 倍才改锚（并列取更晚的簇）→ 返回所选簇首条的发布时间。
 *
 * 调用方不必预排序。members 为空返回 null。
 *
 * 两条已知边界：
 * 1. 锚点不再单调。旧的 MIN 语义只减不增，新语义两个方向都能动——一条更早的条目
 *    在 72h 聚类窗口内后到，可能把锚点拉回更早的簇，已经出现在「今日」的 story
 *    会退回旧日期。同输入结果恒定，属算法性质而非缺陷。
 * 2. 只修「有 >24h 静默期 + 后续 ≥2× 尖峰」这一类。均匀滚动报道修不了：
 *    每 20h 一条会合成单簇、每 30h 一条会切成一串等权簇，都锚在第一天。
 */
export function pickEventPublishedAt(members: BurstMember[]): Date | null {
  if (members.length === 0) return null;

  const bursts = splitBursts(members);

  const first = bursts[0];
  const base = weightOf(first);
  let best = first;
  let bestWeight = base;
  for (const burst of bursts.slice(1)) {
    const weight = weightOf(burst);
    // >= bestWeight：权重并列时取更晚的簇（以最近一次压倒性爆发为准）
    if (weight >= base * DOMINANCE_FACTOR && weight >= bestWeight) {
      best = burst;
      bestWeight = weight;
    }
  }
  return best[0].publishedAt;
}
