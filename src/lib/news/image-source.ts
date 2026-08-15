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

/**
 * 允许下发的图片 MIME 白名单——**必须是枚举而不是 `image/*` 前缀匹配**。
 * image/svg+xml 是可执行文档：图床（尤其 jiqizhixin 这种 UGC 平台）上传一个 svg，
 * 用户顶层导航打开 /api/news-image?u=…evil.svg 时脚本就跑在 picx.dev 自己的 origin 上，
 * 同源 cookie 与 better-auth session 全在射程内。
 */
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

// 探活可以慢慢来但不能被单张图拖垮（cron 一轮要探几十张）；
// 代理是用户在等的实时请求，超时会**从中间掐断 body**（实测：signal 在收到
// headers 之后仍然会切流），给出半张图，所以必须留够慢源下载大图的时间。
const PROBE_TIMEOUT_MS = 8_000;
export const PROXY_TIMEOUT_MS = 30_000;

// 跟随重定向的跳数上限。每一跳都要重新过白名单，所以循环必须自己写（见 fetchNewsImage）
const MAX_REDIRECTS = 3;

// workerd 的 fetch 默认不发 User-Agent，而防盗链 CDN 常把「无 UA」直接判成机器人回 403
// 挑战页（本仓库在 pdf-url.ts 已经吃过一次这个亏）。伪装成普通浏览器是纯赚。
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

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
 * 归一化并校验 content-type：返回可下发的 MIME，不在白名单（含 svg、html 等）返回 null。
 * 代理端点与探活共用，保证「探活说能用」＝「代理真的会下发」。
 */
export function supportedImageMime(header: string | null): string | null {
  const mime = header?.split(";")[0]?.trim().toLowerCase();
  return mime && ALLOWED_IMAGE_MIME.has(mime) ? mime : null;
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * 服务端取图。代理端点与 cron 探活共用，保证「探活说能取到」和「用户真去取」行为一致。
 * 只有白名单主机才发 Referer——默认不发是有意的，见 {@link HOTLINK_REFERERS} 里微信图床那条。
 * URL 非法时 fetch 自身抛 TypeError，由调用方兜。
 *
 * 重定向手动跟：白名单只管住了初始 URL，若上游存在开放重定向，`redirect: "follow"`
 * 会让我们跟到任意公网地址、并把结果当成「白名单主机的图」缓存下来。
 * 跳到非白名单主机时直接把那个 3xx 响应交回调用方（!ok → 404 / 探活失败）。
 * 超时预算是整趟的，不是每跳一次——signal 只创建一次。
 *
 * 这是有意的安全取舍，代价要认：现有两个主机实测都是直接 200、零跳转，但哪天图床
 * 改成 302 到自家 OSS 子域，那批图会整体变成 404（表现为 leadImage 覆盖率下降而不是
 * 花屏——探活走同一条路径，会一致地把它们判死）。覆盖率掉了，这里是第一嫌疑人，
 * 补一条白名单即可。
 */
export async function fetchNewsImage(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; ; hop++) {
    const referer = hotlinkReferer(current);
    const response = await fetch(current, {
      headers: referer
        ? { ...BROWSER_HEADERS, Referer: referer }
        : BROWSER_HEADERS,
      redirect: "manual",
      signal,
    });
    if (!REDIRECT_STATUS.has(response.status)) return response;

    const location = response.headers.get("location");
    let next: string | undefined;
    if (location && hop < MAX_REDIRECTS) {
      // 相对 Location 要按当前 URL 解析；解析失败等同于不跟
      try {
        next = new URL(location, current).toString();
      } catch {
        next = undefined;
      }
    }
    if (!next || !needsImageProxy(next)) return response;
    await response.body?.cancel().catch(() => {});
    current = next;
  }
}

/**
 * 探活：2xx + content-type 在 {@link ALLOWED_IMAGE_MIME} 内 + 字节数 ≥ {@link MIN_IMAGE_BYTES}。
 * 任何异常（超时、DNS、非法 URL）都算失败——探活的语义是「确定能用」，存疑即淘汰。
 */
export async function probeNewsImage(url: string): Promise<boolean> {
  try {
    const response = await fetchNewsImage(url, PROBE_TIMEOUT_MS);
    if (
      !response.ok ||
      !supportedImageMime(response.headers.get("content-type"))
    ) {
      await response.body?.cancel();
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
