import { paperPageUrl } from "./embed-code";

// t.co 把任意链接计为固定长度。
const TCO_LEN = 23;
const TWEET_MAX = 280;

interface CaptionInput {
  tldr: string;
  shortId: string;
}

/**
 * 英文推文正文 = tldr + 链接：
 *   {tldr}
 *
 *   {link}
 * 标题不放正文（X 链接卡片会显示 og:title），也不加 hashtag，以省字数、更干净。
 * tldr 过长时截断加 …，保证含链接后 ≤ 280（链接按 23 计；tldr 为英文，按 code point 计长）。
 */
export function buildTweetCaption(input: CaptionInput): string {
  // X 对裸域名一样会转 t.co 并抓 og:image 出卡片；去掉 https:// 显示更干净。
  // t.co 无论带不带 scheme 均计 23 字符，故预算计算不变。
  const url = paperPageUrl(input.shortId).replace(/^https?:\/\//, "");
  // 链接计 23，与 tldr 之间一个空行 "\n\n" 计 2。
  const budget = TWEET_MAX - TCO_LEN - 2;

  let tldr = input.tldr.trim();
  if ([...tldr].length > budget) {
    tldr = `${[...tldr].slice(0, budget - 1).join("")}…`;
  }

  return tldr ? `${tldr}\n\n${url}` : url;
}
