import { useEffect, useRef, useState } from "react";
import { copyCardAndLink, renderQuoteCard } from "./quote-card-image";

/**
 * 卡片截图/复制链接/系统分享这条链路的全部会话态：cardRef 指向要截图的 DOM 节点，
 * generationRef 判定异步收尾是否还属于当前会话，busy/failed/copiedKey 是三种反馈态。
 * 这里集中了这条链路历史上出过竞态的全部代码——状态和它自己的 reset() 放在同一个
 * 文件里，以后谁加了新的会话态，不会漏掉「同时要在关闭时清掉」这一步。
 */
export function useQuoteCardShare(url: string, title: string) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canSystemShare, setCanSystemShare] = useState(false);
  const [failed, setFailed] = useState(false);
  // 截图链路要跨越几百毫秒到数秒。弹窗关掉再为另一段引文打开时，上一次的异步收尾
  // （setBusy / flash / 错误日志）不能落到新会话上——用自增序号判定归属。
  const generationRef = useRef(0);

  // 探测系统分享能力放 effect 里而不是渲染期读 navigator：SSR 时 navigator 不存在，
  // 渲染期读会导致 hydration 不一致（服务端渲染出 false，客户端可能是 true）。
  useEffect(() => {
    setCanSystemShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  const flash = (key: string) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      flash("link");
    } catch (err) {
      console.error("Failed to copy quote link:", err);
    }
  };

  const copyImage = async () => {
    const node = cardRef.current;
    if (!node) {
      return;
    }
    const gen = ++generationRef.current;
    setBusy(true);
    setFailed(false);
    try {
      const blob = await renderQuoteCard(node);
      await copyCardAndLink(blob, url);
      if (generationRef.current !== gen) {
        return;
      }
      flash("image");
    } catch (err) {
      if (generationRef.current !== gen) {
        return;
      }
      console.error("Failed to copy quote card:", err);
      setFailed(true);
    } finally {
      if (generationRef.current === gen) {
        setBusy(false);
      }
    }
  };

  const systemShare = async () => {
    const node = cardRef.current;
    if (!node) {
      return;
    }
    const gen = ++generationRef.current;
    setBusy(true);
    setFailed(false);
    let file: File | null = null;
    try {
      const blob = await renderQuoteCard(node);
      file = new File([blob], "picx-quote.png", { type: "image/png" });
    } catch (err) {
      // 只在仍属于本会话时报错与标记失败：旧会话的截图失败不该记到新会话头上，
      // 也不该在新会话的弹窗上冒出一条不相干的错误提示。
      if (generationRef.current === gen) {
        console.error("Failed to render quote card for share:", err);
        setFailed(true);
      }
    }
    if (generationRef.current !== gen) {
      return;
    }
    // 面板是系统模态，用户在上面停留多久都不该让按钮一直转圈——截图一出结果就收尾。
    setBusy(false);

    if (file) {
      try {
        await navigator.share({ title, url, files: [file] });
        return;
      } catch (err) {
        // AbortError = 用户主动关掉面板；InvalidStateError = 上一次 share 还没结束
        // （Web Share 规范只允许一个在途请求）。两种都不该再弹一次 link-only 面板。
        if (
          err instanceof DOMException &&
          (err.name === "AbortError" || err.name === "InvalidStateError")
        ) {
          return;
        }
        console.warn(
          "Share with image failed; falling back to link only:",
          err,
        );
      }
    }
    // navigator.share 是用户可见的系统 UI，不是内部状态——弹窗已经因为陈旧会话被关掉
    // 时，绝不能再弹一个 OS 级分享面板打扰用户，所以这里要再判一次 generation。
    if (generationRef.current !== gen) {
      return;
    }
    try {
      await navigator.share({ title, url });
    } catch {
      // 用户取消，什么都不做
    }
  };

  // 换一段引文再打开前把上一段的残留状态清掉，同时让在途的异步收尾（见上面的
  // generationRef 判定）都判定为「过期」，不再落到下一次会话上。
  const reset = () => {
    setCopiedKey(null);
    setBusy(false);
    setFailed(false);
    generationRef.current += 1;
  };

  return {
    cardRef,
    copiedKey,
    busy,
    failed,
    canSystemShare,
    copyLink,
    copyImage,
    systemShare,
    reset,
  };
}
