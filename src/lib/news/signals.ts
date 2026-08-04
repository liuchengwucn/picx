import type { StorySignalsSummary } from "#/db/schema";

export interface SignalInput {
  url: string;
  author: string | null;
  signals: Record<string, number> | null;
  extra: Record<string, unknown> | null;
}

const MAX_DOMAINS = 8;

/** 从成员 items 汇总 story 的展示信号。按平台分开呈现，不折算成单一分数。 */
export function buildSignalsSummary(items: SignalInput[]): StorySignalsSummary {
  const domains: string[] = [];
  for (const item of items) {
    try {
      const host = new URL(item.url).hostname.replace(/^www\./, "");
      if (!domains.includes(host)) domains.push(host);
    } catch {
      // 忽略坏 URL
    }
  }

  const summary: StorySignalsSummary = {
    domains: domains.slice(0, MAX_DOMAINS),
  };

  // HN：取 points 最高的一条(同一 story 可能被多次提交)。
  // 按 extra.hnUrl 判定而非 sourceType='hn'：HN 帖与 RSS 条目常共享同一 canonical URL，
  // urlHash 去重后行可能挂在 rss 来源上，只有 extra 里的 hnUrl 才是 HN 身份的可靠标记。
  let best: { points: number; comments: number; url: string } | undefined;
  for (const item of items) {
    const points = item.signals?.points ?? 0;
    const hnUrl =
      typeof item.extra?.hnUrl === "string" ? item.extra.hnUrl : null;
    if (hnUrl && (!best || points > best.points)) {
      best = { points, comments: item.signals?.comments ?? 0, url: hnUrl };
    }
  }
  if (best) summary.hn = best;

  // 与 hnUrl 同理按 extra.isTweet 判定而非来源类型：rsshub 类型也承载博客路由，
  // 且跨源 URL 去重后推文行可能挂在其他来源上，extra 标记才是可靠身份
  const xAuthors = new Set(
    items
      .filter((i) => i.extra?.isTweet === true && i.author)
      .map((i) => i.author as string),
  );
  if (xAuthors.size > 0) summary.xAccounts = xAuthors.size;

  return summary;
}
