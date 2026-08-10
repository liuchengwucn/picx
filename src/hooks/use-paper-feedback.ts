import { useQueries } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import type { FeedbackAuthState } from "#/components/papers/feedback-buttons";
import { useTRPC } from "#/integrations/trpc/react";
import { authClient } from "#/lib/auth-client";
import { FEEDBACK_BATCH_SIZE } from "#/lib/paper-feedback";
import {
  getReviewGuestClientSession,
  isReviewGuestModeEnabled,
  isReviewGuestReadOnlySession,
} from "#/lib/review-guest";

export interface PaperFeedbackState {
  /** 传给 GalleryCard / FeedbackButtons 的 auth */
  feedbackAuth: FeedbackAuthState;
  /** 未登录点反馈时登录后要回到的地址 */
  signInCallbackURL: string;
  /** paperId → 我投过的票; 没投过的不在表里 */
  myVoteByPaperId: Map<string, 1 | -1>;
}

/**
 * 论文列表页的反馈按钮装配: 登录态口径 + 登录回跳地址 + 「我的投票」批量取。
 * /gallery、方向主页、简报期页共用 —— 这三件事各自都有能踩错的地方(见下面注释),
 * 收在一个 hook 里, 不再每页抄一遍。
 *
 * paperIds 传当前页面已加载的全部论文 id(顺序即加载顺序), 引用不需要稳定。
 */
export function usePaperFeedback(paperIds: string[]): PaperFeedbackState {
  const trpc = useTRPC();

  // 登录态与详情页同一口径: pending 不渲染按钮(否则已登录用户先看到一下登录墙),
  // review-guest 只读账号禁用。
  const { data: session, isPending: isSessionPending } =
    authClient.useSession();
  const effectiveSession =
    session ??
    (isReviewGuestModeEnabled() ? getReviewGuestClientSession() : null);
  const feedbackAuth: FeedbackAuthState = isSessionPending
    ? "pending"
    : !effectiveSession
      ? "signed-out"
      : isReviewGuestReadOnlySession(effectiveSession)
        ? "readonly-guest"
        : "signed-in";

  // 登录后回到当前地址(含筛选与已展开到第几页), 而不是甩回首页
  const signInCallbackURL = useRouterState({
    select: (state) => state.location.href,
  });

  // 「我的投票」按页面批量取, 不是每卡一次。后端单次最多 FEEDBACK_BATCH_SIZE 个 id,
  // 而列表是无限滚动(/gallery 每页 8 篇, 第 12 页就会超), 所以按批切块、一块一个查询。
  // 注意别高估这个切块的收益: 不满一批时 chunk 0 就是末块, 每翻一页 key 都变, 行为跟
  // 单查询完全一样; 只有超过一批之后, 前面的块才固定下来不再重取(论文只往末尾追加),
  // 翻页只动最后一块。相比截断的好处是深翻之后投票状态还准。
  const feedbackBatches: string[][] = [];
  for (let i = 0; i < paperIds.length; i += FEEDBACK_BATCH_SIZE) {
    feedbackBatches.push(paperIds.slice(i, i + FEEDBACK_BATCH_SIZE));
  }
  const feedbackQueries = useQueries({
    queries: feedbackBatches.map((batch) => ({
      ...trpc.paper.getMyFeedback.queryOptions({ paperIds: batch }),
      // protected procedure: 未登录发出去注定 401
      enabled: feedbackAuth === "signed-in",
    })),
  });

  // 只取 vote: 同一行的 reasonPreset 有意丢弃(见详情页注释, 回填理由会喂出
  // 「赞 + 理由是炒作」这种自相矛盾的样本)。vote 在 schema 里是 integer, 收窄回 1 | -1。
  const myVoteByPaperId = new Map<string, 1 | -1>();
  for (const query of feedbackQueries) {
    for (const [paperId, entry] of Object.entries(query.data ?? {})) {
      if (entry.vote === 1 || entry.vote === -1) {
        myVoteByPaperId.set(paperId, entry.vote);
      }
    }
  }

  return { feedbackAuth, signInCallbackURL, myVoteByPaperId };
}
