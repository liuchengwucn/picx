/**
 * 解析 Accept 头, 判断客户端是否更想要 Markdown 而非 HTML。
 *
 * 仅当显式出现 text/markdown 且其权重 (q) 不低于 text/html 时返回 true。
 * 真实浏览器从不发送 text/markdown, 因此普通访问绝不会被命中; 这一层只服务
 * Claude / Cursor 等会主动声明 Accept: text/markdown 的 AI 客户端。
 */
function qualityOf(accept: string, mediaType: string): number | null {
  for (const part of accept.split(",")) {
    const [type, ...params] = part.trim().split(";");
    if (type.trim().toLowerCase() !== mediaType) continue;
    const q = params
      .map((p) => p.trim())
      .find((p) => p.toLowerCase().startsWith("q="));
    if (!q) return 1;
    const value = Number.parseFloat(q.slice(2));
    return Number.isNaN(value) ? 1 : value;
  }
  return null;
}

export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const md = qualityOf(accept, "text/markdown");
  if (md === null) return false;
  const html = qualityOf(accept, "text/html") ?? 0;
  return md >= html;
}
