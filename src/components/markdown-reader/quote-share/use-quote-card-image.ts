import { getFontEmbedCSS, toBlob } from "html-to-image";
import QRCode from "qrcode";

/** 字体内联最多等这么久；超时就不带字体重来一次 */
const FONT_TIMEOUT_MS = 5000;

/**
 * 跨域 Web 字体（styles.css 顶部的 Google Fonts）在 foreignObject 里必须内联成
 * base64 才会生效，而 Newsreader 是可变字重字体，抓一次就要几百 KB。这里把结果缓存
 * 在模块级：整个会话只嵌一次，后续生成直接复用。
 */
let fontCssPromise: Promise<string> | null = null;

function embedFontCss(node: HTMLElement): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = Promise.race([
      getFontEmbedCSS(node),
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("font embed timeout")),
          FONT_TIMEOUT_MS,
        ),
      ),
    ]).catch((err) => {
      // 失败不缓存：下次还有机会。降级到系统衬线体，卡片照样出得来。
      console.warn("Quote card font embed failed; falling back.", err);
      fontCssPromise = null;
      return "";
    });
  }
  return fontCssPromise;
}

export async function renderQuoteCard(node: HTMLElement): Promise<Blob> {
  const fontEmbedCSS = await embedFontCss(node);
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

export function renderQuoteQr(url: string): Promise<string> {
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
