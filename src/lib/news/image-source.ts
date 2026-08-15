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
 * 超时预算是整趟的，不是每跳一次——signal 只创建一次。
 *
 * **重定向策略按「这张图最终由谁来取」分流**，因为探活的唯一价值就是逐字镜像线上取图口径：
 *
 * - 白名单主机：线上由 /api/news-image 下发字节 ⇒ 必须镜像代理行为，`redirect: "manual"`
 *   自己跟，每一跳都重新过白名单。白名单只管得住初始 URL，若上游存在开放重定向，
 *   `follow` 会让我们跟到任意公网地址、还把结果当成「白名单主机的图」缓存下来。
 *   跳出白名单时直接把那个 3xx 交回调用方（!ok → 404 / 探活 rejected）。这条 SSRF 边界不能松。
 * - 非白名单主机：线上是**浏览器直连**取图 ⇒ 镜像浏览器，交给运行时 `redirect: "follow"`。
 *   这里没有 SSRF 顾虑：我们只判断这张图能不能用，不把字节回传给任何人，跳到哪儿都
 *   不会变成开放代理。若这里也用 manual，图床一个「302 到自家 CDN」就会被判 rejected，
 *   而浏览器跟得动、图在页面上好好显示着——等于亲手抹掉一张好图（假阴性，不可逆）。
 *
 * 分流之后「探活口径 = 实际取图口径」在两类主机上都成立，而不是只在白名单上成立。
 *
 * 白名单侧的取舍代价仍要认：现有两个主机实测都是直接 200、零跳转，但哪天它们改成 302 到
 * 自家 OSS 子域，那批图会整体变成 404（表现为 leadImage 覆盖率下降而不是花屏——探活走
 * 同一条路径，会一致地把它们判死）。覆盖率掉了，这里是第一嫌疑人，补一条白名单即可。
 */
export async function fetchNewsImage(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  if (!needsImageProxy(url)) {
    return fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal,
    });
  }
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
 * 探活结论。刻意做成三态而不是布尔：调用方对两种失败的处置完全不同。
 *
 * - `ok`：上游给了合法图片响应（2xx + MIME 白名单 + ≥ {@link MIN_IMAGE_BYTES}）。
 * - `rejected`：拿到了 HTTP 响应但不合格——403 防盗链、非图片/svg MIME、
 *   占位图体积、跳出白名单的重定向、URL 本身非法。**上游明确说了不行**。
 * - `unreachable`：连 HTTP 响应都没拿到（DNS / TLS / 超时）。
 *   **这不代表浏览器也加载不了**：workerd 不做 AIA 补链，缺中间证书的站点
 *   在 curl 和浏览器里 200（浏览器会自己去补中间证书），在 Workers 里却直接
 *   `internal error`。实测 www.latepost.com 正是这样：图在页面上一直好好的，
 *   我们的 fetch 却连不上。把这种情况当成「图坏了」会误杀正常封面。
 */
export type ImageProbe = "ok" | "rejected" | "unreachable";

/**
 * 探活。判定边界：fetch 抛出（TimeoutError / TLS / DNS）⇒ `unreachable`；
 * 拿到响应但不满足「2xx + MIME 白名单 + 体积」⇒ `rejected`。
 * 见 {@link ImageProbe} 的注释——这个区分是给调用方决定 fail-open 还是 fail-closed 用的。
 */
export async function probeNewsImage(url: string): Promise<ImageProbe> {
  // 非法 URL 归 rejected 而不是 unreachable：它不是「连不上」，是根本没得连，
  // 对它 fail-open 只会把一条烂 URL 塞进 <img src>。
  if (!URL.canParse(url)) return "rejected";
  try {
    const response = await fetchNewsImage(url, PROBE_TIMEOUT_MS);
    if (
      !response.ok ||
      !supportedImageMime(response.headers.get("content-type"))
    ) {
      // cancel 的失败不能改写判决（否则「上游拒绝」会被误报成「连不上」），一律吞掉
      await response.body?.cancel().catch(() => {});
      return "rejected";
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > 0) {
      // content-length 可信时直接判定，顺手取消 body 免得白下一张图
      await response.body?.cancel().catch(() => {});
      return declared >= MIN_IMAGE_BYTES ? "ok" : "rejected";
    }

    // 没有 content-length（chunked）时只能数字节，但读够阈值就立刻收手并 cancel：
    // 我们要的只是「够不够大」这一个 bit，没必要为一张 10MB 图付全量下载的时间和出网费。
    const reader = response.body?.getReader();
    if (!reader) return "rejected";
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
    return bytes >= MIN_IMAGE_BYTES ? "ok" : "rejected";
  } catch {
    return "unreachable";
  }
}
