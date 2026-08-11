import type { CSSProperties, Ref } from "react";
import { useLayoutEffect, useRef } from "react";
// logo-mark.png 由 public/logo512.png 抠底后缩到 48px 而来：favicon 全系列都自带一层
// 不透明米白底，直接放上来会在 parchment 卡片上露出一个色块。抠底只从图像四边做
// flood fill，被图案包住的内部浅色区（卷轴纸面、右侧屏幕）因此原样保留。
//
// ?inline 强制打成 data URL（5.6KB，超过 assetsInlineLimit 默认阈值，不加这个后缀会
// 被输出成独立文件）。卡片是截图素材：外链 src 得等 html-to-image 现场 fetch 再转
// base64，多一条会失败的网络路径；data URL 走的是和二维码一样的路子，预览里看到
// 什么，导出的图里就是什么。
import logoMark from "#/assets/logo-mark.png?inline";
import { m } from "#/paraglide/messages";
import type { CardContent } from "./quote-card-content";

/** 卡片固定宽度（CSS px）。截图按 pixelRatio 2 输出（Task 5）。 */
export const CARD_WIDTH = 720;

/**
 * 引用卡片。既是弹窗里的预览，也是截图的素材——同一棵 DOM，所见即所得。
 *
 * 卡片固定亮色：外层显式钉住用到的 CSS 变量并声明 color-scheme: light，暗色模式下也出
 * parchment 亮卡，分享出去的图在别人那里更通用，也避免暗色截图贴进浅色聊天窗里刺眼。
 */
export function QuoteCard({
  cardRef,
  content,
  title,
  url,
  qrDataUrl,
}: {
  cardRef: Ref<HTMLDivElement>;
  content: CardContent;
  title: string;
  url: string;
  qrDataUrl: string | null;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // content.blocks 是真实 DOM 节点，而节点只能有一个父节点：直接挂载会把它们从别处
  // 摘走。每个实例挂自己的深拷贝，卡片就可以被安全地渲染多份。
  //
  // 用 useLayoutEffect 而非 useEffect：卡片同时是截图素材（Task 5），不能有「渲染完
  // 但内容还没挂上」的一帧——useEffect 是 passive 的，会等浏览器先绘制一次空卡片再
  // 执行；useLayoutEffect 在浏览器绘制前同步跑，没有这个空窗口。
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    body.replaceChildren(
      ...content.blocks.map((block) => block.cloneNode(true)),
    );
  }, [content]);

  return (
    <div
      ref={cardRef}
      style={
        {
          width: CARD_WIDTH,
          colorScheme: "light",
          "--parchment": "#faf8f3",
          "--parchment-warm": "#f4f1e8",
          "--ink": "#2d2a24",
          "--ink-soft": "#6b6560",
          "--academic-brown": "#8b6f47",
          "--gold": "#c9a961",
          "--line": "rgba(139, 111, 71, 0.15)",
        } as CSSProperties
      }
      className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--parchment)]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[linear-gradient(90deg,rgba(139,111,71,0.10),rgba(201,169,97,0.06))] px-5 py-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[15px] font-bold leading-snug text-[var(--ink)]">
            {title}
          </div>
          {content.subtitle && (
            <div className="mt-1 text-[11px] text-[var(--academic-brown)]">
              {content.subtitle}
            </div>
          )}
        </div>
        {/* 24px：轮廓是斜放的卷轴，见方的框里只占七成，20px 时在 720px 宽的卡片上显得
            孤零零；再大就压过 15px 的标题。@2x 导出正好吃满 48px 源图。
            mt-px 补掉标题首行的行高内边距，让图标视觉上与标题顶端齐平。 */}
        <img src={logoMark} alt="PicX" className="mt-px h-6 w-6 shrink-0" />
      </div>

      <div className="px-5 py-4">
        <div
          ref={bodyRef}
          // 首尾块的段间距归零:.reader-prose 的 margin-block 是「段与段之间」的节奏,
          // 卡片正文的上下边界由容器 padding 负责,两者叠加就是多余的空白。
          className="reader-prose [&>:first-child]:mt-0 [&>:last-child]:mb-0"
          data-reader-font="serif"
          style={
            {
              "--reader-font-size": "16px",
              "--reader-measure": "100%",
              "--reader-leading": "1.85",
            } as CSSProperties
          }
        />
        {content.truncated && (
          <div className="mt-2 text-[11px] italic text-[var(--ink-soft)]">
            {m.quote_share_truncated()}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-[var(--line)] bg-[var(--parchment-warm)] px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-[11px] text-[var(--academic-brown)]">
            {url.replace(/^https?:\/\//, "")}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--ink-soft)]">
            {m.quote_share_qr_hint()}
          </div>
        </div>
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt=""
            className="h-[44px] w-[44px] shrink-0 rounded"
          />
        )}
      </div>
    </div>
  );
}
