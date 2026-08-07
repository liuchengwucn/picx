import { useEffect, useState } from "react";
import { renderQuoteQr } from "./quote-card-image";

/**
 * 弹窗打开时才生成二维码：url 在弹窗关闭时可能还没定下来，也不必每次卡片内容变化
 * 都重算——深链只跟 url 有关。
 *
 * 关闭时自清（而不是让调用方另外记一个 reset）：open 变 false 这一刻本身就该让二维码
 * 消失，不然下次为另一段引文打开时会先闪一下旧的。实践中 open 和 url 总是同时有效/
 * 同时清空（见 quote-share-overlay.tsx 里 url 只在 shareAnchor 非空时才非空），所以这
 * 里没有引入新的可观察状态，只是把「关闭时清空」这一步从调用方的重置块搬进了它自己
 * 的生命周期里。
 */
export function useQuoteQr(open: boolean, url: string): string | null {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    renderQuoteQr(url)
      .then((data) => {
        if (!cancelled) {
          setQrDataUrl(data);
        }
      })
      .catch((err) => console.error("Failed to render quote QR:", err));
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  return qrDataUrl;
}
