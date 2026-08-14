import { useQuery } from "@tanstack/react-query";
import { FileText, List, Loader2 } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  createRelativeImageUrlTransform,
  MarkdownArticle,
} from "#/components/markdown-reader/markdown-article";
import { QuoteShareOverlay } from "#/components/markdown-reader/quote-share/quote-share-overlay";
import type { QuoteSharePayload } from "#/components/markdown-reader/quote-share/use-quote-share";
import { ReaderSettingsMenu } from "#/components/markdown-reader/reader-settings";
import { useToc } from "#/components/markdown-reader/reader-toc";
import { ReaderTocDrawer } from "#/components/markdown-reader/reader-toc-drawer";
import { useReaderSettings } from "#/components/markdown-reader/use-reader-settings";
import { PaperStateCard } from "#/components/papers/paper-state-card";
import { TOOL_BTN } from "#/components/reader-ui";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/**
 * 页面级 hook：把「原文阅读」的 getContent 查询与 TOC 提升到详情页，好让目录能渲染在
 * 页面左栏而不是挤在中栏卡片内部。
 *
 * `enabled` 由调用方传入，必须与 ReaderPane 决定渲染 <PaperReaderView> 的条件完全一致
 * （原文视图激活 + isReaderAvailable + 公开-或-已登录）——否则私有论文在未登录/pending
 * 时会打一个注定 401 的请求。tanstack-query 按 queryKey 去重，多处引用同一 paperId
 * 不会重复发请求。
 */
export function usePaperReader(paperId: string, enabled: boolean) {
  const trpc = useTRPC();
  const query = useQuery({
    ...trpc.paper.getContent.queryOptions({ paperId }),
    // 原文内容不可变（解析产物写死在 R2），取过一次就不必再取
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });

  // articleRef 建在页面层，但持有它的 <article> 会随 tab 切换整体卸载/重挂。用挂载
  // 计数拼进 useToc 的 contentKey：markdown 没变时 effect 本不会重跑，但节点已经换了，
  // 必须逼它在每次重新挂载后都重新扫描 DOM，否则 TOC 会拿着失效节点、scrollspy 失灵。
  // 卸载（node === null）也要 bump：否则切到总结视图时 contentKey 不变，useToc 那次
  // effect 的 cleanup（IntersectionObserver.disconnect）永远不会跑，观察者继续挂在
  // 已 detach 的标题节点上，把整棵 article DOM（含 katex 渲染产物）泄漏到切回原文为止。
  const articleRef = useRef<HTMLElement | null>(null);
  const [mountTick, setMountTick] = useState(0);
  // 引用必须稳定：这个函数经 MarkdownArticle 透传给 <article ref={...}>，若每次渲染
  // 都换新函数，React 会在每次渲染都先以 null 调用旧 ref 再以新节点调用新 ref——那样
  // 每次渲染都会 bump mountTick、触发重渲染、再换新 ref，死循环。
  const setArticleRef = useCallback((node: HTMLElement | null) => {
    articleRef.current = node;
    setMountTick((tick) => tick + 1);
  }, []);

  const markdown = query.data?.available ? query.data.markdown : "";
  // 用 useMemo 稳定这个字符串：page 级别的任何其他 state 变化（如聊天面板拖宽把手每次
  // pointermove 都 setState）都会重渲染这里，若不 memo，每次都要重新拼一遍整篇 markdown
  // 长度的字符串——拖拽时每秒上百次，白白浪费。
  const contentKey = useMemo(
    () => `${markdown}::${mountTick}`,
    [markdown, mountTick],
  );
  const toc = useToc(articleRef, contentKey);

  // articleRef 一并交出去：页面层收起/展开聊天栏时要拿正文节点做滚动锚定
  // （见 useReadingAnchor），也给「选中分享」的气泡定位用。contentKey 交给
  // Task 3 的落地定位 hook（用来在正文重新挂载后触发一次滚动）。
  return { query, articleRef, setArticleRef, contentKey, toc };
}

export type PaperReaderState = ReturnType<typeof usePaperReader>;

/**
 * 论文详情页的「原文阅读」视图：渲染 MinerU 解析出的全文 Markdown。
 *
 * 受控组件：查询状态与 articleRef 由 usePaperReader（页面层）提供，这里只负责三态
 * UI（加载 / 出错 / 内容不可用）与正文渲染。登录墙仍在调用方（ReaderPane）处理。
 */
export function PaperReaderView({
  reader,
  shortId,
  onShare,
  onAskSelection,
}: {
  reader: PaperReaderState;
  shortId: string;
  onShare: (payload: QuoteSharePayload) => void;
  onAskSelection: (text: string) => void;
}) {
  const { data, isPending, isError } = reader.query;

  if (isPending) {
    return (
      <PaperStateCard
        icon={Loader2}
        spinning
        message={m.paper_content_loading()}
      />
    );
  }

  if (isError) {
    return (
      <PaperStateCard tone="danger" message={m.paper_content_load_failed()} />
    );
  }

  // 说明性空态：这篇论文没走 MinerU 解析，不是加载失败。
  if (!data.available) {
    return (
      <PaperStateCard icon={FileText} message={m.paper_content_unavailable()} />
    );
  }

  return (
    <ReaderArticle
      markdown={data.markdown}
      imageBase={data.imageBase}
      articleRef={reader.articleRef}
      setArticleRef={reader.setArticleRef}
      contentKey={reader.contentKey}
      toc={reader.toc}
      shortId={shortId}
      onShare={onShare}
      onAskSelection={onAskSelection}
    />
  );
}

function ReaderArticle({
  markdown,
  imageBase,
  articleRef,
  setArticleRef,
  contentKey,
  toc,
  shortId,
  onShare,
  onAskSelection,
}: {
  markdown: string;
  imageBase: string;
  articleRef: RefObject<HTMLElement | null>;
  setArticleRef: (node: HTMLElement | null) => void;
  contentKey: string;
  toc: PaperReaderState["toc"];
  shortId: string;
  onShare: (payload: QuoteSharePayload) => void;
  onAskSelection: (text: string) => void;
}) {
  const { settings, update, reset } = useReaderSettings();
  // MarkdownArticle 内部按引用 memo，必须缓存这个函数，否则每次渲染都重跑整篇解析。
  const urlTransform = useMemo(
    () => createRelativeImageUrlTransform(imageBase),
    [imageBase],
  );
  // 窄屏（<lg）目录卡在左栏隐藏（见 ReaderAsidePanel），改用这个抽屉；状态放在这里
  // 而不是页面层：tab 切走时这整棵组件树连同这个 state 一起卸载，不会留下悬挂的
  // 「抽屉曾经开着」状态。
  const [tocDrawerOpen, setTocDrawerOpen] = useState(false);

  return (
    <div className="paper-card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
        <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
          {m.paper_view_reader()}
        </h2>
        <div className="flex items-center gap-2">
          {toc.items.length > 0 && (
            <button
              type="button"
              className={cn(TOOL_BTN, "lg:hidden")}
              onClick={() => setTocDrawerOpen(true)}
              aria-label={m.reader_toc()}
            >
              <List className="h-4 w-4" />
            </button>
          )}
          <ReaderSettingsMenu
            settings={settings}
            onChange={update}
            onReset={reset}
          />
        </div>
      </div>

      {/* TOC 已提到页面级左栏（见 ReaderAsidePanel），正文独占卡片全宽；
          <lg 时左栏目录卡隐藏，改走上面的按钮打开抽屉（见下方 ReaderTocDrawer）。 */}
      <div className="mt-4 min-w-0">
        <MarkdownArticle
          markdown={markdown}
          settings={settings}
          articleRef={setArticleRef}
          urlTransform={urlTransform}
        />
      </div>

      <ReaderTocDrawer
        open={tocDrawerOpen}
        onOpenChange={setTocDrawerOpen}
        items={toc.items}
        activeId={toc.activeId}
        onJump={toc.jumpTo}
      />

      <QuoteShareOverlay
        articleRef={articleRef}
        shortId={shortId}
        onShare={onShare}
        onAskSelection={onAskSelection}
        contentKey={contentKey}
      />
    </div>
  );
}
