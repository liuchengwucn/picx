import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
// 仅类型导入：agent.ts 是服务端模块（drizzle/R2 一大串）。`import type` 在编译期
// 就被整条擦除，运行时不产生 import，服务端代码不会进客户端包
// （同 paper-chat.tsx 引 chat.ts 的做法）。
import type { DiscoveredPaper } from "#/lib/agent";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export type { DiscoveredPaper };

/** paper.create 收的摘要语言，与 upload-dialog 的 summaryLanguage 同一套取值 */
const SUMMARY_LANGUAGES = ["en", "zh-CN", "zh-TW", "ja"] as const;
type SummaryLanguage = (typeof SUMMARY_LANGUAGES)[number];

/** 站内语言恰好与 paper.create 的枚举同名，但用 find 收窄而不是 as 强转 */
function currentSummaryLanguage(): SummaryLanguage {
  const locale: string = getLocale();
  return SUMMARY_LANGUAGES.find((value) => value === locale) ?? "en";
}

/** 作者行：超过 3 人只留前 3 个，剩下的交给 et al. */
function formatAuthors(authors: string[]): string {
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al.`;
}

/**
 * published 是 arXiv 给的 YYYY-MM-DD。按 UTC 解析并按 UTC 格式化——用本地时区
 * 渲染会让 UTC-x 的读者看到前一天。解析不出来就原样显示。
 */
function formatPublished(published: string, formatter: Intl.DateTimeFormat) {
  const match = published.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return published;
  const ts = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return formatter.format(ts);
}

interface PaperResultCardProps {
  paper: DiscoveredPaper;
  isAdded: boolean;
  isPending: boolean;
  /** 已有别的卡在导入：一次只放行一张，其余按钮暂时不可点 */
  isBlocked: boolean;
  dateFormatter: Intl.DateTimeFormat;
  onAdd: () => void;
}

/**
 * 一篇论文一张卡。眉标用 arXiv 编号而不是装饰性序号——它就是研究者互相
 * 引用这篇论文时说出口的那个号码，是这张卡上最有信息量的标识。
 */
function PaperResultCard({
  paper,
  isAdded,
  isPending,
  isBlocked,
  dateFormatter,
  onAdd,
}: PaperResultCardProps) {
  const authors = formatAuthors(paper.authors);
  const category = paper.categories?.[0];
  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--parchment-warm)]/50 px-3 py-2.5 transition-colors hover:border-[var(--academic-brown)]/35">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-[var(--ink-soft)] uppercase">
        <span className="tabular-nums">{paper.arxivId}</span>
        {category && (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{category}</span>
          </>
        )}
      </p>
      <h4 className="mt-1">
        <a
          href={paper.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-serif text-[15px] leading-snug font-semibold text-[var(--ink)] hover:text-[var(--academic-brown)]"
        >
          {paper.title}
        </a>
      </h4>
      {authors && (
        <p className="mt-1 truncate text-xs text-[var(--ink-soft)]">
          {authors}
        </p>
      )}
      {paper.abstract && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--ink-soft)]">
          {paper.abstract}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="text-[11px] tabular-nums text-[var(--ink-soft)]">
          {formatPublished(paper.published, dateFormatter)}
        </p>
        {typeof paper.upvotes === "number" && paper.upvotes > 0 && (
          <p className="text-[11px] tabular-nums text-[var(--academic-brown)]">
            {m.assistant_card_upvotes({ count: paper.upvotes })}
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isAdded && paper.libraryShortId && (
            <Link
              to="/p/$shortId"
              params={{ shortId: paper.libraryShortId }}
              className="text-xs text-[var(--academic-brown)] hover:underline"
            >
              {m.assistant_card_view()}
            </Link>
          )}
          {isAdded ? (
            <Button variant="ghost" size="xs" disabled>
              <Check className="h-3 w-3" />
              {m.assistant_card_added()}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="xs"
              onClick={onAdd}
              disabled={isBlocked}
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              {isPending ? m.assistant_card_adding() : m.assistant_card_add()}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * searchArxiv / listDailyPapers 的结果卡片列表：在回答正文里就地入库，
 * 用户不必再复制链接跑一趟上传对话框。
 */
export function PaperResultCards({ results }: { results: DiscoveredPaper[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  /** 正在导入的那张卡（按 url 区分）；同时也是「一次只导一篇」的闸门 */
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  /** 本轮会话里刚加进去的。工具输出是落库时的快照，不会自己更新 inLibrary */
  const [addedUrls, setAddedUrls] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const locale = getLocale();
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    [locale],
  );

  const createPaper = useMutation(trpc.paper.create.mutationOptions());

  const handleAdd = (paper: DiscoveredPaper) => {
    if (pendingUrl) return;
    setPendingUrl(paper.url);
    createPaper.mutate(
      {
        sourceType: "arxiv",
        arxivUrl: paper.url,
        filename: paper.arxivId,
        // arXiv 走服务端下载，这里的大小只是占位，落库后会被真实值覆盖
        fileSize: 1,
        r2Key: `arxiv/${Date.now()}`,
        language: currentSummaryLanguage(),
      },
      {
        onSuccess: () => {
          setAddedUrls((previous) => new Set(previous).add(paper.url));
          // 论文列表页此刻多了一篇（还在处理中），让它下次进入时能看到
          void queryClient.invalidateQueries({
            queryKey: trpc.paper.list.queryKey(),
          });
        },
        onError: (error) => {
          console.error("Add to library failed:", error);
          toast.error(m.assistant_card_add_failed());
        },
        onSettled: () => setPendingUrl(null),
      },
    );
  };

  return (
    <div className="my-2 grid gap-2">
      {results.map((paper) => (
        <PaperResultCard
          key={paper.url}
          paper={paper}
          isAdded={paper.inLibrary || addedUrls.has(paper.url)}
          isPending={pendingUrl === paper.url}
          isBlocked={pendingUrl !== null}
          dateFormatter={dateFormatter}
          onAdd={() => handleAdd(paper)}
        />
      ))}
    </div>
  );
}
