/** 字体内联最多等这么久；超时就不带字体重来一次 */
const FONT_TIMEOUT_MS = 5000;

/**
 * 跨域 Web 字体（styles.css 顶部的 Google Fonts）在 foreignObject 里必须内联成
 * base64 才会生效，而 Newsreader 是可变字重字体，抓一次就要几百 KB。这里把结果缓存
 * 在模块级：整个会话只嵌一次，后续生成直接复用。
 *
 * 不变式：缓存能正确复用的前提是「每张 QuoteCard 用到的字体集合都一样」。今天成立是
 * 因为 quote-card.tsx 里 data-reader-font="serif" 是写死的、标题也是 inherit——不存在
 * 「有的卡片用衬线、有的用无衬线」的分支。哪天卡片字体要跟随用户设置或随内容变化，
 * 这个模块级缓存就必须失效重来（比如按字体方案分 key），不能再用一个全局 Promise。
 */
let fontCssPromise: Promise<string> | null = null;

// getFontEmbedCSS 从调用方（renderQuoteCard）传入而不是这里自己动态 import：
// 「这个模块什么时候被加载」只应该有一处决策点，不能散在两个函数里各 import 一次。
function embedFontCss(
  node: HTMLElement,
  getFontEmbedCSS: typeof import("html-to-image").getFontEmbedCSS,
): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = Promise.race([
      getFontEmbedCSS(node),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("font embed timeout")),
          FONT_TIMEOUT_MS,
        ),
      ),
    ])
      .then((css) => {
        // getFontEmbedCSS 会先 await 一次网络请求（跨域 @import 的规则读不到，必须重新
        // fetch），之后才同步遍历节点后代收集「用到的字体」。若卡片在这期间被卸载，对
        // detached 节点取 computedStyle 全是空串，集合为空 → 过滤不出任何 @font-face →
        // 成功 resolve 一个空串。那是 resolve 不是 reject，下面的 catch 不会跑，空结果
        // 会被永久缓存、此后整个会话都静默降级成系统衬线体。这里补一次连接性检查，把
        // 「节点已卸载」也当成失败抛出去，走既有的 catch 重置路径。
        if (!node.isConnected) {
          throw new Error("quote card detached during font embed");
        }
        return css;
      })
      .catch((err) => {
        // 失败不缓存：下次还有机会。降级到系统衬线体，卡片照样出得来。
        console.warn("Quote card font embed failed; falling back.", err);
        fontCssPromise = null;
        return "";
      });
  }
  return fontCssPromise;
}

export async function renderQuoteCard(node: HTMLElement): Promise<Blob> {
  // html-to-image 只在用户真正点击「复制图片」或「系统分享」时才用得到；静态 import
  // 会把它打进 /p/{shortId} 路由的主分片，让每个访问论文详情页的人都白白下载几十 KB
  // 代码。动态 import() 把加载成本推迟到真正生成卡片的那一刻。
  const { getFontEmbedCSS, toBlob } = await import("html-to-image");
  const fontEmbedCSS = await embedFontCss(node, getFontEmbedCSS);
  const blob = await toBlob(node, {
    pixelRatio: 2,
    backgroundColor: "#faf8f3",
    fontEmbedCSS,
    skipFonts: fontEmbedCSS === "",
    cacheBust: false,
  });
  if (!blob) {
    throw new Error("html-to-image returned an empty blob");
  }
  return blob;
}

export async function renderQuoteQr(url: string): Promise<string> {
  // 同样的理由：qrcode 只在弹窗打开时才用得到，动态导入避免它常驻论文页主分片。
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(url, {
    margin: 0,
    width: 176,
    color: { dark: "#2d2a24ff", light: "#faf8f3ff" },
  });
}

/** ClipboardItem 在旧 Safari / 非安全上下文里不存在 */
export function canCopyImage(): boolean {
  return (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.clipboard?.write
  );
}

/** 图片与深链一起写进剪贴板：粘到微信/Slack 时两样都在 */
export async function copyCardAndLink(blob: Blob, url: string): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
      "text/plain": new Blob([url], { type: "text/plain" }),
    }),
  ]);
}
