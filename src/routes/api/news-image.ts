import { createFileRoute } from "@tanstack/react-router";
import { fetchNewsImage, needsImageProxy } from "#/lib/news/image-source";

// 防盗链图床（qbitai / 机器之心）的封面图代理：浏览器直连必 403，
// 而 Workers 侧带上该站自己的 Referer 就能拿到真图（见 image-source.ts）。
//
// 只服务 image-source 白名单里的主机——那份白名单就是本端点的 SSRF 边界，
// 否则这里等于给全世界开了一个匿名出网跳板。

// 单张封面图的体积上限。超限直接判失败：
// 不做流式截断是因为截出来的是半张坏图，还会被下面的 Cache API 缓存住 24h，
// 比干脆不显示更糟。只看 content-length 就够——图床没有不带这个头的。
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const CACHE_CONTROL = "public, max-age=86400";

// 上游非图/取不到时一律 404（而不是 200 空体）：前端 <img> 靠 onError 隐藏图位，
// 200 空体会让它停在「加载中」的空框上，也就是这次要修的那个 bug 的观感。
function notFound() {
  return new Response("Image not found", { status: 404 });
}

async function handler({ request }: { request: Request }) {
  try {
    const target = new URL(request.url).searchParams.get("u");
    // 主机不在白名单同样只回 400：调用方要么传错，要么在试探我们当跳板
    if (!target || !needsImageProxy(target)) {
      return new Response("Bad image url", { status: 400 });
    }

    // 缓存键只取请求 URL（?u= 已经是完整身份），不带原请求头，免得 Vary 之类的东西
    // 把命中率打散。picx.dev 是自定义域，Cache API 在这里可用。
    const cacheKey = new Request(request.url, { method: "GET" });
    // 类型上要绕一下：tsconfig 的 lib 带了 DOM，全局 caches 被解析成浏览器那个
    // CacheStorage（没有 default）；caches.default 是 workerd 的扩展，运行时确实存在。
    // 顺带兜住「不在 workerd 里跑」的环境（无 caches 时降级为每次直取，功能不受影响）。
    const cache =
      typeof caches === "undefined"
        ? undefined
        : (caches as unknown as { default?: Cache }).default;
    const hit = await cache?.match(cacheKey);
    if (hit) return hit;

    const upstream = await fetchNewsImage(target);
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !contentType.startsWith("image/")) {
      await upstream.body?.cancel();
      return notFound();
    }
    const declared = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
      await upstream.body?.cancel();
      return notFound();
    }

    // 只挑需要的头透传：上游的 Set-Cookie / 自家 Cache-Control 一概不带出去
    const response = new Response(upstream.body, {
      headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL },
    });
    // put 会消费 body，所以存副本、返回原件。这里 await 而不是 waitUntil：
    // 图不过 10MB，多等一次缓冲换「不依赖 ctx」的简单写法值得。
    if (cache) await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    console.error("Error proxying news image:", error);
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
