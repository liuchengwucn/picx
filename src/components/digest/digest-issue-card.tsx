import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

interface DigestIssueCardProps {
  slug: string;
  issueNumber: number;
  title: string;
  publishedAt: Date | null;
  /** 正文首段纯文本摘要(后端已截断); 空串则不渲染 */
  excerpt: string;
}

/**
 * 方向主页的「最新一期」强调卡。整卡是通往简报正文的链接。
 *
 * 眉线一行把三件事排成刊物式的一条: 栏目名 → 期号 → 细线 → 发布日期。简报是编号
 * 周刊, 期号与日期是读者真正要扫的信息, 所以给它一条独立的横线而不是塞进标题旁边。
 */
export function DigestIssueCard({
  slug,
  issueNumber,
  title,
  publishedAt,
  excerpt,
}: DigestIssueCardProps) {
  return (
    <Link
      to="/gallery/d/$slug/$issue"
      params={{ slug, issue: String(issueNumber) }}
      className="group block no-underline"
    >
      <article className="rounded-2xl border border-[var(--academic-brown)]/40 bg-[var(--parchment-warm)]/60 p-5 shadow-[0_4px_16px_rgba(45,42,36,0.06)] transition-all hover:-translate-y-0.5 hover:border-[var(--academic-brown)] hover:shadow-[0_12px_32px_rgba(139,111,71,0.16)] sm:p-6">
        <IssueEyebrow issueNumber={issueNumber} publishedAt={publishedAt} />

        <h2 className="mt-3 font-serif text-xl font-bold leading-snug text-[var(--ink)] transition-colors group-hover:text-[var(--academic-brown-deep)] sm:text-2xl">
          {title}
        </h2>

        {excerpt ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--ink-soft)]">
            {excerpt}
          </p>
        ) : null}

        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--academic-brown)]">
          {m.digest_read_full()}
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </article>
    </Link>
  );
}

/** 方向已在跟踪但一期都还没发布时的占位卡(虚线边 = 内容在路上, 不是坏掉了)。 */
export function DigestEmptyIssueCard() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--academic-brown)]/35 bg-[var(--parchment-warm)]/40 p-5 sm:p-6">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--academic-brown)]">
        {m.digest_latest_issue()}
      </span>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">
        {m.digest_empty_issue()}
      </p>
    </div>
  );
}

function IssueEyebrow({
  issueNumber,
  publishedAt,
}: {
  issueNumber: number;
  publishedAt: Date | null;
}) {
  const locale = getLocale();
  // 与 IssueList 同一写法(同一批代码别两种风格), 也免得每次渲染重建 formatter
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--academic-brown)]">
        {m.digest_latest_issue()}
      </span>
      <span className="shrink-0 rounded-full border border-[var(--gold)]/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--academic-brown-deep)]">
        {m.digest_issue_n({ n: String(issueNumber) })}
      </span>
      <span
        aria-hidden
        className="h-px min-w-2 flex-1 bg-[var(--academic-brown)]/20"
      />
      {publishedAt ? (
        <time
          dateTime={publishedAt.toISOString()}
          className="shrink-0 text-xs text-[var(--ink-soft)]"
        >
          {dateFormat.format(publishedAt)}
        </time>
      ) : null}
    </div>
  );
}
