import type { StorySignalsSummary } from "#/db/schema";

export interface SignalInput {
  url: string;
  author: string | null;
  signals: Record<string, number> | null;
  extra: Record<string, unknown> | null;
  sourceType: "rss" | "rsshub" | "hn";
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

  // HN：取 points 最高的一条(同一 story 可能被多次提交)
  let best: { points: number; comments: number; url: string } | undefined;
  for (const item of items) {
    if (item.sourceType !== "hn") continue;
    const points = item.signals?.points ?? 0;
    const hnUrl =
      typeof item.extra?.hnUrl === "string" ? item.extra.hnUrl : null;
    if (hnUrl && (!best || points > best.points)) {
      best = { points, comments: item.signals?.comments ?? 0, url: hnUrl };
    }
  }
  if (best) summary.hn = best;

  const xAuthors = new Set(
    items
      .filter((i) => i.sourceType === "rsshub" && i.author)
      .map((i) => i.author as string),
  );
  if (xAuthors.size > 0) summary.xAccounts = xAuthors.size;

  return summary;
}
