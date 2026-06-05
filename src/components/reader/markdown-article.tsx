import "katex/dist/katex.min.css";
import type { CSSProperties, RefObject } from "react";
import { memo, useCallback, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import {
  rehypeHeadingIds,
  rehypeNotranslate,
  rehypeUnwrapImages,
} from "./rehype-plugins";
import type { ReaderSettings } from "./use-reader-settings";

const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];

// 顺序很重要:先 rehype-raw 解析内嵌 HTML(MinerU 偶有 HTML 表格)→ katex 渲染公式
// → highlight 代码 → 生成标题 id → 拆出仅含图片的段落 → 最后给公式/代码打 notranslate。
const REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
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
}: {
  markdown: string;
  onZoom: (src: string) => void;
}) {
  const components: Components = {
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="reader-table-wrap">
        <table>{children}</table>
      </div>
    ),
    img: ({ src, alt }) => {
      const url = typeof src === "string" ? src : "";
      return (
        <figure className="reader-figure">
          <button
            type="button"
            className="reader-figure-btn"
            onClick={() => url && onZoom(url)}
            aria-label={alt || "Zoom figure"}
          >
            <img src={url} alt={alt ?? ""} loading="lazy" />
          </button>
          {alt ? <figcaption>{alt}</figcaption> : null}
        </figure>
      );
    },
  };

  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
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
}: MarkdownArticleProps) {
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  // 稳定引用,避免破坏 RenderedMarkdown 的 memo。
  const onZoom = useCallback((src: string) => setZoomSrc(src), []);

  return (
    <>
      <article
        ref={articleRef}
        data-reader-font={settings.font}
        className="reader-prose prose"
        style={
          {
            "--reader-font-size": `${settings.fontSize}px`,
            "--reader-measure": `${settings.measure}ch`,
            "--reader-leading": `${settings.lineHeight}`,
          } as CSSProperties
        }
      >
        <RenderedMarkdown markdown={markdown} onZoom={onZoom} />
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
