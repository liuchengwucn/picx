import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  createRelativeImageUrlTransform,
  MarkdownArticle,
} from "#/components/markdown-reader/markdown-article";
import { ReaderSettingsMenu } from "#/components/markdown-reader/reader-settings";
import { useToc } from "#/components/markdown-reader/reader-toc";
import { useReaderSettings } from "#/components/markdown-reader/use-reader-settings";
import { PaperStateCard } from "#/components/papers/paper-state-card";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

/**
 * 页面级 hook：把「原文阅读」的 getContent 查询与 TOC 提升到详情页，好让目录能渲染在
 * 页面左栏而不是挤在中栏卡片内部。
 *
 * `enabled` 由调用方传入，必须与 ReaderPane 决定渲染 <PaperReaderView> 的条件完全一致
 * （原文视图激活 + isReaderAvailable + 已登录）——否则未登录/pending 时会打一个注定
 * 401 的请求。tanstack-query 按 queryKey 去重，多处引用同一 paperId 不会重复发请求。
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
  const articleRef = useRef<HTMLElement | null>(null);
  const [mountTick, setMountTick] = useState(0);
  const setArticleRef = useCallback((node: HTMLElement | null) => {
    articleRef.current = node;
    if (node) {
      setMountTick((tick) => tick + 1);
    }
  }, []);

  const markdown = query.data?.available ? query.data.markdown : "";
  const toc = useToc(articleRef, `${markdown}::${mountTick}`);

  return { query, setArticleRef, toc };
}

export type PaperReaderState = ReturnType<typeof usePaperReader>;

/**
 * 论文详情页的「原文阅读」视图：渲染 MinerU 解析出的全文 Markdown。
 *
 * 受控组件：查询状态与 articleRef 由 usePaperReader（页面层）提供，这里只负责三态
 * UI（加载 / 出错 / 内容不可用）与正文渲染。登录墙仍在调用方（ReaderPane）处理。
 */
export function PaperReaderView({ reader }: { reader: PaperReaderState }) {
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
      setArticleRef={reader.setArticleRef}
    />
  );
}

function ReaderArticle({
  markdown,
  imageBase,
  setArticleRef,
}: {
  markdown: string;
  imageBase: string;
  setArticleRef: (node: HTMLElement | null) => void;
}) {
  const { settings, update, reset } = useReaderSettings();
  // MarkdownArticle 内部按引用 memo，必须缓存这个函数，否则每次渲染都重跑整篇解析。
  const urlTransform = useMemo(
    () => createRelativeImageUrlTransform(imageBase),
    [imageBase],
  );

  return (
    <div className="paper-card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
        <h2 className="font-serif text-lg font-semibold text-[var(--ink)]">
          {m.paper_view_reader()}
        </h2>
        <ReaderSettingsMenu
          settings={settings}
          onChange={update}
          onReset={reset}
        />
      </div>

      {/* TOC 已提到页面级左栏（见 usePaperReader），正文独占卡片全宽。 */}
      <div className="mt-4 min-w-0">
        <MarkdownArticle
          markdown={markdown}
          settings={settings}
          articleRef={setArticleRef}
          urlTransform={urlTransform}
        />
      </div>
    </div>
  );
}
