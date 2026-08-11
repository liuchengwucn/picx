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
 * 段落级深链。?view=reader 让详情页直接落在原文视图（该参数已由 $shortId.tsx 的
 * validateSearch 支持，登录回跳也带着它），锚点写在 hash 里因此不会被服务端看到。
 */
export function paperQuoteUrl(shortId: string, anchor: string): string {
  return `${paperPageUrl(shortId)}?view=reader#${anchor}`;
}

/**
 * PDF 页级深链。引文内容由分享卡片的图承载，链接只负责把人送到那一页；刻意不带
 * 引文文本去做落地高亮——pdf.js 的文本匹配对断词连字符、ligature、跨页选区、双栏
 * 乱序都不可靠，落空后还得静默退化，收益不抵复杂度。
 */
export function paperPdfPageUrl(shortId: string, page: number): string {
  return `${paperPageUrl(shortId)}?view=pdf&page=${page}`;
}

/**
 * 解析 ?page=。非正整数一律丢弃（返回 undefined = 从第 1 页开始），别让手改 URL 的人
 * 把 initialPage 弄成 NaN/0/负数——那会让 PDFViewer 的 currentPageNumber 赋值抛错。
 */
export function parsePdfPageParam(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
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
