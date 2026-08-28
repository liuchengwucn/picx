/**
 * 修正「日期粒度」的发布时间。
 *
 * 不少源的 feed 只提供日期、不提供时分秒，生成 feed 的一方会把缺失的时间补成当日
 * 零点：Anthropic 的镜像 feed 258 条全是 `00:00:00 +0000`；RSSHub 的腾讯混元路由
 * 出的是 `16:00:00 GMT`（= 北京时间当日零点）。照单全收的话，一条当天上午发布、
 * 我们当天下午抓到的新闻会被记成「15 小时前」，而它在站内其他口径下才刚出现。
 *
 * 判据为什么不看原始字符串：RSSHub 已经把源时区的零点换算成 GMT 输出，字符串里
 * 根本没有 `00:00:00`，只有 `16:00:00 GMT`——看字符串会漏掉整类中文源。
 *
 * 判据为什么不能只看单条：「落在某个时区的零点上」等价于「落在整点上」（整小时
 * 时区偏移覆盖了全部 24 个整点），而整点发稿很常见。实测 src-openai-blog 的
 * `09:00Z` 与 src-zhipu-news 的 `14:00Z` 都是真实发布时间，只是 feed 本身延迟了
 * 几小时才更新，单条判据会把它们一并改写。
 *
 * 判据为什么不能按源一刀切：src-openai-blog 是混合的——活 feed 1155 条里
 * `00:00Z` 占 29%（补的零点）、`07:00Z` 占 20%（= PDT 零点）、`10:00Z` 占 13%
 * （真实定时发布），同一个源三种性质并存。
 *
 * 于是判据落在「源 × 日内秒偏移」这一格上：同一个偏移在该源反复出现才算补的零点。
 * 实测这条线分得很开——日期粒度源的峰占 29%~100%，而 src-techcrunch-ai /
 * src-verge-ai 这类真实时间源的最高峰只有 5%~10%。
 */

// 峰占比阈值。实测间隔：真日期粒度源 ≥29%（openai 00:00Z），真实时间源 ≤10%
// （verge 最高峰）。取 20% 落在间隔中间，两侧都有一倍以上余量。
export const DATE_ONLY_MODE_RATIO = 0.2;

// 峰的最小出现次数。只出现一次的偏移在小 feed 里能轻易冲上 20%（3 条的 feed 里
// 一条就是 33%），而「同一秒偏移反复出现」才是补零点的证据本身。
export const DATE_ONLY_MODE_MIN_COUNT = 2;

// 时区偏移最细到 30 分钟（+5:30 印度、+9:30 澳洲中部……），所以任何时区的当日零点
// 落在 UTC 时间轴上必然是 1800s 的整倍数。纯粹兜底：挡住「某源真实时间戳碰巧高度
// 集中在某个非整点值」这种怪形状。
export const DATE_ONLY_GRID_MS = 30 * 60 * 1000;

// 第二道防线：cron 每小时一轮，一条真实的新条目从发布到被抓到通常不到 1 小时。
// 滞后不足该值时时分秒多半是真的（也没什么可修的，差几分钟而已），一律不动。
export const DATE_ONLY_MIN_LAG_MS = 3 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const secOfDay = (date: Date) => {
  const sec = Math.floor(date.getTime() / 1000) % 86_400;
  return sec < 0 ? sec + 86_400 : sec;
};

/**
 * 从同一个源的一批发布时间里，找出「被当作当日零点」的日内秒偏移。
 *
 * 一个源可能有多个：src-metr 的 `07:00Z`（44%）与 `08:00Z`（24%）分别是 PDT 与
 * PST 的零点，夏令时切换让同一个源同时存在两个峰——所以取全部过阈值的偏移，
 * 而不是单一众数。
 *
 * 样本可以是一轮抓到的 feed，也可以是库里该源的存量条目；两边用同一个函数，
 * 回填选出的候选集才和线上写入判据一致。
 */
export function pickDateOnlyOffsets(published: Date[]): Set<number> {
  const counts = new Map<number, number>();
  for (const date of published) {
    if (date.getTime() % DATE_ONLY_GRID_MS !== 0) continue;
    const key = secOfDay(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const offsets = new Set<number>();
  // 分母是该源的全部条目（含非整点的），否则一个只有两条整点条目的源会 100% 命中
  const total = published.length;
  if (total === 0) return offsets;
  for (const [offset, count] of counts) {
    if (
      count >= DATE_ONLY_MODE_MIN_COUNT &&
      count / total >= DATE_ONLY_MODE_RATIO
    ) {
      offsets.add(offset);
    }
  }
  return offsets;
}

/**
 * 日期粒度的时间戳修正为首次抓到的时刻，其余原样返回。
 *
 * 不需要知道源在哪个时区：零点本身就是那一天的起点，所以 [publishedAt,
 * publishedAt + 1 天) 正是这个时间戳唯一可信的那一天。真实发布时间必落在其中，
 * 而首次抓到的时刻是这段区间里最好的估计（误差 ≤ 一个轮询间隔，而不是 24 小时）。
 * 抓到时那天已经过完（源延迟收录的旧条目）就退回当日末尾——此时无从推断，保留
 * 原本那一天比拉到今天更诚实，分日分组也不会跑到别的日期去。
 *
 * fetchedAt 必须是**首次**入库时刻：摄入侧靠 urlHash onConflictDoNothing 保证
 * fetched_at 只写一次，重复命中的条目不会被反复往后推。
 */
export function refinePublishedAt(
  publishedAt: Date,
  fetchedAt: Date,
  offsets: Set<number>,
): Date {
  if (!offsets.has(secOfDay(publishedAt))) return publishedAt;
  if (publishedAt.getTime() % DATE_ONLY_GRID_MS !== 0) return publishedAt;
  if (fetchedAt.getTime() - publishedAt.getTime() < DATE_ONLY_MIN_LAG_MS) {
    return publishedAt;
  }
  const dayEnd = publishedAt.getTime() + DAY_MS - 1000;
  return new Date(Math.min(fetchedAt.getTime(), dayEnd));
}

/**
 * 对一轮抓到的整个 feed 做修正：先在这批条目上定出该源的零点偏移，再逐条修正。
 *
 * 样本就是本轮 feed（parseFeed 截断到最近 50 条）。源改用真实时间戳后，最近 50
 * 条里的零点占比自然掉到阈值以下，判据随之失效——这是想要的自适应行为。
 */
export function refineFeedPublishedAt<T extends { publishedAt: Date }>(
  items: T[],
  fetchedAt: Date,
): T[] {
  const offsets = pickDateOnlyOffsets(items.map((i) => i.publishedAt));
  if (offsets.size === 0) return items;
  return items.map((item) => {
    const publishedAt = refinePublishedAt(item.publishedAt, fetchedAt, offsets);
    return publishedAt === item.publishedAt ? item : { ...item, publishedAt };
  });
}
