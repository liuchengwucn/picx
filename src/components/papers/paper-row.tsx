import { Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import {
  type PaperRowStatus,
  PaperStatusDot,
  resolveRowSecondary,
} from "#/components/papers/paper-status-dot";
import { Skeleton } from "#/components/ui/skeleton";
import { m } from "#/paraglide/messages";

export interface PaperRowPaper {
  id: string;
  shortId: string;
  title: string;
  status: PaperRowStatus;
  pageCount: number | null;
  isPublic: boolean;
  errorMessage: string | null;
  createdAt: Date | string;
  tldr: string;
  tags: string[];
}

const MAX_ROW_TAGS = 2;

/**
 * 日期列固定 46px,所以只显示 MM-DD。年份由月份分组标题给出;搜索/筛选时分组
 * 关闭、年份丢失,用 title 属性兜底(hover 显示完整本地化日期)。
 */
function shortDate(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface PaperRowProps {
  paper: PaperRowPaper;
  onTagClick?: (tag: string) => void;
}

export function PaperRow({ paper, onTagClick }: PaperRowProps) {
  const secondary = resolveRowSecondary(
    paper.status,
    paper.tldr,
    paper.errorMessage,
  );
  const created =
    paper.createdAt instanceof Date
      ? paper.createdAt
      : new Date(paper.createdAt);
  const fullDate = created.toLocaleDateString();
  const visibleTags = paper.tags.slice(0, MAX_ROW_TAGS);
  const pages =
    paper.pageCount != null
      ? m.papers_page_count({ count: paper.pageCount.toString() })
      : "—";

  const tagButtons = visibleTags.map((tag) =>
    onTagClick ? (
      <button
        key={tag}
        type="button"
        // 整行是 Link,不拦住事件会先跳转再触发筛选
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTagClick(tag);
        }}
        className="shrink-0 rounded-full border border-[var(--line)] px-1.5 text-[10px] leading-4 text-[var(--ink-soft)] transition-colors hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]"
      >
        {tag}
      </button>
    ) : (
      <span
        key={tag}
        className="shrink-0 rounded-full border border-[var(--line)] px-1.5 text-[10px] leading-4 text-[var(--ink-soft)]"
      >
        {tag}
      </span>
    ),
  );

  return (
    <article className="border-b border-[var(--line)]">
      {/* 桌面：单行。标题最多吃 50%,tldr 抢剩下的,右侧三列固定宽右对齐。 */}
      <Link
        to="/p/$shortId"
        params={{ shortId: paper.shortId }}
        className="group hidden items-center gap-2.5 rounded-md px-2 py-1.5 no-underline transition-colors hover:bg-[var(--parchment-warm)] sm:flex"
      >
        <PaperStatusDot status={paper.status} />
        <span className="min-w-0 max-w-[50%] flex-initial truncate font-serif text-[13px] font-semibold text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown)]">
          {paper.title}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-[11.5px] text-[var(--ink-soft)] ${secondary?.className ?? ""}`}
        >
          {secondary?.text ?? ""}
        </span>
        {/* 固定 118px 且无 tag 时不塌缩 —— 列宽恒定才有整列对齐 */}
        <span className="flex w-[118px] shrink-0 items-center gap-1 overflow-hidden">
          {tagButtons}
        </span>
        <span className="w-10 shrink-0 text-right text-[10.5px] tabular-nums text-[var(--ink-soft)]">
          {pages}
        </span>
        <span
          title={fullDate}
          className="flex w-[46px] shrink-0 items-center justify-end gap-1 text-[10.5px] tabular-nums text-[var(--ink-soft)]"
        >
          {paper.isPublic && <Globe className="size-2.5 shrink-0" />}
          {shortDate(created)}
        </span>
      </Link>

      {/* 移动：两行,砍掉 tldr。320px 宽的 tldr 只能露十几个字,看不出所以然,
          却把行高翻倍、把密度打回原形。 */}
      <Link
        to="/p/$shortId"
        params={{ shortId: paper.shortId }}
        className="flex flex-col gap-1 py-2 no-underline sm:hidden"
      >
        <span className="flex items-start gap-1.5">
          <span className="mt-1.5">
            <PaperStatusDot status={paper.status} />
          </span>
          <span className="line-clamp-2 font-serif text-[13px] font-semibold leading-snug text-[var(--ink)]">
            {paper.title}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-[var(--ink-soft)]">
          {tagButtons.slice(0, 1)}
          <span className="tabular-nums">{pages}</span>
          <span title={fullDate} className="ml-auto flex items-center gap-1">
            {paper.isPublic && <Globe className="size-2.5 shrink-0" />}
            <span className="tabular-nums">{shortDate(created)}</span>
          </span>
        </span>
      </Link>
    </article>
  );
}

export function PaperRowSkeleton() {
  return (
    <div className="border-b border-[var(--line)]">
      <div className="hidden items-center gap-2.5 px-2 py-1.5 sm:flex">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 flex-1" />
        <Skeleton className="h-3 w-[118px] shrink-0" />
        <Skeleton className="h-3 w-10 shrink-0" />
        <Skeleton className="h-3 w-[46px] shrink-0" />
      </div>
      <div className="flex flex-col gap-1.5 py-2 sm:hidden">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}
