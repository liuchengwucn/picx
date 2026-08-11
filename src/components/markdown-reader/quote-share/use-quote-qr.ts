import { useEffect, useState } from "react";
import { renderQuoteQr } from "./quote-card-image";

/**
 * 弹窗打开时才生成二维码：url 在弹窗关闭时可能还没定下来，也不必每次卡片内容变化
 * 都重算——深链只跟 url 有关。
 *
 * 关闭时自清（而不是让调用方另外记一个 reset）：open 变 false 这一刻本身就该让二维码
 * 消失，不然下次为另一段引文打开时会先闪一下旧的。实践中 open 和 url 总是同时有效/
 * 同时清空（见 use-quote-share.ts：payload 非空才开弹窗，而 url 取 payload?.url ?? ""），
 * 所以这里没有引入新的可观察状态，只是把「关闭时清空」这一步从调用方的重置块搬进了
 * 它自己的生命周期里。
 */
export interface QuoteQrResult {
  qrDataUrl: string | null;
  /** 二维码生成失败，卡片本身照样能出（跟 quote_share_render_failed 是两码事） */
  failed: boolean;
}

export function useQuoteQr(open: boolean, url: string): QuoteQrResult {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || !url) {
      setQrDataUrl(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    renderQuoteQr(url)
      .then((data) => {
        if (!cancelled) {
          setQrDataUrl(data);
        }
      })
      .catch((err) => {
        console.error("Failed to render quote QR:", err);
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  return { qrDataUrl, failed };
}
