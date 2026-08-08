import "katex/dist/katex.min.css";
import type { CSSProperties, Ref } from "react";
import { memo, useCallback, useState } from "react";
import Markdown, { type Components, defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from "rehype-sanitize";
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

/**
 * 白名单清洗，作用于「文档里原本就有的」HTML —— 也就是 rehype-raw 刚解析出来的那部分。
 *
 * 威胁模型：MinerU 把 PDF 里的文本原样抄进 markdown，攻击者在 PDF 里写 `<script>` /
 * `<iframe>` 就能让渲染端执行；公开论文的原文对任意登录用户可见，于是成为存储型 XSS。
 * 落盘前的 stripDangerousHtml 是黑名单（第一层），这里是白名单兜底：不在名单上的标签
 * 一律拆掉（script/style 连内容一起丢），属性、URL 协议同理。
 *
 * 基线是 hast-util-sanitize 的 GitHub 风格 defaultSchema（已含 table 全家、img、
 * colSpan/rowSpan/align、sub/sup/br/hr 等），这里只做三处必要放行：
 * - 公式类名：remark-math 在 mdast→hast 阶段就把公式变成
 *   `<code class="language-math math-inline|math-display">`，类名被剥掉 katex 就认不出。
 *   只放行这几个具体值，不放行任意 className —— 免得 PDF 里的 HTML 借用站点样式做视觉欺骗。
 * - img 的 src/alt/title/width/height（alt/title/width/height 已在 `*` 里，显式写出便于阅读）。
 * - src 协议加 data:：/reader 的本地文档把图片内联成 base64；papers 侧是相对路径，不受影响。
 *   （data:image 不会执行脚本；img 上的 data: 不构成脚本执行面。）
 */
const MATH_CLASS_NAMES = ["math", "math-inline", "math-display"] as const;

export const SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  // 不在白名单里的标签默认「拆标签留文字」，对 style 来说会把 CSS 源码当正文显示出来
  strip: ["script", "style"],
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, ...MATH_CLASS_NAMES]],
    span: [["className", ...MATH_CLASS_NAMES]],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", ...MATH_CLASS_NAMES],
    ],
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      "src",
      "alt",
      "title",
      "width",
      "height",
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
};

// 顺序很重要:先 rehype-raw 解析内嵌 HTML(MinerU 表格是 HTML)→ 白名单清洗(只洗文档自带的
// HTML,后面几个插件生成的节点不再过 sanitize,故 schema 无需为 katex/highlight 的输出开
// 口子)→ 把表格里残留的 $...$ 转成公式 span → katex 渲染公式 → highlight 代码 → 生成
// 标题 id → 拆出仅含图片的段落 → 最后给公式/代码打 notranslate。
//
// 代价:sanitize 之后的产物不再受审查,而 katex 的输入(LaTeX)是攻击者可控的。当前安全靠
// rehype-katex 的默认值 trust:false + strict:warn 禁掉了 \href/\htmlClass 等 HTML 扩展 ——
// 若将来为支持论文内超链接而开 trust:true,等于在 sanitize 下游直接开洞,必须保持 false。
const REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
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
  /**
   * 可以是普通 RefObject，也可以是回调 ref（如 papers 详情页用回调探测 <article>
   * 重新挂载，好在 tab 切走再切回时逼 TOC 重新扫描 DOM）。两者都能直接喂给 JSX 的
   * ref 属性。
   */
  articleRef: Ref<HTMLElement | null>;
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
      // 插图的垂直间距写在 styles.css 的 .reader-prose figure/img 里,不挂 Tailwind
      // 工具类:typography 插件的 `.prose figure|img` 与工具类特异性相同却排在其后,
      // `my-*` 在这里一律被压掉(图片上下 2em 死白即源于此)。
      return (
        <figure className="text-center">
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
          // 页面级留白挂在这里而不是 .reader-prose 里:那个类还被引用卡片复用(见
          // quote-card.tsx),阅读页的顶部让位与底部收尾留白搬进卡片就是上下两块死白。
          "reader-prose prose pt-10 pb-24",
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
