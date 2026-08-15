import { waitUntil } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
  displayImageUrl,
  fetchNewsImage,
  needsImageProxy,
  PROXY_TIMEOUT_MS,
  supportedImageMime,
} from "#/lib/news/image-source";

// 防盗链图床（qbitai / 机器之心）的封面图代理：浏览器直连必 403，
// 而 Workers 侧带上该站自己的 Referer 就能拿到真图（见 image-source.ts）。
//
// 只服务 image-source 白名单里的主机——那份白名单就是本端点的 SSRF 边界，
// 否则这里等于给全世界开了一个匿名出网跳板。

// 单张封面图的体积上限。带 content-length 时提前判失败（一个字节都不用下）；
// 不带时靠 limitBytes 在流中途 error 掉——此时客户端只能拿到半张坏图，
// 而缓存的干净由 cacheImage() 的 delete 兜底（别指望 put 失败就等于没写进去，见那里的实测）。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const RESPONSE_HEADERS = {
  "Cache-Control": "public, max-age=86400",
  // 上游标 image/png 实际回 HTML 时，浏览器仍可能嗅探出可执行文档；
  // sandbox + default-src 'none' 再兜一层，让本端点的响应无论如何都跑不了脚本。
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

// 上游非图/取不到时一律 404（而不是 200 空体）：前端 StoryImage 据此整块 unmount
// （主路径是挂载时补检 img.complete && naturalWidth === 0，onError 只是补充，
// 因为错误常常发生在 hydration 之前、事件根本没人听）。回 200 空体就会留下
// 一个「加载中」的空框——正是这次要修的那个 bug 的观感。
function notFound() {
  return new Response("Image not found", { status: 404 });
}

/**
 * 流式字节数上限：超限就 error 整条流（客户端与 cache.put 两个分支同时失败）。
 * 注意 controller.error() 会让每个分支各自产生一条 uncaught error 报告，
 * 线上日志里看到它属正常——是 TransformStream 的固有行为，不是有别的东西坏了。
 */
function limitBytes(max: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max) {
        controller.error(new Error(`news image exceeds ${max} bytes`));
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * 写边缘缓存。put 失败后必须顺手 delete：miniflare 实测 put reject 之后
 * **被 limitBytes 截断的那 2048 字节仍然留在缓存里**，还带着 24h 的 max-age
 * （生产边缘会不会同样提交部分条目无从验证——所以由构造保证，不靠猜运行时）。
 * 全程吞异常：waitUntil 里的 rejection 会变成 Worker 的 uncaught error，
 * 每次缓存写失败都往错误率里刷一条，不值得。
 */
async function cacheImage(cache: Cache, key: Request, entry: Response) {
  try {
    await cache.put(key, entry);
  } catch {
    await cache.delete(key).catch(() => {});
  }
}

async function handler({ request }: { request: Request }) {
  const target = new URL(request.url).searchParams.get("u");
  try {
    // 主机不在白名单同样只回 400：调用方要么传错，要么在试探我们当跳板
    if (!target || !needsImageProxy(target)) {
      return new Response("Bad image url", { status: 400 });
    }

    // 缓存键用规范化后的 URL 而不是原始 request.url：否则 ?u=X&junk=1、&junk=2……
    // 每个都是独立 miss、每个都真回源一次，等于替人放大对上游图床的请求。
    // 直接复用 displayImageUrl，保证键与前端真正请求的那个 URL 逐字节一致。
    //
    // 运维注意：键里没有版本段，所以改 RESPONSE_HEADERS（比如收紧 CSP）之后，
    // 已缓存的条目会带着旧头继续服务满 24h。要立刻生效就得给键加一段版本号。
    const cacheKey = new Request(
      new URL(displayImageUrl(target), request.url),
      {
        method: "GET",
      },
    );
    // 类型上要绕一下：tsconfig 的 lib 带了 DOM，全局 caches 被解析成浏览器那个
    // CacheStorage（没有 default）；caches.default 是 workerd 的扩展，运行时确实存在。
    // 顺带兜住「不在 workerd 里跑」的环境（无 caches 时降级为每次直取，功能不受影响）。
    const cache =
      typeof caches === "undefined"
        ? undefined
        : (caches as unknown as { default?: Cache }).default;
    const hit = await cache?.match(cacheKey);
    if (hit) return hit;

    const upstream = await fetchNewsImage(target, PROXY_TIMEOUT_MS);
    const mime = supportedImageMime(upstream.headers.get("content-type"));
    if (!upstream.ok || !mime) {
      await upstream.body?.cancel();
      return notFound();
    }
    const declared = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      await upstream.body?.cancel();
      return notFound();
    }

    // 只挑需要的头透传：上游的 Set-Cookie / 自家 Cache-Control 一概不带出去。
    // content-type 用归一化后的白名单值，不原样回传（上游的参数部分不可信）。
    const body =
      upstream.body?.pipeThrough(limitBytes(MAX_IMAGE_BYTES)) ?? null;
    const response = new Response(body, {
      headers: { ...RESPONSE_HEADERS, "Content-Type": mime },
    });
    // 必须 waitUntil 而不是 await：await 会让 clone 的两个分支一读一停，
    // 迫使运行时整份缓冲 body，线上会撞 "ReadableStream.tee() buffer limit exceeded"
    // （该上限本地宽松、生产严格，所以本地 preview 试不出来）。
    // 顺带把 cache.put 的失败挡在响应之外——不该让缓存写失败把已取到的好图变成 404。
    if (cache) waitUntil(cacheImage(cache, cacheKey, response.clone()));
    return response;
  } catch (error) {
    console.error(
      `Error proxying news image ${target?.slice(0, 120) ?? "<missing>"}:`,
      error,
    );
    return notFound();
  }
}

export const Route = createFileRoute("/api/news-image")({
  server: {
    handlers: {
      GET: handler,
    },
  },
});
