import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { useMemo, useRef } from "react";
import {
  createRelativeImageUrlTransform,
  MarkdownArticle,
} from "#/components/markdown-reader/markdown-article";
import { ReaderSettingsMenu } from "#/components/markdown-reader/reader-settings";
import { TocList, useToc } from "#/components/markdown-reader/reader-toc";
import { useReaderSettings } from "#/components/markdown-reader/use-reader-settings";
import { PaperStateCard } from "#/components/papers/paper-state-card";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

/**
 * 论文详情页的「原文阅读」视图：渲染 MinerU 解析出的全文 Markdown。
 *
 * 与 /reader 共用组件与 localStorage 偏好，但不带 /reader 的整页壳（顶栏 / 新文档 /
 * 阅读进度条）——它嵌在详情页的内容列里。调用方负责确认已登录（getContent 是
 * protectedProcedure，未登录会直接 401）。
 */
export function PaperReaderView({ paperId }: { paperId: string }) {
  const trpc = useTRPC();
  const { data, isPending, isError } = useQuery({
    ...trpc.paper.getContent.queryOptions({ paperId }),
    // 原文内容不可变（解析产物写死在 R2），取过一次就不必再取
    staleTime: Number.POSITIVE_INFINITY,
  });

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

  return <ReaderArticle markdown={data.markdown} imageBase={data.imageBase} />;
}

function ReaderArticle({
  markdown,
  imageBase,
}: {
  markdown: string;
  imageBase: string;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const { settings, update, reset } = useReaderSettings();
  // MarkdownArticle 内部按引用 memo，必须缓存这个函数，否则每次渲染都重跑整篇解析。
  const urlTransform = useMemo(
    () => createRelativeImageUrlTransform(imageBase),
    [imageBase],
  );
  const { items, activeId, jumpTo } = useToc(articleRef, markdown);

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

      {/* 目录只在超宽视口出栏：详情页本身已占掉左侧信息栏（300–360px）和 xl 的聊天栏，
          再切一列目录会把正文压到不可读的宽度。窄屏走单栏，偏好仍照常生效。 */}
      <div
        className={
          items.length > 0
            ? "mt-4 min-[1440px]:grid min-[1440px]:grid-cols-[14rem_minmax(0,1fr)] min-[1440px]:items-start min-[1440px]:gap-8"
            : "mt-4"
        }
      >
        {items.length > 0 ? (
          <aside className="hidden min-[1440px]:sticky min-[1440px]:top-24 min-[1440px]:block">
            <span className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
              {m.reader_toc()}
            </span>
            <div className="mt-3 max-h-[calc(100vh-12rem)] overflow-y-auto pr-2">
              <TocList items={items} activeId={activeId} onJump={jumpTo} />
            </div>
          </aside>
        ) : null}

        <div className="min-w-0">
          <MarkdownArticle
            markdown={markdown}
            settings={settings}
            articleRef={articleRef}
            urlTransform={urlTransform}
          />
        </div>
      </div>
    </div>
  );
}
