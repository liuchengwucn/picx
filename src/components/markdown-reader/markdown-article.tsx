import "katex/dist/katex.min.css";
import type { CSSProperties, RefObject } from "react";
import { memo, useCallback, useState } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import { cn } from "#/lib/utils";
import {
  rehypeHeadingIds,
  rehypeNotranslate,
  rehypeTableMath,
  rehypeUnwrapImages,
} from "./rehype-plugins";
import type { ReaderSettings } from "./use-reader-settings";

const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];

/**
 * react-markdown 默认的 urlTransform 把 `data:` 当作不安全协议过滤成空串,内联的 base64
 * 图片 src 因此变空 —— 这正是「图片不显示」的真因(与 zip 路径解析无关,在渲染层下游)。
 * 这里放行 data:image/,其余 URL 仍交回默认实现保证安全。
 */
function readerUrlTransform(url: string): string {
  return url.startsWith("data:image/") ? url : defaultUrlTransform(url);
}

/**
 * papers 原文视图用：markdown 里是 `images/{name}` 相对路径，映射到鉴权图片端点；
 * 其余 URL 走默认安全过滤。返回的函数需由调用方用 useMemo 稳定引用。
 */
export function createRelativeImageUrlTransform(
  imageBase: string,
): (url: string) => string {
  return (url: string) =>
    url.startsWith("images/")
      ? `${imageBase}${url.slice("images/".length)}`
      : defaultUrlTransform(url);
}

// 顺序很重要:先 rehype-raw 解析内嵌 HTML(MinerU 表格是 HTML)→ 把表格里残留的 $...$ 转成
// 公式 span → katex 渲染公式 → highlight 代码 → 生成标题 id → 拆出仅含图片的段落 → 最后给
// 公式/代码打 notranslate。
const REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  rehypeTableMath,
  rehypeKatex,
  rehypeHighlight,
  rehypeHeadingIds,
  rehypeUnwrapImages,
  rehypeNotranslate,
];

interface MarkdownArticleProps {
  markdown: string;
  settings: ReaderSettings;
  articleRef: RefObject<HTMLElement | null>;
  /**
   * 自定义 URL 变换；缺省为 reader 的 data:image 放行逻辑。
   * 注意：此值透传给 RenderedMarkdown 的 memo props——调用方必须传稳定引用
   * （如模块级函数，或 useMemo 缓存），否则每次渲染都会打破 memo 并重跑 markdown 解析。
   */
  urlTransform?: (url: string) => string;
}

/**
 * 只依赖 markdown 的渲染子树,用 memo 隔离。
 *
 * 关键:字体/字号/宽度/行距等阅读设置只是 CSS 变量(挂在外层 <article>),纯样式变化
 * 本不该重新解析文档。隔离后,调设置时 react-markdown 不再重跑 rehype-raw/katex/highlight
 * 这套重管线 —— 长文「切字体/设置巨卡」即由此根治。components 与插件引用均保持稳定。
 */
const RenderedMarkdown = memo(function RenderedMarkdown({
  markdown,
  onZoom,
  urlTransform,
}: {
  markdown: string;
  onZoom: (src: string) => void;
  urlTransform?: (url: string) => string;
}) {
  const components: Components = {
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="my-[1.7em] overflow-x-auto rounded-[12px] border border-[var(--line)]">
        <table>{children}</table>
      </div>
    ),
    img: ({ src, alt }) => {
      const url = typeof src === "string" ? src : "";
      return (
        <figure className="my-[1.9em] text-center">
          <button
            type="button"
            className="group inline-block max-w-full cursor-zoom-in rounded-[12px] border-0 bg-transparent p-0 leading-[0]"
            onClick={() => url && onZoom(url)}
            aria-label={alt || "Zoom figure"}
          >
            <img
              src={url}
              alt={alt ?? ""}
              loading="lazy"
              className="h-auto max-w-full rounded-[12px] border border-[var(--line)] bg-[#fdfdfb] [transition:transform_220ms_cubic-bezier(0.16,1,0.3,1),box-shadow_220ms_ease] group-hover:-translate-y-[2px] group-hover:shadow-[0_10px_28px_rgba(45,42,36,0.16)]"
            />
          </button>
          {alt ? (
            <figcaption className="mt-[0.75em] font-[family-name:var(--reader-sans)] text-[0.82em] leading-[1.5] text-[var(--ink-soft)]">
              {alt}
            </figcaption>
          ) : null}
        </figure>
      );
    },
  };

  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      urlTransform={urlTransform ?? readerUrlTransform}
      components={components}
    >
      {markdown}
    </Markdown>
  );
});

export function MarkdownArticle({
  markdown,
  settings,
  articleRef,
  urlTransform,
}: MarkdownArticleProps) {
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  // 稳定引用,避免破坏 RenderedMarkdown 的 memo。
  const onZoom = useCallback((src: string) => setZoomSrc(src), []);

  return (
    <>
      <article
        ref={articleRef}
        data-reader-font={settings.font}
        className={cn(
          "reader-prose prose",
          settings.textAlign === "justify" && "text-justify",
        )}
        style={
          {
            "--reader-font-size": `${settings.fontSize}px`,
            "--reader-measure": `${settings.measure}ch`,
            "--reader-leading": `${settings.lineHeight}`,
          } as CSSProperties
        }
      >
        <RenderedMarkdown
          markdown={markdown}
          onZoom={onZoom}
          urlTransform={urlTransform}
        />
      </article>

      <Dialog
        open={!!zoomSrc}
        onOpenChange={(open) => {
          if (!open) {
            setZoomSrc(null);
          }
        }}
      >
        <DialogContent className="max-w-[94vw] border-[var(--line)] bg-[var(--parchment)] p-2 sm:max-w-[88vw]">
          <DialogTitle className="sr-only">Figure preview</DialogTitle>
          {zoomSrc ? (
            <img
              src={zoomSrc}
              alt=""
              className="mx-auto max-h-[86vh] w-auto rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
