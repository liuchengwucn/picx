import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayImageUrl,
  fetchNewsImage,
  needsImageProxy,
  probeNewsImage,
  supportedImageMime,
} from "./image-source";

const QBITAI = "https://i.qbitai.com/2026/08/cover.jpg";
const WECHAT = "https://mmbiz.qpic.cn/mmbiz_jpg/abc/640";

describe("needsImageProxy", () => {
  it("matches hotlink-protected hosts", () => {
    expect(needsImageProxy(QBITAI)).toBe(true);
    expect(
      needsImageProxy("https://image.jiqizhixin.com/uploads/a/b.png"),
    ).toBe(true);
  });
  it("is case-insensitive on host", () => {
    expect(needsImageProxy("https://I.QBITAI.com/x.jpg")).toBe(true);
  });
  it("leaves other hosts alone", () => {
    // 微信图床直连+不带 Referer 才拿得到真图，故意不在白名单里
    expect(needsImageProxy(WECHAT)).toBe(false);
    expect(needsImageProxy("https://example.com/a.jpg")).toBe(false);
  });
  it("rejects non-https even on whitelisted hosts", () => {
    expect(needsImageProxy("http://i.qbitai.com/x.jpg")).toBe(false);
  });
  it("does not match hosts that merely end with a whitelisted name", () => {
    expect(needsImageProxy("https://evil-i.qbitai.com.attacker.io/x")).toBe(
      false,
    );
  });
  it("treats unparseable input as not proxyable", () => {
    expect(needsImageProxy("")).toBe(false);
    expect(needsImageProxy("not a url")).toBe(false);
    expect(needsImageProxy("//i.qbitai.com/x.jpg")).toBe(false);
  });
});

describe("displayImageUrl", () => {
  it("routes whitelisted images through the proxy", () => {
    expect(displayImageUrl(QBITAI)).toBe(
      `/api/news-image?u=${encodeURIComponent(QBITAI)}`,
    );
  });
  it("escapes query strings so the whole url survives as one param", () => {
    const src = "https://i.qbitai.com/a.jpg?w=800&h=600";
    const proxied = displayImageUrl(src);
    expect(new URL(proxied, "https://picx.dev").searchParams.get("u")).toBe(
      src,
    );
  });
  it("passes non-whitelisted urls through untouched", () => {
    expect(displayImageUrl("https://example.com/a.jpg")).toBe(
      "https://example.com/a.jpg",
    );
    expect(displayImageUrl("not a url")).toBe("not a url");
  });
});

describe("supportedImageMime", () => {
  it("accepts raster image types and strips parameters", () => {
    expect(supportedImageMime("image/jpeg")).toBe("image/jpeg");
    expect(supportedImageMime("IMAGE/PNG; charset=binary")).toBe("image/png");
    expect(supportedImageMime("image/webp")).toBe("image/webp");
  });
  it("rejects svg — it is a scriptable document served from our own origin", () => {
    expect(supportedImageMime("image/svg+xml")).toBeNull();
  });
  it("rejects non-images and missing headers", () => {
    expect(supportedImageMime("text/html")).toBeNull();
    expect(supportedImageMime(null)).toBeNull();
    expect(supportedImageMime("")).toBeNull();
  });
});

// --- fetch stubbing helpers -------------------------------------------------

type Call = { url: string; init: RequestInit };

/** 记录每次调用的 URL/init，并按队列依次返回预置响应。 */
function stubFetch(responses: Response[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error("unexpected extra fetch");
      return next;
    }),
  );
  return calls;
}

function headerOf(call: Call, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

function imageResponse(bytes: number, type = "image/jpeg") {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": type, "content-length": String(bytes) },
  });
}

/** 无 content-length 的分块 body；cancel 会调用 onCancel（用来证明我们提前收手了）。 */
function chunkedImageResponse(chunkSizes: number[], onCancel: () => void) {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunkSizes.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSizes[i++]));
    },
    cancel: onCancel,
  });
  return new Response(stream, { headers: { "content-type": "image/png" } });
}

/** 带 body 的 302（中间跳的 body 必须被 cancel 掉，onCancel 是那条断言的探针）。 */
function redirectResponse(location: string, onCancel = () => {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
    },
    cancel: onCancel,
  });
  return new Response(stream, { status: 302, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNewsImage", () => {
  it("sends the host's own Referer for hotlink-protected hosts", async () => {
    const calls = stubFetch([imageResponse(4096)]);
    await fetchNewsImage(QBITAI, 1000);
    expect(headerOf(calls[0], "Referer")).toBe("https://www.qbitai.com/");
  });

  // 这条是本模块最贵的一条领域知识：微信图床带非微信 Referer 时回的是
  // 2090B 占位图（200 + image/jpeg），不带 Referer 才给真图。默认必须不发 Referer。
  it("sends NO Referer for hosts outside the whitelist (wechat placeholder trap)", async () => {
    const calls = stubFetch([imageResponse(276096)]);
    await fetchNewsImage(WECHAT, 1000);
    expect(headerOf(calls[0], "Referer")).toBeUndefined();
  });

  it("always sends a browser-like User-Agent (workerd sends none by default)", async () => {
    const calls = stubFetch([imageResponse(4096)]);
    await fetchNewsImage(WECHAT, 1000);
    expect(headerOf(calls[0], "User-Agent")).toMatch(/Mozilla\/5\.0/);
  });

  // 非白名单主机线上是浏览器直连取图，探活必须镜像浏览器：跳转交给运行时 follow。
  // 若这里也 manual，图床一个「302 到自家 CDN」就会被判死，而浏览器跟得动。
  it("delegates redirects to the runtime for non-whitelisted hosts", async () => {
    const calls = stubFetch([imageResponse(4096)]);
    await fetchNewsImage("https://static.example/cover.jpg", 1000);
    expect(calls[0].init.redirect).toBe("follow");
    expect(calls).toHaveLength(1);
  });

  it("follows redirects that stay inside the whitelist", async () => {
    const calls = stubFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://image.jiqizhixin.com/real.png" },
      }),
      imageResponse(4096, "image/png"),
    ]);
    const res = await fetchNewsImage(QBITAI, 1000);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    // 跳转后的 Referer 按新主机重算
    expect(headerOf(calls[1], "Referer")).toBe("https://www.jiqizhixin.com/");
  });

  it("refuses to follow a redirect off the whitelist (open-redirect SSRF)", async () => {
    const calls = stubFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/internal" },
      }),
    ]);
    const res = await fetchNewsImage(QBITAI, 1000);
    expect(res.status).toBe(302);
    expect(calls).toHaveLength(1);
  });

  it("resolves a relative Location against the current url", async () => {
    const calls = stubFetch([
      redirectResponse("/wp-content/real.png"),
      imageResponse(4096, "image/png"),
    ]);
    await fetchNewsImage(QBITAI, 1000);
    expect(calls[1].url).toBe("https://i.qbitai.com/wp-content/real.png");
  });

  it("cancels the body of an intermediate redirect", async () => {
    const onCancel = vi.fn();
    stubFetch([
      redirectResponse("https://i.qbitai.com/real.png", onCancel),
      imageResponse(4096, "image/png"),
    ]);
    await fetchNewsImage(QBITAI, 1000);
    expect(onCancel).toHaveBeenCalled();
  });

  // hop < MAX_REDIRECTS 是典型 off-by-one 面：3 跳之后必须停手，
  // 第 4 个响应（还是个 302）原样交回调用方 → !ok → 404 / 探活判死。
  it("stops after the redirect budget instead of looping", async () => {
    const calls = stubFetch(
      Array.from({ length: 6 }, () =>
        redirectResponse("https://i.qbitai.com/next.png"),
      ),
    );
    const res = await fetchNewsImage(QBITAI, 1000);
    expect(res.status).toBe(302);
    expect(calls).toHaveLength(4);
  });

  it("terminates on a self-referential redirect", async () => {
    const calls = stubFetch(
      Array.from({ length: 6 }, () => redirectResponse(QBITAI)),
    );
    const res = await fetchNewsImage(QBITAI, 1000);
    expect(res.status).toBe(302);
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.url === QBITAI)).toBe(true);
  });

  it("passes redirect: manual so the runtime cannot follow behind our back", async () => {
    const calls = stubFetch([imageResponse(4096)]);
    await fetchNewsImage(QBITAI, 1000);
    expect(calls[0].init.redirect).toBe("manual");
  });
});

describe("probeNewsImage", () => {
  it("accepts a real image with a trustworthy content-length", async () => {
    stubFetch([imageResponse(159_000)]);
    await expect(probeNewsImage(QBITAI)).resolves.toBe("ok");
  });

  // 微信防盗链占位图：200 + image/jpeg + 2090B。只看状态码会把它当好图。
  it("rejects the 2090-byte hotlink placeholder", async () => {
    stubFetch([imageResponse(2090)]);
    await expect(probeNewsImage(WECHAT)).resolves.toBe("rejected");
  });

  it("rejects non-2xx", async () => {
    stubFetch([new Response("nope", { status: 403 })]);
    await expect(probeNewsImage(QBITAI)).resolves.toBe("rejected");
  });

  it("rejects non-image and svg content types", async () => {
    stubFetch([imageResponse(50_000, "text/html")]);
    await expect(probeNewsImage(QBITAI)).resolves.toBe("rejected");
    stubFetch([imageResponse(50_000, "image/svg+xml")]);
    await expect(probeNewsImage(QBITAI)).resolves.toBe("rejected");
  });

  it("counts bytes when content-length is missing, and stops once past the threshold", async () => {
    const onCancel = vi.fn();
    // 4 × 1KB 就已过 3KB 阈值：第 4 块之后必须停手，剩下的 1MB 不该被下完
    stubFetch([
      chunkedImageResponse([1024, 1024, 1024, 1024, 1024 * 1024], onCancel),
    ]);
    await expect(probeNewsImage(QBITAI)).resolves.toBe("ok");
    expect(onCancel).toHaveBeenCalled();
  });

  it("rejects a chunked body that never reaches the threshold", async () => {
    stubFetch([chunkedImageResponse([500, 500], () => {})]);
    await expect(probeNewsImage(QBITAI)).resolves.toBe("rejected");
  });

  // 这条区分是整个三态的存在理由：workerd 连不上 ≠ 图坏了（缺中间证书的
  // www.latepost.com 在浏览器里正常显示），调用方要据此 fail-open。
  it("reports a thrown fetch (timeout / TLS / DNS) as unreachable, not rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "TimeoutError");
      }),
    );
    await expect(probeNewsImage(QBITAI)).resolves.toBe("unreachable");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError(
          "fetch failed: unable to get local issuer certificate",
        );
      }),
    );
    await expect(probeNewsImage(QBITAI)).resolves.toBe("unreachable");
  });

  // 通道 B：非白名单图床 302 到自家 CDN。运行时已按 redirect: "follow" 跟完，
  // 交回来的是最终那张图 ⇒ ok。旧的 manual 策略在这里会拿到 302 判 rejected，抹掉好图。
  it("accepts a non-whitelisted image whose host redirected to its CDN", async () => {
    const calls = stubFetch([imageResponse(120_000)]);
    await expect(
      probeNewsImage("https://static.example/cover.jpg"),
    ).resolves.toBe("ok");
    expect(calls[0].init.redirect).toBe("follow");
  });

  // 白名单侧不能松：跳出白名单的 3xx 原样交回 ⇒ !ok ⇒ rejected（SSRF 边界）
  it("still rejects a whitelisted host that redirects off the whitelist", async () => {
    stubFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/internal" },
      }),
    ]);
    await expect(probeNewsImage(QBITAI)).resolves.toBe("rejected");
  });

  it("treats an unparseable url as rejected — nothing to fail open to", async () => {
    stubFetch([]);
    await expect(probeNewsImage("not a url")).resolves.toBe("rejected");
  });
});
