import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileText,
  ImageIcon,
  Languages,
  Loader2,
  Maximize2,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { plainCardContent } from "#/components/markdown-reader/quote-share/quote-card-content";
import { QuoteShareDialog } from "#/components/markdown-reader/quote-share/quote-share-dialog";
import {
  type QuoteSharePayload,
  useQuoteShare,
} from "#/components/markdown-reader/quote-share/use-quote-share";
import { type TocItem, TocList } from "#/components/markdown-reader/reader-toc";
import { useReadingAnchor } from "#/components/markdown-reader/use-reading-anchor";
import {
  CHAT_COLLAPSED_STORAGE_KEY,
  CHAT_PANEL_WIDTH,
  CHAT_PANEL_WIDTH_STORAGE_KEY,
  clampChatPanelWidth,
  PaperChat,
} from "#/components/paper-chat";
import { FeedbackButtons } from "#/components/papers/feedback-buttons";
import { paperCompletedBadgeToneClassName } from "#/components/papers/paper-badge-styles";
import { PaperPanelSkeleton } from "#/components/papers/paper-panel-skeleton";
import {
  type PaperReaderState,
  PaperReaderView,
  usePaperReader,
} from "#/components/papers/paper-reader-view";
import { PaperStateCard } from "#/components/papers/paper-state-card";
import { PublicBadge } from "#/components/papers/public-badge";
import { RegenerateWhiteboardDialog } from "#/components/papers/regenerate-whiteboard-dialog";
import { ShareBanner } from "#/components/papers/share-banner";
import { ShareDialog } from "#/components/papers/share-dialog";
import { WhiteboardGalleryDialog } from "#/components/papers/whiteboard-gallery-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "#/components/ui/dialog";
import { Progress } from "#/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Skeleton } from "#/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { useHydrated } from "#/hooks/use-hydrated";
import { usePaperFeedback } from "#/hooks/use-paper-feedback";
import { usePaperSSE } from "#/hooks/use-paper-sse";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import {
  authClient,
  startGitHubSignIn as beginGitHubSignIn,
} from "#/lib/auth-client";
import { paperPdfPageUrl, parsePdfPageParam } from "#/lib/embed-code";
import {
  buildQuoteBlock,
  collapseSelectionWhitespace,
  normalizePdfSelection,
} from "#/lib/pdf-quote";
import { pushRecentPaper } from "#/lib/recent-papers";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";
import { SITE_URL } from "#/lib/site-url";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

interface AppEnvBindings {
  DB: D1Database;
}

// lazy 在这里只为客户端分包：pdfjs 引擎约 350KB(gz) + 官方 viewer 样式表，
// 不能跟详情页主 chunk 绑在一起。
//
// 它做不到的有两件事，别混为一谈：
// 一、排除在 SSR 渲染之外——Fizz 会照常解析 lazy 组件并渲染它，服务端产出的就是
//     PDF 面板骨架加那层 loading 遮罩（这是好事，不是问题）。
// 二、排除在 SSR **产物**之外——下面 import() 的说明符是字面量，rollup 构建期就
//     跟进整条链，pdfjs 的字节照进 worker 包，跟运行时执不执行毫不相干。所以改成
//     <ClientOnly>、改成挂载后再渲染，都省不下这 604 KiB；真正拦住它的是
//     vite.config.ts 里的 stub-pdfjs-ssr 插件。
const PdfReaderView = lazy(
  () => import("#/components/papers/pdf/pdf-reader-view"),
);

// SSR 预取数据必须与 paper.getByShortId 的输出形状完全一致，才能作为 react-query 的
// initialData 注入（判别联合：有 result / 无 result 两种分支）。
type GetByShortIdOutput =
  inferRouterOutputs<TRPCRouter>["paper"]["getByShortId"];

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>-]/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPaperDescription(title: string, summary?: string | null): string {
  const cleanSummary = summary ? stripMarkdown(summary).slice(0, 160) : "";
  return (
    cleanSummary ||
    `Visual whiteboard summary of "${title}" generated by PicX AI.`
  );
}

function buildScholarlyArticleJsonLd(input: {
  title: string;
  description: string;
  shortId: string;
  publishedAt?: Date | string | null;
  sourceUrl?: string | null;
  imageUrl?: string | null;
}) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: input.title,
    name: input.title,
    description: input.description,
    url: `${SITE_URL}/p/${input.shortId}`,
    mainEntityOfPage: `${SITE_URL}/p/${input.shortId}`,
    datePublished: input.publishedAt
      ? new Date(input.publishedAt).toISOString()
      : undefined,
    image: input.imageUrl ? [input.imageUrl] : undefined,
    sameAs: input.sourceUrl ?? undefined,
    isPartOf: {
      "@type": "WebSite",
      name: "PicX",
      url: SITE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "PicX",
      url: SITE_URL,
    },
    // 防止 </script> 逃逸：children 经 dangerouslySetInnerHTML 注入，必须转义 <
  }).replace(/</g, "\\u003c");
}

export const Route = createFileRoute("/p/$shortId")({
  component: PaperDetailPage,
  // 只有 ?view=reader / ?view=pdf 是有效状态；总结视图不带参数，URL 保持干净
  // （分享链接可直达原文或 PDF 视图）
  validateSearch: (
    search: Record<string, unknown>,
  ): { view?: "reader" | "pdf"; page?: number } => ({
    view:
      search.view === "reader"
        ? "reader"
        : search.view === "pdf"
          ? "pdf"
          : undefined,
    page: parsePdfPageParam(search.page),
  }),
  loader: async ({ context, params }) => {
    if (import.meta.env.SSR) {
      // SSR: fetch public paper detail content directly so crawlers receive
      // a contentful first HTML response instead of metadata plus a skeleton.
      try {
        const { env } = await import("cloudflare:workers");
        const { drizzle } = await import("drizzle-orm/d1");
        const { and, count, desc, eq, isNull } = await import("drizzle-orm");
        const {
          paperContents,
          paperFeedback,
          paperResults,
          papers,
          whiteboardImages,
          whiteboardPrompts,
        } = await import("#/db/schema");
        const appEnv = env as typeof env & AppEnvBindings;
        const db = drizzle(appEnv.DB);

        const [paper] = await db
          .select()
          .from(papers)
          .where(
            and(
              eq(papers.shortId, params.shortId),
              eq(papers.isPublic, true),
              isNull(papers.deletedAt),
            ),
          )
          .limit(1);

        if (!paper) {
          return {
            paper: null,
            ssrData: null,
            ssrMeta: null,
            relatedPapers: [],
          };
        }

        const [result] = await db
          .select()
          .from(paperResults)
          .where(eq(paperResults.paperId, paper.id))
          .limit(1);

        const whiteboards = await db
          .select({
            id: whiteboardImages.id,
            imageR2Key: whiteboardImages.imageR2Key,
            promptId: whiteboardImages.promptId,
            promptName: whiteboardPrompts.name,
            isDefault: whiteboardImages.isDefault,
            createdAt: whiteboardImages.createdAt,
          })
          .from(whiteboardImages)
          .leftJoin(
            whiteboardPrompts,
            eq(whiteboardImages.promptId, whiteboardPrompts.id),
          )
          .where(eq(whiteboardImages.paperId, paper.id))
          .orderBy(desc(whiteboardImages.createdAt));

        const defaultWhiteboard = whiteboards.find((w) => w.isDefault) || null;

        // 两件事：
        // 1. 与 paper.getByShortId 保持一致：没有 paper_contents 行的论文（存量数据）
        //    首帧就该把「原文阅读」置灰。
        // 2. 赞数首帧就要准（ssrData 当 initialData 且 staleTime 30s，先给 0 会让
        //    已有的赞数消失半分钟）。口径来自 likeFilter，与 paper.getByShortId 同源
        //    （单表 count 不能用 likeCountSql，见 paper-feedback.ts 的说明）。
        //    门条件只判 isListedInGallery：上面 :200 的 paper 查询已经过滤了
        //    isPublic，所以这里等价于 router 侧的 isPublic && isListedInGallery。
        // 两次查询互不依赖，并行掉——这段在 SSR TTFB 关键路径上。
        const { likeFilter } = await import("#/lib/paper-feedback");
        const [contentRows, likeRows] = await Promise.all([
          db
            .select({ id: paperContents.id })
            .from(paperContents)
            .where(eq(paperContents.paperId, paper.id))
            .limit(1),
          paper.isListedInGallery
            ? db
                .select({ value: count() })
                .from(paperFeedback)
                .where(likeFilter(paper.id))
            : Promise.resolve([] as { value: number }[]),
        ]);
        const hasContent = contentRows.length > 0;
        const likeCount = likeRows[0]?.value ?? 0;

        const summaries = (result?.summaries as Record<string, string>) ?? null;
        const currentLanguage = result?.summaryLanguage ?? "en";
        const summary = summaries
          ? summaries[currentLanguage] || summaries.en || ""
          : null;
        const ssrData: GetByShortIdOutput =
          result && summaries
            ? {
                paper,
                result: {
                  ...result,
                  summary: summary ?? "",
                  summaries,
                  availableLanguages: Object.keys(summaries),
                },
                defaultWhiteboard,
                whiteboards,
                hasContent,
                likeCount,
              }
            : {
                paper,
                result: null,
                defaultWhiteboard: null,
                whiteboards: [],
                hasContent,
                likeCount,
              };

        // Related papers (same category first, then recent) so the SSR HTML
        // ships real internal links — crawlers can follow them and link equity
        // flows between papers.
        const { selectRelatedPapers } = await import("#/lib/related-papers");
        const relatedPapers = paper.isPublic
          ? await selectRelatedPapers(db, {
              excludePaperId: paper.id,
              categories: (result?.categories as string[] | null) ?? [],
              limit: 3,
            })
          : [];

        return {
          paper,
          ssrData,
          relatedPapers,
          ssrMeta: {
            title: paper.title,
            shortId: paper.shortId,
            isPublic: paper.isPublic,
            summary,
            tldr: (result?.tldr as Record<string, string> | null) ?? null,
            publishedAt: paper.publishedAt,
            sourceUrl: paper.sourceUrl,
            whiteboardImageR2Key: defaultWhiteboard?.imageR2Key ?? null,
          },
        };
      } catch {
        return {
          paper: null,
          ssrData: null,
          ssrMeta: null,
          relatedPapers: [],
        };
      }
    }

    const data = await context.queryClient.ensureQueryData(
      context.trpc.paper.getByShortId.queryOptions(params.shortId),
    );
    const relatedPapers = data.paper.isPublic
      ? await context.queryClient.ensureQueryData(
          context.trpc.paper.listRelated.queryOptions(params.shortId),
        )
      : [];
    return {
      paper: data.paper,
      ssrData: null,
      relatedPapers,
      ssrMeta: {
        title: data.paper.title,
        shortId: data.paper.shortId,
        isPublic: data.paper.isPublic,
        summary: data.result?.summary ?? null,
        tldr: (data.result?.tldr as Record<string, string> | null) ?? null,
        publishedAt: data.paper.publishedAt,
        sourceUrl: data.paper.sourceUrl,
        whiteboardImageR2Key: data.defaultWhiteboard?.imageR2Key ?? null,
      },
    };
  },
  head: ({ loaderData }) => {
    const ssrMeta = loaderData?.ssrMeta;
    if (!ssrMeta) {
      // ssrMeta 为空仅出现在「论文未找到 / SSR 失败」分支，此时 paper 必为 null，
      // 没有可用标题，直接回退到站点默认标题。
      return {
        meta: [{ title: "PicX - Paper Whiteboard" }],
      };
    }

    // A: 把差异化关键词("图解/Visual Summary")前置, 因论文标题常超过
    // SERP 截断长度, 放最前面才能稳定展示, 与 arXiv 等原文结果区分开。
    const title = `${m.seo_paper_title_prefix()} | ${ssrMeta.title}`;

    // B: 优先用为人写的一句话总结(tldr)做 description, 并以利益点开头;
    // gallery 已索引文章 tldr 四语种齐全, 仅存量数据缺失时回退到摘要截断。
    const localeKey = normalizeLocaleKey(getLocale());
    const tldrText = pickTldr(ssrMeta.tldr, localeKey);
    const description = tldrText
      ? `${m.seo_paper_desc_prefix()} ${tldrText}`
      : buildPaperDescription(ssrMeta.title, ssrMeta.summary);
    // 仅公开论文输出社交卡片图: 带水印的稳定路由只服务公开论文,
    // 私有论文(owner 自己浏览时)走该路由会 404, 故此处不输出 og:image。
    const imageUrl =
      ssrMeta.isPublic && ssrMeta.whiteboardImageR2Key
        ? `${SITE_URL}/p/${ssrMeta.shortId}/image`
        : null;

    const meta: Array<Record<string, string>> = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "article" },
    ];

    // C: 让白板图进搜索/社交结果。视觉缩略图相对 arXiv 纯文字结果是
    // 最大的点击诱因, 补全 og:image:alt 与 twitter large image 卡片。
    if (imageUrl) {
      meta.push(
        { property: "og:image", content: imageUrl },
        { property: "og:image:alt", content: ssrMeta.title },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: imageUrl },
      );
    } else {
      meta.push({ name: "twitter:card", content: "summary" });
    }

    meta.push(
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { property: "og:url", content: `${SITE_URL}/p/${ssrMeta.shortId}` },
    );

    return {
      meta,
      links: [
        {
          rel: "canonical",
          href: `${SITE_URL}/p/${ssrMeta.shortId}`,
        },
        // 指向纯 Markdown 视图, 让支持内容协商的 AI 客户端 (Claude/Cursor 等)
        // 直接取低噪音版本。
        {
          rel: "alternate",
          type: "text/markdown",
          href: `${SITE_URL}/p/${ssrMeta.shortId}.md`,
        },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: buildScholarlyArticleJsonLd({
            title: ssrMeta.title,
            description,
            shortId: ssrMeta.shortId,
            publishedAt: ssrMeta.publishedAt,
            sourceUrl: ssrMeta.sourceUrl,
            imageUrl,
          }),
        },
      ],
    };
  },
});
/**
 * Normalize AI-generated math markdown before handing it to remark-math.
 *
 * Models sometimes emit display equations as a single indented line:
 * `$$ ... $$`
 * remark-math parses that as inline math, which makes KaTeX reject commands
 * like `\tag{}` that only work in display mode. Rewriting those standalone lines
 * into a multi-line display block keeps existing summaries renderable.
 */
function normalizeMathMarkdown(markdown: string): string {
  return markdown
    .replace(
      /(^[ \t]*)\$\$\s*([^\n]+?)\s*\$\$(?=[ \t]*$)/gm,
      (_match, indent, content) => {
        return `${indent}$$\n${indent}${content}\n${indent}$$`;
      },
    )
    .replace(/\\text\{([^}]*\\_[^}]*)\}/g, (_match, content) => {
      return `\\mathrm{${content}}`;
    });
}

const statusProgress: Record<string, number> = {
  pending: 10,
  parsing: 25,
  processing_text: 45,
  processing_image: 70,
  completed: 100,
  failed: 0,
};

function PaperDetailPage() {
  const { shortId } = Route.useParams();
  const { view, page: initialPageParam } = Route.useSearch();
  const loaderData = Route.useLoaderData();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  // 切 tab 往返时记住 PDF 读到第几页。用 ref 而不是 state：这个值每翻一页都会更新，
  // 但只在 PdfReaderView 挂载时被读一次当种子——放进 state 会让整个详情页（含 chat
  // 面板与白板画廊）跟着每一次翻页重渲染，纯属浪费。翻页刻意不**写** URL：页码是
  // 阅读进度不是分享意图，塞进 search param 会让每翻一页都推一条历史记录。
  // 但 ?page= 会被**读**一次当落地页：那是「分享这段」深链的落点（写在链接里的页码
  // 是明确的分享意图），只在挂载时取种子，此后仍然只在 ref 里流转。
  // 只在 ?view=pdf 时认这个种子：/p/x?page=7 落在摘要视图上时那个 7 没有表达任何意图
  // （残留参数或手改 URL），认了它用户第一次点开 PDF tab 会莫名落在第 7 页。
  const pdfPageRef = useRef(view === "pdf" ? (initialPageParam ?? 1) : 1);
  const handlePdfPageChange = useCallback((page: number) => {
    pdfPageRef.current = page;
  }, []);
  // 两个阅读视图（PDF 文本层与原文 markdown）里选中文字点「问这段」后待送进 chat
  // 输入框的引用块。一次性事件而不是持久状态：PaperChat 消费后立刻清回 null，否则
  // 用户手动删掉引用后任何一次重渲染都会把它塞回来。
  //
  // markdown 侧送来的文本已经是规范化引文（公式折成 $...$ LaTeX 源，见 quoteTextOfSelection），
  // normalizePdfSelection 在这条路上只起「压空白 + 钳 2000 字」的作用。
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  const handleAskSelection = useCallback((text: string) => {
    setPendingQuote(buildQuoteBlock(normalizePdfSelection(text)));
  }, []);
  const handleQuoteConsumed = useCallback(() => setPendingQuote(null), []);
  const [isWhiteboardPreviewOpen, setIsWhiteboardPreviewOpen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(true);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
  const [guestSelectedLanguage, setGuestSelectedLanguage] = useState<
    string | null
  >(null);
  // 聊天栏宽度（xl 三栏的第三列，经 CSS 变量驱动布局）。SSR/首帧固定默认值，
  // 挂载后再从 localStorage 恢复——首次渲染就读会水合不一致，参照 use-reader-settings
  const [chatPanelWidth, setChatPanelWidth] = useState<number>(
    CHAT_PANEL_WIDTH.default,
  );
  const [chatPanelHydrated, setChatPanelHydrated] = useState(false);

  useEffect(() => {
    try {
      const parsed = Number(
        window.localStorage.getItem(CHAT_PANEL_WIDTH_STORAGE_KEY),
      );
      if (Number.isFinite(parsed) && parsed > 0) {
        setChatPanelWidth(clampChatPanelWidth(parsed));
      }
    } catch {
      // 读不了（隐私模式等）就用默认宽度
    }
    setChatPanelHydrated(true);
  }, []);

  useEffect(() => {
    if (!chatPanelHydrated) return;
    try {
      window.localStorage.setItem(
        CHAT_PANEL_WIDTH_STORAGE_KEY,
        String(chatPanelWidth),
      );
    } catch {
      // 忽略写入失败（隐私模式等），宽度退化为仅本次访问生效
    }
  }, [chatPanelWidth, chatPanelHydrated]);

  // 聊天侧栏是否收起成右下角 FAB（仅影响 xl+ 常驻形态）。读写模式照抄上面
  // chatPanelWidth：SSR/首帧固定为展开，挂载后才从 localStorage 恢复，避免水合不一致。
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatCollapsedHydrated, setChatCollapsedHydrated] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(CHAT_COLLAPSED_STORAGE_KEY) === "1") {
        setChatCollapsed(true);
      }
    } catch {
      // 读不了（隐私模式等）就用默认展开
    }
    setChatCollapsedHydrated(true);
  }, []);

  useEffect(() => {
    if (!chatCollapsedHydrated) return;
    try {
      window.localStorage.setItem(
        CHAT_COLLAPSED_STORAGE_KEY,
        chatCollapsed ? "1" : "0",
      );
    } catch {
      // 忽略写入失败（隐私模式等），折叠状态退化为仅本次访问生效
    }
  }, [chatCollapsed, chatCollapsedHydrated]);

  // Use optional auth - allow viewing public papers without login
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const isReadOnlyGuest = isReviewGuestReadOnlySession(session);
  // review-guest 没有 cookie session，authClient.useSession() 永远是 null，但后端
  // （/api/chat 与 tRPC chat router）都认它。用页面其他地方同样的口径补上，否则
  // 演示模式下整页都按 owner 渲染，唯独聊天面板卡在「登录后即可提问」。
  const effectiveSession =
    session ??
    (isReviewGuestModeEnabled() ? getReviewGuestClientSession() : null);
  // 本组件是否已过 hydration：所有「客户端才知道」的渲染差异（本地时区时间、
  // 登录态）都必须以它为门，保证 SSR 与客户端首帧逐字节同构（见 use-hydrated.ts）。
  const hydrated = useHydrated();
  // 登录态是否已确定。光看 isSessionPending 不够：服务端渲染时它是 true（出占位/
  // 登录提示），而客户端首帧 useSession 可能已从缓存同步解析出 session，两边渲染
  // 出不同结构 → React #418。必须同时过了 hydration 这一帧才算「确定」。
  const isSessionResolved = hydrated && !isSessionPending;
  const ssrData = loaderData.ssrData;
  const relatedPapers = loaderData.relatedPapers ?? [];
  const relatedHeadingId = useId();
  const relatedLocaleKey = normalizeLocaleKey(getLocale());

  const startGitHubSignIn = useCallback(() => {
    void beginGitHubSignIn("/");
  }, []);

  // 原文视图的登录墙：登录后回到这篇论文的原文视图，而不是首页
  const startReaderSignIn = useCallback(() => {
    void beginGitHubSignIn(`/p/${shortId}?view=reader`);
  }, [shortId]);

  // 留一条历史记录：切到原文/PDF 后按返回键应该退回总结，而不是直接离开这篇论文
  const showView = useCallback(
    (next: "summary" | "reader" | "pdf") => {
      navigate({
        // from 让 search 更新器按本路由的 search 类型推断（不带它会退化成全路由联合）
        from: Route.fullPath,
        search: (prev) => ({
          ...prev,
          view: next === "summary" ? undefined : next,
          // ?page= 只对 PDF 视图有意义。切走时清掉，别让地址栏留下
          // ?view=reader&page=7 这种自相矛盾的 URL——用户复制地址栏分享是常见动作。
          page: next === "pdf" ? prev.page : undefined,
        }),
      });
    },
    [navigate],
  );

  const profile = useQuery({
    ...trpc.user.getProfile.queryOptions(),
    enabled: !!session,
  });
  usePaperSSE(profile.data?.id);

  const { data, isLoading, error } = useQuery({
    ...trpc.paper.getByShortId.queryOptions(shortId),
    initialData: ssrData ?? undefined,
    staleTime: ssrData ? 30_000 : undefined,
  });

  // 注意读 data?.paper 而不是下面解构出来的 paper：hooks 必须在 early return 之前
  // 无条件调用，而 `const { paper } = data` 在那些 early return 之后才执行。
  const paperId = data?.paper?.id ?? "";
  // shortId 用路由参数：上面那个要被 invalidate 的 getByShortId 查询也是拿它做 key 的。
  const quoteShare = useQuoteShare(paperId, shortId);

  // 原文只对处理完成、且真有 MinerU 解析产物的论文有意义（存量论文没有
  // paper_contents 行，点进去只会看到空态）；?view=reader 落在不可用的论文上时
  // 静默退回总结视图。提到这里（而不是 render 尾部）是因为下面的 usePaperReader 需要
  // 提前知道是否该发请求——hooks 必须在任何 early return 之前无条件调用。
  const isReaderAvailable =
    data?.paper?.status === "completed" && !!data?.hasContent;
  // PDF 不需要 hasContent（那是 MinerU 产物）。但也不能只判 pdfR2Key 非空：arXiv
  // 抓取的论文建行时写的是占位 key（arxiv-cron.ts），真 key 要等 queue-consumer
  // 下载完 PDF 才回填。completed 是「R2 里确实有这个对象」的最简可靠判据。
  const isPdfAvailable = data?.paper?.status === "completed";
  const activeView: "summary" | "reader" | "pdf" =
    view === "reader" && isReaderAvailable
      ? "reader"
      : view === "pdf" && isPdfAvailable
        ? "pdf"
        : "summary";
  // 与 ReaderPane 的分诊完全一致：公开论文不看登录态直接取；私有论文在 session
  // 未定/未登录时 ReaderPane 根本不会渲染 <PaperReaderView>，查询也绝不能发出去
  // （否则是一个注定 401 的请求）。用 isSessionResolved 而不是 !isSessionPending：
  // 它还驱动左栏在信息卡/目录卡之间切换，首帧提前分化同样会撞 #418。
  const isReaderViewReady =
    activeView === "reader" &&
    (!!data?.paper?.isPublic || (isSessionResolved && !!effectiveSession));
  const paperReader = usePaperReader(paperId, isReaderViewReady);

  // 中栏是 minmax(0,1fr)：收起聊天栏后它直接吃掉第三列的宽度，正文行宽从「被容器
  // 压住」跳到「由 --reader-measure 决定」（实测 762→963px），整篇长文重新断行、高度
  // 缩掉两成，而 scrollY 不变——读者眼前那一段会被顶走近二十屏。拖宽把手是同一回事，
  // 只是每帧几 px 所以不刺眼。两者都在改宽度之前捕获锚点，由 layout effect 在绘制前补偿。
  const summaryProseRef = useRef<HTMLDivElement | null>(null);
  // 两个视图各有各的正文容器，且互斥渲染，所以按当前视图现取：原文视图取 <article>，
  // 总结视图取那块 markdown 的 prose 容器（accordion 收起时它不挂载，取到 null 就不补偿）。
  // PDF 视图返回 null：它是内部滚动的定高面板，不随中栏宽度重排，没有可补偿的东西。
  const getAnchorRoot = useCallback(() => {
    if (activeView === "pdf") return null;
    return activeView === "reader"
      ? paperReader.articleRef.current
      : summaryProseRef.current;
  }, [activeView, paperReader.articleRef]);
  const { capture: captureReadingAnchor, release: releaseReadingAnchor } =
    useReadingAnchor(getAnchorRoot, `${chatCollapsed}:${chatPanelWidth}`);

  const handleChatCollapsedChange = useCallback(
    (next: boolean) => {
      captureReadingAnchor();
      setChatCollapsed(next);
    },
    [captureReadingAnchor],
  );

  // 拖拽是连续变化：按下时捕获一次并 hold 住，之后每一帧都对齐同一个锚点，松手才释放
  const handleChatResizeStart = useCallback(() => {
    captureReadingAnchor({ hold: true });
  }, [captureReadingAnchor]);

  const { data: whiteboardsData } = useQuery({
    ...trpc.paper.listWhiteboards.queryOptions(paperId),
    enabled: !!data?.paper && data.paper.status === "completed",
  });

  // 反馈按钮的装配（登录态四态 + 登录回跳地址 + 我的投票）走与 /gallery、方向主页、
  // 简报期页同一个 hook。这里原先是把 hook 里那道四态梯逐字抄了一遍，抄件不会跟着
  // 改——往梯子里加一档时详情页会静默保持旧行为。
  //
  // 回跳地址尤其不能自己拼：原先写死 `/p/${shortId}`，于是在
  // /p/abc?view=reader 上未登录点赞，OAuth 回来会落到 /p/abc，阅读态和查询串全丢。
  // hook 用的是 useRouterState 的 location.href，带全 search。
  //
  // paperId 为空（论文数据还没到）时传空数组而不是 [""]：hook 只按 signed-in 开关
  // 查询，不会替这里补 !!paperId 那道门，传 [""] 就是一次注定拿不到东西的请求。
  const { feedbackAuth, signInCallbackURL, myVoteByPaperId } = usePaperFeedback(
    paperId ? [paperId] : [],
  );
  const myVote = myVoteByPaperId.get(paperId);

  const deleteMutation = useMutation(
    trpc.paper.delete.mutationOptions({
      onSuccess: () => {
        // paper.list 页用 infiniteQueryOptions，key 带 type:"infinite"；
        // queryKey() 产出的 type:"query" 不是它的前缀，必须用 pathKey()。
        queryClient.invalidateQueries({
          queryKey: trpc.paper.list.pathKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.paper.statusCounts.queryKey(),
        });
        navigate({ to: "/papers" });
      },
    }),
  );

  const regenerateSummaryMutation = useMutation(
    trpc.paper.regenerateSummary.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.paper.getById.queryKey(paperId),
        });
      },
    }),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 1024px)");

    const syncViewport = (matches: boolean) => {
      setIsDesktopViewport(matches);
      if (!matches) {
        setIsWhiteboardPreviewOpen(false);
      }
    };

    syncViewport(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncViewport(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // 「最近打开」只在论文真的取到了才记；失败 / 404 不该污染列表页那三张卡。
  const recentShortId = data?.paper?.shortId;
  const recentTitle = data?.paper?.title;
  useEffect(() => {
    if (!recentShortId || !recentTitle) return;
    pushRecentPaper({
      shortId: recentShortId,
      title: recentTitle,
      openedAt: Date.now(),
    });
  }, [recentShortId, recentTitle]);

  const handleCopyMarkdown = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Show loading while checking session
  if (isSessionPending && !ssrData) return <DetailSkeleton />;
  if (isLoading && !data) return <DetailSkeleton />;

  // Handle errors
  if (error) {
    const isForbidden =
      error.message?.includes("permission") ||
      error.message?.includes("FORBIDDEN");
    const isNotFound =
      error.message?.includes("not found") ||
      error.message?.includes("NOT_FOUND");

    return <PaperErrorPage isNotFound={isNotFound} isForbidden={isForbidden} />;
  }

  if (!data) return null;

  const { paper, result, defaultWhiteboard, hasContent, likeCount } = data;
  const progress = statusProgress[paper.status] ?? 0;
  const whiteboardImageUrl = defaultWhiteboard?.imageR2Key
    ? `/api/r2/${defaultWhiteboard.imageR2Key}`
    : null;

  // 公开论文用带水印的稳定路由 (预览/下载/嵌入一致带水印);
  // owner 看私有论文仍用原始 R2 (无水印, 稳定路由也取不到私有图)。
  const publicImageBase = paper.isPublic
    ? `/p/${paper.shortId ?? shortId}/image`
    : null;
  const displayImageUrl = publicImageBase ?? whiteboardImageUrl ?? undefined;
  const downloadImageUrl =
    (publicImageBase ? `${publicImageBase}?download` : whiteboardImageUrl) ??
    undefined;

  const isOwner = paper.userId === profile.data?.id;

  // 不用 useMemo：这里已在 early return 之后，hook 放这儿会违反调用顺序规则。每次渲染
  // 新建一个对象与内联写 visibility={{...}} 的身份行为完全一致，没有额外代价。
  const quoteShareVisibility = {
    isPublic: paper.isPublic,
    canPublish: isOwner,
  };

  // isReaderAvailable / activeView / isReaderViewReady 已提到 paperId 计算之后
  // （usePaperReader 需要提前知道是否该发请求）。
  // 处理中的论文保留控件（原文项置灰），让人知道有这么个视图；处理失败的论文
  // 既没有总结也永远不会有原文，两个视图都是空的，整组控件隐藏而不是只置灰一项。
  const showViewSwitch = paper.status !== "failed";

  // owner 的论文完成了却一张白板都没有（如上传时未勾选生成）——给一个显式入口，
  // 而不是让白板区块凭空消失。非 owner 看不到任何白板区块。
  const whiteboardCount =
    whiteboardsData?.whiteboards.length ?? data.whiteboards.length;
  const showWhiteboardCta =
    isOwner && paper.status === "completed" && whiteboardCount === 0;

  // 访客语言选择：优先用页面当前语言，否则回退到 result.summaryLanguage
  const effectiveGuestLanguage = (() => {
    if (!result) return null;
    const availableLanguages = result.availableLanguages ?? [];
    if (
      guestSelectedLanguage &&
      availableLanguages.includes(guestSelectedLanguage)
    ) {
      return guestSelectedLanguage;
    }
    // 将 paraglide locale 格式（zh-CN）映射为摘要语言格式（zh-cn）
    const pageLocale = getLocale().toLowerCase() as string;
    if (availableLanguages.includes(pageLocale)) return pageLocale;
    return result.summaryLanguage;
  })();

  const guestSummary = result
    ? ((result.summaries as Record<string, string>)?.[
        effectiveGuestLanguage ?? ""
      ] ?? result.summary)
    : null;

  // 三栏生效时把容器从 1200px 放宽到 1520px，否则 300+360 两条侧栏会把正文压到
  // ~490px。这里没沿用 .page-wrap 再加 xl:w-*：styles.css 里的 .page-wrap 是
  // 无 layer 的裸类，优先级高于 Tailwind 的 utilities layer，覆盖不动；改成直接
  // 写等价 utility。两个分支都是完整字符串，Tailwind 静态扫描能收到。
  const containerClassName =
    paper.status === "completed"
      ? "mx-auto w-[min(1200px,calc(100%_-_2rem))] py-8 xl:w-[min(1520px,calc(100%_-_2rem))]"
      : "page-wrap py-8";
  // 三档布局：未完成（无 chat 列）/ PDF（无左栏）/ 常规三栏。每档再按 chat 是否收起分两种。
  // 六个分支都是完整字符串字面量（Tailwind 静态扫描要求）。
  const gridClassName = (() => {
    if (paper.status !== "completed") {
      // 未完成的论文必须退回两栏，否则右侧空出 360px 死区把正文挤偏。
      return "mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start";
    }
    if (activeView === "pdf") {
      // PDF 态砍掉左栏：极简档不做左栏大纲，剩下的元信息已挪进 PDF 工具栏。
      // 单栏 → xl 才让出 chat 那一列，PDF 因此能拿到 ~1130px。
      return chatCollapsed
        ? "mt-6 grid gap-6"
        : "mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_var(--chat-panel-width)] xl:items-start";
    }
    // 常规三栏：xl+ 让出第三栏给提问面板（正文仍有 ~810px），收起时那一列还给正文；
    // xl 以下聊天折叠成右下角悬浮按钮，不占版面。
    return chatCollapsed
      ? "mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start xl:grid-cols-[300px_minmax(0,1fr)]"
      : "mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start xl:grid-cols-[300px_minmax(0,1fr)_var(--chat-panel-width)]";
  })();
  // 面包屑 / 分享条 / 相关论文始终占满容器全宽（1520px），不随聊天栏宽度让位：
  // 聊天 aside 是 sticky 且只存在于中间那段 grid 里，上下这些块横穿无碍。

  return (
    <main
      className={containerClassName}
      // 聊天栏宽度经 CSS 变量驱动 grid 第三列。
      // SSR 输出默认 360px，挂载后由 effect 恢复用户拖过的值
      style={{ "--chat-panel-width": `${chatPanelWidth}px` } as CSSProperties}
    >
      <div className="stagger-in">
        {/* Breadcrumb */}
        <nav className="flex items-start gap-1 text-sm text-[var(--ink-soft)]">
          <Link to="/papers" className="hover:text-[var(--ink)] shrink-0">
            {m.papers_title()}
          </Link>
          <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="text-[var(--ink)] break-words min-w-0">
            {paper.title}
          </span>
        </nav>

        {/* Share Banner - only show to owner */}
        {isOwner && (
          <div>
            <ShareBanner
              paperId={paper.id}
              shortId={paper.shortId ?? shortId}
              isPublic={paper.isPublic}
              // 白板是可选产物：没有白板也能公开（上架画廊才要求白板，见
              // paper.toggleGalleryListing）。生成中时先不放行，避免公开的瞬间
              // 白板还在替换。
              canShare={
                paper.status === "completed" && !paper.whiteboardRegenerating
              }
            />
          </div>
        )}

        <div className={gridClassName}>
          {activeView !== "pdf" && (
            <aside
              className={
                isReaderViewReady
                  ? "flex flex-col gap-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)]"
                  : "space-y-4 lg:sticky lg:top-24"
              }
            >
              {isReaderViewReady ? (
                <ReaderAsidePanel
                  paper={paper}
                  tocItems={paperReader.toc.items}
                  tocActiveId={paperReader.toc.activeId}
                  onTocJump={paperReader.toc.jumpTo}
                />
              ) : (
                <>
                  <div className="paper-card p-6">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--parchment-warm)]">
                        <FileText className="h-6 w-6 text-[var(--academic-brown)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h1 className="font-serif text-lg font-bold text-[var(--ink)] break-words">
                          {paper.title}
                        </h1>
                        <p className="text-xs text-[var(--ink-soft)]">
                          {/* 不能在首帧渲染：服务端 Worker 跑在 UTC、浏览器在本地
                              时区，Intl 对同一时刻输出不同文本，SSR 与客户端首帧
                              必然不一致 → React #418。首帧用 nbsp 占住行高，
                              挂载后再填本地时间。 */}
                          {hydrated
                            ? new Date(paper.createdAt).toLocaleString()
                            : "\u00A0"}
                        </p>
                      </div>
                    </div>

                    {/* 赞/踩：只对上架画廊的公开论文开放，与 paper.setFeedback 的
                        放行条件一致（私有论文投票必定 NOT_FOUND） */}
                    {paper.isPublic && paper.isListedInGallery && (
                      <div className="mt-4 border-t border-[var(--line)] pt-3">
                        <FeedbackButtons
                          paperId={paper.id}
                          likeCount={likeCount}
                          myVote={myVote}
                          auth={feedbackAuth}
                          signInCallbackURL={signInCallbackURL}
                          variant="detail"
                        />
                      </div>
                    )}

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[var(--ink-soft)]">
                          {m.paper_status()}
                        </span>
                        <StatusBadge status={paper.status} />
                      </div>
                      {paper.status !== "failed" && (
                        <Progress value={progress} className="mt-2 h-2" />
                      )}
                      {paper.errorMessage && (
                        <p className="mt-2 text-xs text-[var(--sienna)]">
                          {paper.errorMessage}
                        </p>
                      )}
                      {paper.isPublic && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--ink-soft)]">
                            {m.paper_visibility()}
                          </span>
                          <PublicBadge />
                        </div>
                      )}
                    </div>

                    <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-[var(--ink-soft)]">
                          {m.paper_source()}
                        </span>
                        <span className="text-right">
                          {paper.sourceType === "arxiv" && paper.sourceUrl ? (
                            <a
                              href={paper.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--academic-brown)] hover:underline"
                            >
                              arXiv
                            </a>
                          ) : paper.sourceType === "arxiv" ? (
                            "arXiv"
                          ) : (
                            m.paper_source_upload()
                          )}
                        </span>
                      </div>
                      {paper.pageCount && (
                        <div className="flex justify-between gap-4">
                          <span className="text-[var(--ink-soft)]">
                            {m.paper_pages()}
                          </span>
                          <span className="text-right">{paper.pageCount}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-4">
                        <span className="text-[var(--ink-soft)]">
                          {m.paper_size()}
                        </span>
                        <span className="text-right">
                          {(paper.fileSize / 1024 / 1024).toFixed(2)} MB
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2 border-t border-[var(--line)] pt-4">
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={`/api/r2/${paper.pdfR2Key}`}
                          download={`${paper.title}.pdf`}
                        >
                          <Download className="mr-1.5 h-4 w-4" />
                          {m.paper_download_pdf()}
                        </a>
                      </Button>
                      {/* Only show delete button to paper owner */}
                      {isOwner &&
                        (isReadOnlyGuest ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-[var(--sienna)]"
                            onClick={startGitHubSignIn}
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            {m.paper_delete()}
                          </Button>
                        ) : (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-[var(--sienna)]"
                              >
                                <Trash2 className="mr-1.5 h-4 w-4" />
                                {m.paper_delete()}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  {m.paper_delete_confirm_title()}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {m.paper_delete_confirm_description()}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>
                                  {m.cancel()}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(paperId)}
                                  className="bg-[var(--sienna)] hover:bg-[var(--sienna)]/90"
                                >
                                  {m.paper_delete()}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ))}
                    </div>
                  </div>

                  {activeView === "summary" && showWhiteboardCta && (
                    <WhiteboardCtaCard
                      regenerating={paper.whiteboardRegenerating}
                      onGenerate={() => {
                        if (isReadOnlyGuest) {
                          startGitHubSignIn();
                          return;
                        }
                        setIsRegenerateOpen(true);
                      }}
                    />
                  )}

                  {activeView === "summary" && whiteboardImageUrl && (
                    <div className="paper-card p-4 sm:p-5">
                      <div className="mb-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
                            {m.paper_whiteboard()}
                          </h2>
                          {paper.whiteboardRegenerating && (
                            <div className="flex items-center gap-1.5 text-sm text-[var(--academic-brown)]">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span className="hidden sm:inline">
                                {m.paper_whiteboard_regenerating()}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {paper.isPublic && whiteboardImageUrl && (
                            <ShareDialog
                              shortId={paper.shortId ?? shortId}
                              title={paper.title}
                            />
                          )}
                          {whiteboardsData &&
                            whiteboardsData.whiteboards.length > 1 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setIsGalleryOpen(true)}
                                className="gap-1.5"
                              >
                                <ImageIcon className="h-4 w-4" />
                                <span className="hidden sm:inline">
                                  {m.paper_whiteboard_view_all()}
                                </span>
                              </Button>
                            )}
                          {isOwner && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setIsRegenerateOpen(true)}
                              className="gap-1.5"
                            >
                              <Sparkles className="h-4 w-4" />
                              <span className="hidden sm:inline">
                                {m.paper_whiteboard_regenerate()}
                              </span>
                            </Button>
                          )}
                          <Button variant="outline" size="sm" asChild>
                            <a
                              href={downloadImageUrl}
                              download={`${paper.title}-whiteboard.png`}
                              className="gap-1.5"
                            >
                              <Download className="h-4 w-4" />
                              <span className="hidden sm:inline">
                                {m.paper_whiteboard_download()}
                              </span>
                            </a>
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-[var(--line)] bg-[var(--parchment-warm)] p-3 lg:hidden">
                        <div className="overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(245,237,223,0.95))]">
                          <img
                            src={displayImageUrl}
                            alt={`${paper.title} ${m.paper_whiteboard()}`}
                            className="mx-auto h-auto max-h-[420px] w-full object-contain"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (isDesktopViewport) {
                            setIsWhiteboardPreviewOpen(true);
                          }
                        }}
                        className="group hidden w-full rounded-2xl border border-[var(--line)] bg-[var(--parchment-warm)] p-3 text-left transition hover:border-[var(--academic-brown)]/30 hover:shadow-[0_18px_50px_rgba(87,61,38,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/35 lg:block"
                        aria-label={m.paper_whiteboard()}
                      >
                        <div className="relative overflow-hidden rounded-xl bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(245,237,223,0.95))]">
                          <img
                            src={displayImageUrl}
                            alt={`${paper.title} ${m.paper_whiteboard()}`}
                            className="mx-auto h-auto max-h-[360px] w-full object-contain transition duration-300 group-hover:scale-[1.015]"
                          />
                          <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full border border-white/80 bg-white/88 px-3 py-1.5 text-xs font-medium text-[var(--ink)] shadow-sm backdrop-blur-sm">
                            <Maximize2 className="h-3.5 w-3.5" />
                            <span>{m.paper_whiteboard()}</span>
                          </div>
                        </div>
                      </button>
                    </div>
                  )}
                </>
              )}
            </aside>
          )}

          <section className="space-y-4 min-w-0">
            {showViewSwitch && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Tabs
                  value={activeView}
                  onValueChange={(v) =>
                    showView(v as "summary" | "reader" | "pdf")
                  }
                >
                  <TabsList>
                    <TabsTrigger value="summary">
                      {m.paper_view_summary()}
                    </TabsTrigger>
                    <TabsTrigger
                      value="reader"
                      disabled={!isReaderAvailable}
                      title={
                        isReaderAvailable
                          ? undefined
                          : m.paper_content_unavailable()
                      }
                    >
                      {m.paper_view_reader()}
                    </TabsTrigger>
                    <TabsTrigger
                      value="pdf"
                      disabled={!isPdfAvailable}
                      title={
                        isPdfAvailable ? undefined : m.paper_processing_hint()
                      }
                    >
                      {m.paper_view_pdf()}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {/* 置灰的 tab 自己解释不了原因，而 title 在禁用元素上并非处处可见：
                    论文已完成却没有解析产物时，旁边补一句可见的说明。 */}
                {paper.status === "completed" && !hasContent && (
                  <p className="text-xs text-[var(--ink-soft)]">
                    {m.paper_content_unavailable()}
                  </p>
                )}
              </div>
            )}

            {activeView === "pdf" ? (
              <Suspense
                fallback={
                  <PaperStateCard
                    icon={Loader2}
                    spinning
                    message={m.pdf_loading()}
                  />
                }
              >
                <PdfReaderView
                  url={`/api/r2/${paper.pdfR2Key}`}
                  title={paper.title}
                  initialPage={pdfPageRef.current}
                  onPageChange={handlePdfPageChange}
                  onAskSelection={handleAskSelection}
                  onShareSelection={(text, page) =>
                    quoteShare.openShare({
                      url: paperPdfPageUrl(paper.shortId ?? shortId, page),
                      // 只折空白、不按长度裁：长度策略归 plainCardContent（见那边的
                      // 注释），拿 normalizePdfSelection 预处理会让卡片的截断提示丢掉。
                      content: plainCardContent(
                        collapseSelectionWhitespace(text),
                        page,
                      ),
                    })
                  }
                />
              </Suspense>
            ) : activeView === "reader" ? (
              <ReaderPane
                reader={paperReader}
                isPublic={paper.isPublic}
                shortId={paper.shortId ?? shortId}
                onShare={quoteShare.openShare}
                onAskSelection={handleAskSelection}
                isSessionResolved={isSessionResolved}
                isSignedIn={!!effectiveSession}
                onSignIn={startReaderSignIn}
              />
            ) : result ? (
              <Accordion type="single" collapsible defaultValue="summary">
                <AccordionItem value="summary" className="paper-card px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <AccordionTrigger className="font-serif text-lg font-semibold flex-1 py-0 hover:no-underline">
                      <span className="hover:underline">
                        {m.paper_summary()}
                      </span>
                    </AccordionTrigger>
                    <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
                      {paper.isPublic && whiteboardImageUrl && (
                        <ShareDialog
                          shortId={paper.shortId ?? shortId}
                          title={paper.title}
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          handleCopyMarkdown(
                            isOwner
                              ? result.summary
                              : (guestSummary ?? result.summary),
                          )
                        }
                        className="gap-1.5"
                      >
                        {copied ? (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            {m.paper_summary_copied()}
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            {m.paper_summary_copy()}
                          </>
                        )}
                      </Button>
                      {/* Only show language selector to paper owner */}
                      {isOwner && (
                        <Select
                          value={result.summaryLanguage || "en"}
                          onValueChange={(
                            value: "en" | "zh-cn" | "zh-tw" | "ja",
                          ) => {
                            if (isReadOnlyGuest) {
                              startGitHubSignIn();
                              return;
                            }
                            regenerateSummaryMutation.mutate({
                              paperId,
                              language: value,
                            });
                          }}
                          disabled={regenerateSummaryMutation.isPending}
                        >
                          <SelectTrigger className="h-9 w-auto min-w-0 max-w-full">
                            <div className="flex items-center gap-1.5 w-full">
                              {regenerateSummaryMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                              ) : (
                                <Languages className="h-4 w-4 shrink-0" />
                              )}
                              <SelectValue />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en">
                              {m.upload_language_en()}
                            </SelectItem>
                            <SelectItem value="zh-cn">
                              {m.upload_language_zh()}
                            </SelectItem>
                            <SelectItem value="zh-tw">
                              {m.upload_language_zh_tw()}
                            </SelectItem>
                            <SelectItem value="ja">
                              {m.upload_language_ja()}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {/* Guest read-only language switcher: only show if multiple languages cached */}
                      {!isOwner &&
                        result.availableLanguages &&
                        result.availableLanguages.length > 1 && (
                          <Select
                            value={
                              effectiveGuestLanguage ?? result.summaryLanguage
                            }
                            onValueChange={(value) =>
                              setGuestSelectedLanguage(value)
                            }
                          >
                            <SelectTrigger className="h-9 w-auto min-w-0 max-w-full">
                              <div className="flex items-center gap-1.5 w-full">
                                <Languages className="h-4 w-4 shrink-0" />
                                <SelectValue />
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              {result.availableLanguages.map((lang) => (
                                <SelectItem key={lang} value={lang}>
                                  {lang === "en" && m.upload_language_en()}
                                  {lang === "zh-cn" && m.upload_language_zh()}
                                  {lang === "zh-tw" &&
                                    m.upload_language_zh_tw()}
                                  {lang === "ja" && m.upload_language_ja()}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                    </div>
                  </div>
                  <AccordionContent>
                    {/* ref 供 useReadingAnchor 取锚点：总结正文同样会随中栏宽度重排 */}
                    <div
                      ref={summaryProseRef}
                      className="prose prose-sm max-w-none text-[var(--ink)] break-words overflow-hidden"
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex, rehypeHighlight]}
                        components={{
                          pre: ({ children }) => (
                            <pre className="overflow-x-auto max-w-full">
                              {children}
                            </pre>
                          ),
                          code: ({ children, className }) => (
                            <code className={`${className || ""} break-words`}>
                              {children}
                            </code>
                          ),
                          table: ({ children }) => (
                            <div className="overflow-x-auto">
                              <table>{children}</table>
                            </div>
                          ),
                        }}
                      >
                        {normalizeMathMarkdown(
                          isOwner
                            ? result.summary
                            : (guestSummary ?? result.summary),
                        )}
                      </ReactMarkdown>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : paper.status !== "failed" ? (
              <PaperStateCard
                icon={Loader2}
                spinning
                message={m.paper_processing_hint()}
              />
            ) : null}
          </section>

          {/* 论文处理完成才有可问的内容；未登录时面板只渲染登录提示 */}
          {paper.status === "completed" && (
            <PaperChat
              paperShortId={paper.shortId ?? shortId}
              // 用 effectiveSession：review-guest 有意豁免，后端 chat router /
              // api 都允许 guest 发消息，入口不能反倒把它挡在登录提示后面
              isSignedIn={!!effectiveSession}
              isSessionResolved={isSessionResolved}
              onSignIn={startGitHubSignIn}
              panelWidth={chatPanelWidth}
              onPanelWidthChange={setChatPanelWidth}
              onPanelResizeStart={handleChatResizeStart}
              onPanelResizeEnd={releaseReadingAnchor}
              collapsed={chatCollapsed}
              onCollapsedChange={handleChatCollapsedChange}
              pendingQuote={pendingQuote}
              onPendingQuoteConsumed={handleQuoteConsumed}
            />
          )}

          {/* 分享弹窗挂在页面级：各视图只负责在点击当时算出深链与卡片正文 */}
          <QuoteShareDialog
            open={!!quoteShare.payload}
            onOpenChange={(next) => {
              if (!next) quoteShare.closeShare();
            }}
            url={quoteShare.payload?.url ?? ""}
            content={quoteShare.payload?.content ?? null}
            title={paper.title}
            visibility={quoteShareVisibility}
            publishing={quoteShare.publishing}
            onMakePublic={quoteShare.makePublic}
          />
        </div>

        {/* Related papers — real, crawlable internal links (SSR-rendered). */}
        {relatedPapers.length > 0 && (
          <section className="mt-10" aria-labelledby={relatedHeadingId}>
            <h2
              id={relatedHeadingId}
              className="font-serif text-lg font-semibold text-[var(--ink)]"
            >
              {m.paper_related_title()}
            </h2>
            <ul className="mt-4 divide-y divide-[var(--line)] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--parchment)]">
              {relatedPapers.map((rp) => {
                const tldrText = pickTldr(rp.tldr, relatedLocaleKey);
                return (
                  <li key={rp.shortId}>
                    <Link
                      to="/p/$shortId"
                      params={{ shortId: rp.shortId }}
                      className="group flex items-start gap-3 px-5 py-4 transition-colors hover:bg-[var(--parchment-warm)]/60"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--academic-brown)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
                            {rp.title}
                          </span>
                          {rp.publishedAt && (
                            <time className="shrink-0 text-xs text-[var(--ink-soft)]">
                              {new Date(rp.publishedAt).getFullYear()}
                            </time>
                          )}
                        </div>
                        {tldrText && (
                          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[var(--ink-soft)]">
                            {tldrText}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 self-center text-[var(--ink-soft)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--academic-brown)]" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {whiteboardImageUrl && (
          <Dialog
            open={isDesktopViewport && isWhiteboardPreviewOpen}
            onOpenChange={(open) => {
              setIsWhiteboardPreviewOpen(open && isDesktopViewport);
            }}
          >
            <DialogContent className="max-h-[96vh] max-w-[min(98vw,1440px)] rounded-[28px] border-[var(--line)] bg-[var(--parchment)] p-2 shadow-[0_30px_120px_rgba(39,29,21,0.35)] sm:max-w-[min(98vw,1440px)] sm:p-5">
              <DialogTitle className="sr-only">
                {paper.title} {m.paper_whiteboard()}
              </DialogTitle>

              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4 pr-10">
                  <div className="min-w-0">
                    <h2 className="font-serif text-xl font-semibold text-[var(--ink)] break-words">
                      {m.paper_whiteboard()}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--ink-soft)] break-words">
                      {paper.title}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={downloadImageUrl}
                      download={`${paper.title}-whiteboard.png`}
                      className="gap-1.5"
                    >
                      <Download className="h-4 w-4" />
                      {m.paper_whiteboard_download()}
                    </a>
                  </Button>
                </div>

                <div className="overflow-auto rounded-[22px] border border-[var(--line)] bg-[var(--parchment-warm)]/80 p-2 sm:p-4">
                  <img
                    src={displayImageUrl}
                    alt={`${paper.title} ${m.paper_whiteboard()}`}
                    className="mx-auto h-auto max-h-[calc(96vh-8rem)] w-full object-contain rounded-[18px]"
                  />
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Gallery Dialog */}
        {whiteboardsData && (
          <WhiteboardGalleryDialog
            paperId={paperId}
            whiteboards={whiteboardsData.whiteboards}
            open={isGalleryOpen}
            onOpenChange={setIsGalleryOpen}
            readOnly={paper.userId !== profile.data?.id}
          />
        )}

        {/* Regenerate Dialog */}
        <RegenerateWhiteboardDialog
          paperId={paperId}
          open={isRegenerateOpen}
          onOpenChange={setIsRegenerateOpen}
        />
      </div>
    </main>
  );
}

/**
 * 原文视图的分诊：公开论文直接出原文（不看登录态）；私有论文 session 未定 → 占位，
 * 未登录 → 登录墙，已登录 → 原文。（服务端才是权限的真实边界，这里只是体验层。）
 */
function ReaderPane({
  reader,
  isPublic,
  shortId,
  onShare,
  onAskSelection,
  isSessionResolved,
  isSignedIn,
  onSignIn,
}: {
  reader: PaperReaderState;
  isPublic: boolean;
  shortId: string;
  onShare: (payload: QuoteSharePayload) => void;
  onAskSelection: (text: string) => void;
  /** hydration 完成且 useSession 已解析（见页面组件的推导注释） */
  isSessionResolved: boolean;
  isSignedIn: boolean;
  onSignIn: () => void;
}) {
  // 公开论文谁都能读，没必要等 session 解析完——段落深链的访客多半没登录过，
  // 让他们先等一轮 session 往返再出正文纯属白等。
  if (isPublic) {
    return (
      <PaperReaderView
        reader={reader}
        shortId={shortId}
        onShare={onShare}
        onAskSelection={onAskSelection}
      />
    );
  }

  // SSR / 客户端首帧 session 还没确定：两端都渲染这份中性骨架（结构必须逐字节
  // 同构，否则 #418），也顺带避免把已登录用户闪一下登录墙。
  if (!isSessionResolved) {
    return (
      <PaperPanelSkeleton className="paper-card paper-card-static min-h-80 p-4 sm:p-6" />
    );
  }

  if (!isSignedIn) {
    return (
      <PaperStateCard
        icon={BookOpen}
        message={m.paper_reader_login_required()}
        action={
          <Button variant="outline" size="sm" onClick={onSignIn}>
            {m.auth_sign_in_github()}
          </Button>
        }
      />
    );
  }

  return (
    <PaperReaderView
      reader={reader}
      shortId={shortId}
      onShare={onShare}
      onAskSelection={onAskSelection}
    />
  );
}

/**
 * 原文阅读态的左栏：压缩元信息卡（标题/状态/下载）+ 目录卡，替代总结态的完整信息卡。
 * 只在 ReaderPane 真正渲染正文（已登录、非 pending）时才由调用方切到这个分支。
 */
function ReaderAsidePanel({
  paper,
  tocItems,
  tocActiveId,
  onTocJump,
}: {
  paper: { title: string; status: string; pdfR2Key: string };
  tocItems: TocItem[];
  tocActiveId: string;
  onTocJump: (id: string) => void;
}) {
  return (
    <>
      <div className="paper-card shrink-0 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--parchment-warm)]">
            <FileText className="h-5 w-5 text-[var(--academic-brown)]" />
          </div>
          <h1 className="line-clamp-3 min-w-0 flex-1 font-serif text-sm font-bold leading-snug text-[var(--ink)] break-words">
            {paper.title}
          </h1>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <StatusBadge status={paper.status} />
          <Button variant="outline" size="sm" asChild>
            <a
              href={`/api/r2/${paper.pdfR2Key}`}
              download={`${paper.title}.pdf`}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {m.paper_download_pdf()}
            </a>
          </Button>
        </div>
      </div>

      {/* <lg 时正文单栏堆叠，这张常驻目录卡会把正文推得很远——隐藏，改走
          ReaderArticle 头部的目录按钮开抽屉（见 reader-toc-drawer.tsx）。
          paper-card-static 去掉悬浮位移：这是常驻导航卡，不是可点击跳转的入口卡片，
          hover 上浮是噪音（见 styles.css）。 */}
      {tocItems.length > 0 && (
        <div className="paper-card paper-card-static hidden min-h-0 flex-col p-4 lg:flex">
          <span className="shrink-0 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            {m.reader_toc()}
          </span>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <TocList
              items={tocItems}
              activeId={tocActiveId}
              onJump={onTocJump}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** owner 的论文完成了却一张白板都没有时，白板区块的行动召唤。 */
function WhiteboardCtaCard({
  regenerating,
  onGenerate,
}: {
  regenerating: boolean;
  onGenerate: () => void;
}) {
  return (
    <PaperStateCard
      className="p-6"
      title={m.paper_whiteboard()}
      message={m.paper_generate_whiteboard_hint()}
      action={
        regenerating ? (
          <div className="flex items-center justify-center gap-1.5 text-sm text-[var(--academic-brown)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {m.paper_whiteboard_regenerating()}
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onGenerate}
          >
            <Sparkles className="h-4 w-4" />
            {m.paper_generate_whiteboard()}
          </Button>
        )
      }
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<
    string,
    { label: () => string; icon: React.ElementType; className: string }
  > = {
    pending: {
      label: () => m.papers_status_pending(),
      icon: Clock,
      className: "bg-[var(--neutral-light)] text-[var(--ink-soft)]",
    },
    parsing: {
      label: () => m.papers_status_parsing(),
      icon: Loader2,
      className: "bg-[var(--academic-brown)]/10 text-[var(--academic-brown)]",
    },
    processing_text: {
      label: () => m.papers_status_processing_text(),
      icon: Loader2,
      className: "bg-[var(--academic-brown)]/10 text-[var(--academic-brown)]",
    },
    processing_image: {
      label: () => m.papers_status_processing_image(),
      icon: ImageIcon,
      className: "bg-[var(--gold)]/10 text-[var(--academic-brown-deep)]",
    },
    completed: {
      label: () => m.papers_status_completed(),
      icon: CheckCircle2,
      className: paperCompletedBadgeToneClassName,
    },
    failed: {
      label: () => m.papers_status_failed(),
      icon: XCircle,
      className: "bg-[var(--sienna)]/10 text-[var(--sienna)]",
    },
  };
  const c = configs[status] ?? configs.pending;
  const Icon = c.icon;
  const isSpinning = status === "parsing" || status.startsWith("processing");
  return (
    <Badge variant="outline" className={`gap-1 ${c.className}`}>
      <Icon className={`h-3 w-3 ${isSpinning ? "animate-spin" : ""}`} />
      {c.label()}
    </Badge>
  );
}

function DetailSkeleton() {
  return (
    <main className="page-wrap py-8">
      <Skeleton className="h-4 w-48" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-60 rounded-xl" />
      </div>
    </main>
  );
}

function PaperErrorPage({
  isNotFound,
  isForbidden,
}: {
  isNotFound: boolean;
  isForbidden: boolean;
}) {
  const title = isNotFound
    ? m.paper_not_found_title()
    : isForbidden
      ? m.paper_not_public_title()
      : m.paper_not_found_title();

  const description = isNotFound
    ? m.paper_not_found_description()
    : isForbidden
      ? m.paper_not_public_description()
      : m.paper_not_found_description();

  return (
    <main className="page-wrap py-8">
      <div className="rise-in mx-auto max-w-md py-16 text-center">
        <div className="mb-6 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-[var(--sienna)]/10 shadow-[0_8px_24px_rgba(139,111,71,0.12)]">
            <AlertCircle className="h-12 w-12 text-[var(--sienna)]" />
          </div>
        </div>
        <h2 className="mb-3 font-serif text-2xl font-bold text-[var(--ink)]">
          {title}
        </h2>
        <p className="mb-6 text-base text-[var(--ink-soft)]">{description}</p>
        <Link
          to="/papers"
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--academic-brown)] px-6 py-3 text-sm font-semibold !text-white shadow-[0_4px_12px_rgba(139,111,71,0.24)] transition-all hover:-translate-y-1 hover:shadow-[0_6px_16px_rgba(139,111,71,0.32)] no-underline"
        >
          <FileText className="h-4 w-4" />
          {m.paper_error_back()}
        </Link>
      </div>
    </main>
  );
}
