// 跟踪参数黑名单：这些参数不影响内容身份，去掉后做去重哈希
const TRACKING_PARAM =
  /^(utm_\w+|ref|ref_\w+|source|fbclid|gclid|igshid|mc_cid|mc_eid|si)$/;

/** 归一化 URL 作为去重身份。注意：无效 URL 会抛 TypeError，调用方需逐条捕获（feed 里偶见坏链）。 */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.protocol = "https:";
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  if (u.pathname !== "/" && u.pathname.endsWith("/"))
    u.pathname = u.pathname.slice(0, -1);
  u.searchParams.sort();
  return u.toString();
}

/** 对归一化 URL 做 SHA-256；同样会因无效 URL 抛出 TypeError（见 normalizeUrl）。 */
export async function hashUrl(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeUrl(url));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
