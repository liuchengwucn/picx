import { paperPageUrl } from "./embed-code";

export const TWEET_HASHTAGS = "#MachineLearning #AI";

// t.co 把任意链接计为固定长度。
const TCO_LEN = 23;
const TWEET_MAX = 280;

interface CaptionInput {
  title: string;
  tldr: string;
  shortId: string;
}

/**
 * 拼接英文推文：
 *   {title}
 *
 *   {tldr}
 *
 *   🔗 Visual summary: {link}
 *
 *   {hashtags}
 * 超长时优先裁剪 tldr，再裁剪 title，保证含链接与 hashtag 后 ≤ 280（链接按 23 计）。
 */
export function buildTweetCaption(input: CaptionInput): string {
  const url = paperPageUrl(input.shortId);
  const linkLine = `🔗 Visual summary: ${url}`;
  // 固定部分（除标题/ tldr 外）的加权长度：linkLine 里 url 计 23。
  const linkLineWeighted = `🔗 Visual summary: ${"x".repeat(TCO_LEN)}`;

  const fixedWeighted =
    [...linkLineWeighted].length +
    [...TWEET_HASHTAGS].length +
    // 段落间空行：4 行(title/tldr/link/hashtags)之间有 3 个 "\n\n" = 6 字符（保守上界）
    6;

  const budget = TWEET_MAX - fixedWeighted;

  let title = input.title.trim();
  let tldr = input.tldr.trim();

  // 先给标题留至少 60，其余给 tldr；不够再砍标题。
  const titleBudget = Math.min(title.length, Math.max(60, budget - 0));
  if ([...title].length > titleBudget) {
    title = `${[...title].slice(0, Math.max(0, titleBudget - 1)).join("")}…`;
  }

  const remaining = budget - [...title].length;
  if (tldr && [...tldr].length > remaining) {
    tldr =
      remaining > 1 ? `${[...tldr].slice(0, remaining - 1).join("")}…` : "";
  }

  const lines = [title];
  if (tldr) lines.push(tldr);
  lines.push(linkLine);
  lines.push(TWEET_HASHTAGS);
  return lines.join("\n\n");
}
