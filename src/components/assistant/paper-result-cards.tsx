import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Loader2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { localizeUploadError } from "#/components/papers/upload-error-message";
import { Button } from "#/components/ui/button";
import { useTRPC } from "#/integrations/trpc/react";
// 仅类型导入：agent.ts 是服务端模块（drizzle/R2 一大串）。`import type` 在编译期
// 就被整条擦除，运行时不产生 import，服务端代码不会进客户端包
// （同 paper-chat.tsx 引 chat.ts 的做法）。
import type { DiscoveredPaper } from "#/lib/agent";
import { authClient } from "#/lib/auth-client";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";
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
  /** 这一组里有卡正在导入（可能是别人）：点了不会生效，靠 title 说明原因 */
  isGroupBusy: boolean;
  /** 演示 guest 是共享只读账号，入库这条路走不通，按钮直接置灰 */
  isReadOnlyGuest: boolean;
  /** 已入库时可用的站内 shortId（工具快照里的，或本次刚导入拿回来的） */
  shortId?: string;
  dateFormatter: Intl.DateTimeFormat;
  locale: string;
  onAdd: () => void;
}

/**
 * 一篇论文一张卡。眉标用 arXiv 编号而不是装饰性序号——它就是研究者互相
 * 引用这篇论文时说出口的那个号码，是这张卡上最有信息量的标识。
 *
 * 字段一律按「可能缺」来读：历史消息里回放的是当初落库的工具 output，
 * 早期格式缺字段时只该少显示一行，不能把整个聊天区渲染崩掉。
 */
function PaperResultCard({
  paper,
  isAdded,
  isPending,
  isGroupBusy,
  isReadOnlyGuest,
  shortId,
  dateFormatter,
  locale,
  onAdd,
}: PaperResultCardProps) {
  const authors = formatAuthors(paper.authors ?? []);
  const category = paper.categories?.[0];
  const published =
    typeof paper.published === "string"
      ? formatPublished(paper.published, dateFormatter)
      : "";
  const upvotes = typeof paper.upvotes === "number" ? paper.upvotes : 0;
  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--parchment-warm)]/50 px-3 py-2.5 transition-colors hover:border-[var(--academic-brown)]/35">
      {(paper.arxivId || category) && (
        <p className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-[var(--ink-soft)] uppercase">
          {paper.arxivId && (
            <span className="tabular-nums">{paper.arxivId}</span>
          )}
          {paper.arxivId && category && <span aria-hidden="true">·</span>}
          {category && <span className="truncate">{category}</span>}
        </p>
      )}
      <h4 className="mt-1">
        <a
          href={paper.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-serif text-[15px] leading-snug font-semibold text-[var(--ink)] hover:text-[var(--academic-brown)]"
        >
          {paper.title || paper.url}
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
        {published && (
          <p className="text-[11px] tabular-nums text-[var(--ink-soft)]">
            {published}
          </p>
        )}
        {upvotes > 0 && (
          <p className="text-[11px] tabular-nums text-[var(--academic-brown)]">
            {m.assistant_card_upvotes({
              count: upvotes.toLocaleString(locale),
            })}
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isAdded && shortId && (
            <Link
              to="/p/$shortId"
              params={{ shortId }}
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
              disabled={isPending || isReadOnlyGuest}
              aria-busy={isPending || undefined}
              // 一次只导一篇：别的卡在导入时这里点了不会有反应，说明一句
              title={isGroupBusy ? m.assistant_card_adding() : undefined}
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
  /**
   * 本轮会话里刚加进去的：url → 站内 shortId（拿不到就 null）。工具输出是落库
   * 那一刻的快照，不会自己更新 inLibrary / libraryShortId。
   */
  const [addedPapers, setAddedPapers] = useState<
    ReadonlyMap<string, string | null>
  >(() => new Map());

  const { data: session } = authClient.useSession();
  const isReadOnlyGuest = isReviewGuestReadOnlySession(
    session ??
      (isReviewGuestModeEnabled() ? getReviewGuestClientSession() : null),
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

  const createPaper = useMutation(
    // 这两个回调挂在 mutation 上而不是 mutate() 的第二参：换会话会按 key 卸载
    // 整棵聊天子树，per-call 回调在组件卸载后一律不执行（连失败 toast 都不弹）
    trpc.paper.create.mutationOptions({
      onSuccess: () => {
        // 论文列表页此刻多了一篇（还在处理中），让它下次进入时能看到
        void queryClient.invalidateQueries({
          queryKey: trpc.paper.list.queryKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.paper.statusCounts.queryKey(),
        });
      },
      onError: (error) => {
        console.error("Add to library failed:", error);
        // paper.create 的 TRPCError message 是稳定错误码（积分不足、API 配置
        // 不存在…）。认得出就说具体原因，认不出（网络层错误、未登记的码）才落
        // 回这条泛化文案——绝不把原始 message 甩给用户。
        toast.error(localizeUploadError(error, m.assistant_card_add_failed));
      },
    }),
  );

  const handleAdd = (paper: DiscoveredPaper) => {
    // 一次只导一篇：pending 期间别的卡按钮仍可点，但这里直接挡掉
    if (pendingUrl) return;
    setPendingUrl(paper.url);
    createPaper.mutate(
      {
        sourceType: "arxiv",
        arxivUrl: paper.url,
        filename: paper.arxivId || paper.url,
        // arXiv 走服务端下载，这里的大小只是占位，落库后会被真实值覆盖
        fileSize: 1,
        r2Key: `arxiv/${Date.now()}`,
        language: currentSummaryLanguage(),
      },
      // per-call 回调只放纯 UI state：组件已卸载时不执行也无所谓
      {
        onSuccess: (result) => {
          setAddedPapers((previous) =>
            new Map(previous).set(paper.url, result.shortId ?? null),
          );
        },
        onSettled: () => setPendingUrl(null),
      },
    );
  };

  // url 缺失的条目没法链接也没法入库，直接丢掉（旧格式历史消息的兜底）
  const cards = results.filter(
    (paper) => typeof paper?.url === "string" && paper.url.length > 0,
  );

  return (
    <div className="my-2 grid gap-2">
      {cards.map((paper) => (
        <PaperResultCard
          key={paper.url}
          paper={paper}
          isAdded={paper.inLibrary === true || addedPapers.has(paper.url)}
          isPending={pendingUrl === paper.url}
          isGroupBusy={pendingUrl !== null}
          isReadOnlyGuest={isReadOnlyGuest}
          shortId={
            paper.libraryShortId ?? addedPapers.get(paper.url) ?? undefined
          }
          dateFormatter={dateFormatter}
          locale={locale}
          onAdd={() => handleAdd(paper)}
        />
      ))}
    </div>
  );
}
