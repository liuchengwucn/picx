// focusBrief 更新提案的审阅面。整页唯一需要真正「读」的地方，所以做成校样对开：
// 上格是方向当下的 focusBrief，下格是这一期定稿时强模型写出的**全文替换**。
// 刻意不做逐词 diff——提案是整段重写，逐词高亮只会把两段都染成一片红绿。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowDown, Check, Loader2, X } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  AdminEmpty,
  AdminSection,
  adminErrorMessage,
  Pill,
} from "#/components/admin/admin-ui";
import { Button } from "#/components/ui/button";
import { Skeleton } from "#/components/ui/skeleton";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { normalizeLocaleKey, pickTldr } from "#/lib/tldr";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

type PendingProposal =
  inferRouterOutputs<TRPCRouter>["admin"]["listProposals"][number];

export function ProposalPanel() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const proposalsQuery = useQuery(trpc.admin.listProposals.queryOptions());

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.admin.listProposals.queryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.admin.listDirections.queryKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.admin.listRecentDigests.queryKey(),
    });
  };

  const adopt = useMutation(
    trpc.admin.adoptFocusUpdate.mutationOptions({
      onSuccess: (result) => {
        invalidate();
        // 采纳成功，但两件事都可能同时出岔子，各说各的，不合并成一句
        if (result.supersededCount > 0) {
          toast.info(
            m.admin_adopt_superseded({ count: String(result.supersededCount) }),
          );
        }
        if (result.introUpdated) {
          toast.success(m.admin_saved());
        } else {
          // 采纳本身没有回滚，只是四语简介没跟着刷新——指回生成按钮而不是报失败
          toast.warning(m.admin_adopt_intro_failed());
        }
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  const dismiss = useMutation(
    trpc.admin.dismissFocusUpdate.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success(m.admin_saved());
      },
      onError: (error) => toast.error(adminErrorMessage(error)),
    }),
  );

  return (
    <AdminSection
      anchorId="proposals"
      title={m.admin_section_proposals()}
      count={proposalsQuery.data?.length}
    >
      {proposalsQuery.isPending ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : proposalsQuery.isError ? (
        <p className="py-6 text-sm font-medium text-[var(--sienna)]">
          {m.admin_error_generic()}
        </p>
      ) : proposalsQuery.data.length === 0 ? (
        <AdminEmpty>{m.admin_no_proposals()}</AdminEmpty>
      ) : (
        <ul className="space-y-5">
          {proposalsQuery.data.map((proposal) => (
            <ProposalCard
              key={proposal.digestId}
              proposal={proposal}
              adoptPending={
                adopt.isPending &&
                adopt.variables?.digestId === proposal.digestId
              }
              disabled={adopt.isPending || dismiss.isPending}
              onAdopt={() => adopt.mutate({ digestId: proposal.digestId })}
              onDismiss={() => dismiss.mutate({ digestId: proposal.digestId })}
            />
          ))}
        </ul>
      )}
    </AdminSection>
  );
}

function ProposalCard({
  proposal,
  adoptPending,
  disabled,
  onAdopt,
  onDismiss,
}: {
  proposal: PendingProposal;
  adoptPending: boolean;
  disabled: boolean;
  onAdopt: () => void;
  onDismiss: () => void;
}) {
  const locale = getLocale();
  const localeKey = normalizeLocaleKey(locale);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  const directionName =
    pickTldr(proposal.directionName, localeKey) ?? proposal.directionSlug;
  const issueLabel = m.admin_proposal_proposed({
    issue: String(proposal.issueNumber),
  });

  return (
    <li
      className="rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] p-5"
      data-testid="admin-proposal-card"
      data-digest-id={proposal.digestId}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-base font-bold text-[var(--ink)]">
          {directionName}
        </h3>
        <span className="font-mono text-xs text-[var(--ink-soft)]">
          {proposal.directionSlug}
        </span>
        <time
          dateTime={proposal.createdAt.toISOString()}
          className="ml-auto text-xs text-[var(--ink-soft)]"
        >
          {dateFormat.format(proposal.createdAt)}
        </time>
      </div>

      {/* 未发布的期没有公开页，链过去就是 404 —— 只在 published 时才是链接 */}
      <div className="mt-1">
        {proposal.status === "published" ? (
          <Link
            to="/gallery/d/$slug/$issue"
            params={{
              slug: proposal.directionSlug,
              issue: String(proposal.issueNumber),
            }}
            className="text-sm text-[var(--academic-brown-deep)] underline underline-offset-2"
            data-testid="admin-proposal-issue-link"
          >
            {issueLabel}
          </Link>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink-soft)]">
            {issueLabel}
            <Pill tone="warn">{m.admin_proposal_unpublished()}</Pill>
          </span>
        )}
      </div>

      <div className="mt-4">
        <BriefBlock
          label={m.admin_proposal_current()}
          text={proposal.currentFocusBrief}
        />
        <div className="flex justify-center py-1.5">
          <ArrowDown
            aria-hidden="true"
            className="size-4 text-[var(--academic-brown)]"
          />
        </div>
        <BriefBlock
          label={issueLabel}
          text={proposal.proposal}
          emphasis
          testId="admin-proposal-text"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          data-testid="admin-adopt-proposal"
          onClick={onAdopt}
        >
          {adoptPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          {m.admin_adopt()}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          data-testid="admin-dismiss-proposal"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
          {m.admin_dismiss()}
        </Button>
      </div>
    </li>
  );
}

/**
 * 对开里的一格。两格用同一种 mono 排版，只靠底色和左侧那道线区分现状与提案：
 * 换字体会让人以为两段是不同性质的东西，而它们是同一个字段的两个版本。
 */
function BriefBlock({
  label,
  text,
  emphasis,
  testId,
}: {
  label: string;
  text: string;
  emphasis?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={`border-l-2 py-3 pr-3 pl-4 ${
        emphasis
          ? "border-[var(--academic-brown)] bg-[var(--parchment-warm)]"
          : "border-[var(--line)] bg-transparent"
      }`}
    >
      <p className="mb-1.5 text-xs font-semibold text-[var(--ink-soft)]">
        {label}
      </p>
      <p
        data-testid={testId}
        className="max-h-72 overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--ink)]"
      >
        {text}
      </p>
    </div>
  );
}
