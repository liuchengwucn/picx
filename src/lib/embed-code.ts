import { SITE_URL } from "#/lib/site-url";

/**
 * HTML-escape so paper titles can't break the embed snippet.
 * Escapes for both element text and single/double-quoted attribute values.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function paperPageUrl(shortId: string): string {
  return `${SITE_URL}/p/${shortId}`;
}

export function paperImageUrl(shortId: string): string {
  return `${SITE_URL}/p/${shortId}/image`;
}

/**
 * 生成带回链的嵌入代码: 图片包在指向论文页的 <a> 里, 锚文本/alt 固定英文 + 动态标题,
 * 第三方贴出去即自带指向 picx.dev 的反链。
 */
export function buildEmbedCode(shortId: string, title: string): string {
  const pageUrl = paperPageUrl(shortId);
  const imageUrl = paperImageUrl(shortId);
  const alt = `${escapeHtml(title)} — Visual whiteboard summary by PicX`;
  return `<a href="${pageUrl}">
  <img src="${imageUrl}" alt="${alt}" style="max-width:100%;height:auto" />
</a>
<p>Visual summary via <a href="${SITE_URL}">PicX</a></p>`;
}

export interface SocialShareLinks {
  twitter: string;
  weibo: string;
  reddit: string;
}

export function buildSocialShareLinks(
  shortId: string,
  title: string,
): SocialShareLinks {
  const url = encodeURIComponent(paperPageUrl(shortId));
  const text = encodeURIComponent(title);
  return {
    twitter: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
    weibo: `https://service.weibo.com/share/share.php?url=${url}&title=${text}`,
    reddit: `https://www.reddit.com/submit?url=${url}&title=${text}`,
  };
}
