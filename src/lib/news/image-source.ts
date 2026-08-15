// 新闻封面图的取图口径：前端 <img src>、/api/news-image 代理端点、news cron 探活三方共用。
// 存在的理由：线上 84 条带 leadImage 的 story 里 57 条（68%）落在防盗链图床上，
// 浏览器直接从 picx.dev 加载必然 403，首页头条于是显示成一个空图框。
// Workers 的 fetch 可以自由设置 Referer（本地 workerd 实测有效），所以服务端代理能把这些图救回来。

/**
 * 防盗链主机 → 服务端取图时伪装的 Referer（用该站自己的主页）。
 *
 * 这份白名单同时是代理端点的 SSRF 边界：不在表里的主机一律拒绝代理，
 * 免得 /api/news-image 变成任人使唤的通用出网跳板。
 *
 * 注意 mmbiz.qpic.cn（微信图床）**故意不在表里**：它的防盗链是
 * 「200 + 2090 字节占位图」形态而不是 403，且**不带 Referer 时**才返回真图
 * （实测 276KB）。它直连就能拿到图，进白名单反而会被喂占位图。
 */
const HOTLINK_REFERERS: Record<string, string> = {
  "i.qbitai.com": "https://www.qbitai.com/",
  "image.jiqizhixin.com": "https://www.jiqizhixin.com/",
};

/**
 * 判定「图片可用」的最小字节数。
 * 由来：微信图床的防盗链占位图实测正好 2090B，状态码却是 200 + image/jpeg，
 * 只看状态码和 content-type 会把它当成好图。能当头条封面的真图不会小于 3KB。
 */
const MIN_IMAGE_BYTES = 3072;

// 图床响应慢于此就不值得等：头条封面缺一张不影响页面，cron 探活更不能被单张图拖垮
const FETCH_TIMEOUT_MS = 8_000;

/** 命中白名单则返回该主机要用的 Referer；URL 非法、非 https、或主机不在表里都返回 undefined。 */
function hotlinkReferer(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // 只代理 https：http 图在 picx.dev 上本就会被混合内容拦掉，代理它没有意义
  if (parsed.protocol !== "https:") return undefined;
  return HOTLINK_REFERERS[parsed.hostname.toLowerCase()];
}

/** 该 URL 是否必须经我们的代理取图（即：落在防盗链白名单主机上）。 */
export function needsImageProxy(url: string): boolean {
  return hotlinkReferer(url) !== undefined;
}

/** 前端 `<img src>` 用：白名单主机改走代理，其余原样直连（多绕一跳只会更慢更贵）。 */
export function displayImageUrl(url: string): string {
  if (!needsImageProxy(url)) return url;
  return `/api/news-image?u=${encodeURIComponent(url)}`;
}

/**
 * 服务端取图。代理端点与 cron 探活共用，保证「探活说能取到」和「用户真去取」行为一致。
 * 只有白名单主机才发 Referer——默认不发是有意的，见 {@link HOTLINK_REFERERS} 里微信图床那条。
 * URL 非法时 fetch 自身抛 TypeError，由调用方兜。
 */
export async function fetchNewsImage(url: string): Promise<Response> {
  const referer = hotlinkReferer(url);
  return fetch(url, {
    headers: referer ? { Referer: referer } : {},
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/**
 * 探活：2xx + content-type 为 image/* + 字节数 ≥ {@link MIN_IMAGE_BYTES}。
 * 任何异常（超时、DNS、非法 URL）都算失败——探活的语义是「确定能用」，存疑即淘汰。
 */
export async function probeNewsImage(url: string): Promise<boolean> {
  try {
    const response = await fetchNewsImage(url);
    if (!response.ok) return false;
    if (!response.headers.get("content-type")?.startsWith("image/")) {
      return false;
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 0) {
      // content-length 可信时直接判定，顺手取消 body 免得白下一张图
      await response.body?.cancel();
      return declared >= MIN_IMAGE_BYTES;
    }

    // 没有 content-length（chunked）时只能数字节，但读够阈值就立刻收手并 cancel：
    // 我们要的只是「够不够大」这一个 bit，没必要为一张 10MB 图付全量下载的时间和出网费。
    const reader = response.body?.getReader();
    if (!reader) return false;
    let bytes = 0;
    try {
      while (bytes < MIN_IMAGE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return bytes >= MIN_IMAGE_BYTES;
  } catch {
    return false;
  }
}
