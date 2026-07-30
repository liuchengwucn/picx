// 跟踪参数黑名单：这些参数不影响内容身份，去掉后做去重哈希
const TRACKING_PARAM =
  /^(utm_\w+|ref|ref_\w+|source|fbclid|gclid|igshid|mc_cid|mc_eid|si)$/;

export function normalizeUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.protocol = "https:";
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  let result = u.toString();
  if (u.pathname !== "/" && !u.search && result.endsWith("/"))
    result = result.slice(0, -1);
  return result;
}

export async function hashUrl(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeUrl(url));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
