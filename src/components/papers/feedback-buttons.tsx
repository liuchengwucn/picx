import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterInputs } from "@trpc/server";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { type MouseEvent, useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "#/components/ui/popover";
import { useHydrated } from "#/hooks/use-hydrated";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { startGitHubSignIn } from "#/lib/auth-client";
import { GALLERY_LIST_QUERY_KEY } from "#/lib/gallery-search";
import { FEEDBACK_REASON_TEXT_MAX_LENGTH } from "#/lib/paper-feedback";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

type ReasonPreset = NonNullable<
  inferRouterInputs<TRPCRouter>["paper"]["setFeedback"]["reasonPreset"]
>;
/**
 * 有 chip 的理由。"other" 故意不在这里: 它和「只填了自由文本」表达的是同一件事
 * (理由在 reasonText 里), 多一个合成分类只会稀释口味统计, 所以自由文本不带 preset 提交。
 */
type ChipReasonPreset = Exclude<ReasonPreset, "other">;

/** 键序即 chip 展示序。枚举加成员时这个 Record 会编译报错, 逼着这里同步。 */
const REASON_CHIP_LABELS: Record<ChipReasonPreset, () => string> = {
  "off-topic": () => m.feedback_reason_off_topic(),
  incremental: () => m.feedback_reason_incremental(),
  hype: () => m.feedback_reason_hype(),
  seen: () => m.feedback_reason_seen(),
};
const REASON_CHIPS = Object.keys(REASON_CHIP_LABELS) as ChipReasonPreset[];

/**
 * 登录态四态。pending 与 signed-out 必须分开: 已登录用户在 session 解析完成前
 * 会被当成未登录, 按钮闪一下登录墙。pending 渲染的是不可投票的占位骨架, 且首帧
 * 一律按 pending 渲染 —— 原因见组件里那段 hydration 注释。
 */
export type FeedbackAuthState =
  | "pending"
  | "signed-out"
  | "signed-in"
  | "readonly-guest";

interface FeedbackButtonsProps {
  paperId: string;
  /** 公开赞数(踩数不公开, 只进口味校准) */
  likeCount: number;
  /** 由页面级 getMyFeedback 传入; 未登录/未投票为 undefined */
  myVote?: 1 | -1;
  auth: FeedbackAuthState;
  /** 未登录点击时登录后要回到的地址 */
  signInCallbackURL: string;
  /** card = 卡片上的紧凑图标形态; detail = 详情页带文案形态 */
  variant: "card" | "detail";
  /**
   * 赞按钮里是否带上赞数, 默认 true。调用点自己已经常驻显示赞数时(gallery 卡片
   * 底行)传 false, 否则同一个数字在一张卡上出现两遍。
   */
  showCount?: boolean;
  className?: string;
}

/**
 * 一篇论文的赞/踩控件。赞直接提交; 踩弹 Popover 收可选理由(预设 chip + 自由文本),
 * 理由是每周简报口味校准的 few-shot 素材。
 *
 * 语义: 点反向按钮 = 改票; 再点同向按钮 = 撤票。改票不带理由时后端会清掉旧理由,
 * 这是期望行为——否则会喂给 LLM「赞 + 理由是炒作」这种自相矛盾的样本。
 *
 * 三处复用(详情页 / 画廊卡片 / 简报期论文卡)。卡片场景整卡是 <Link>, 所以每个
 * handler 都要 preventDefault + stopPropagation, 否则点反馈会跳走。
 */
export function FeedbackButtons({
  paperId,
  likeCount,
  myVote,
  auth,
  signInCallbackURL,
  variant,
  showCount = true,
  className,
}: FeedbackButtonsProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [reasonPreset, setReasonPreset] = useState<ChipReasonPreset | null>(
    null,
  );
  const [reasonText, setReasonText] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const titleId = useId();

  // 没有乐观更新, 投完票靠失效重取。只点名真正带「我的投票」或赞数的查询:
  // 整个 trpc.paper 命名空间一起失效会把 paper.getContent 也带上, 而详情页在原文
  // 视图下正挂着它——那是 MinerU 解析出的全文 markdown, 可达数百 KB, 点一次赞
  // 就重下一遍。这里是三处调用点(详情页 / gallery 列表 / 简报期)的并集, 新增带
  // 赞数的查询时要往这里加一行(漏加只是数字延迟到下次挂载, 不会有别的副作用)。
  const invalidate = () => {
    for (const queryKey of [
      trpc.paper.getMyFeedback.pathKey(),
      trpc.paper.getByShortId.pathKey(),
      trpc.paper.listPublic.pathKey(),
      trpc.digest.getIssue.pathKey(),
      // /gallery 的无限滚动是手写 queryKey 的, 上面那个 listPublic pathKey 盖不到它
      [GALLERY_LIST_QUERY_KEY],
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };
  const setFeedback = useMutation(
    trpc.paper.setFeedback.mutationOptions({ onSuccess: invalidate }),
  );
  const clearFeedback = useMutation(
    trpc.paper.clearFeedback.mutationOptions({ onSuccess: invalidate }),
  );

  const closePopover = () => {
    setPopoverOpen(false);
    // 不重置会残留上次选的理由, 下次点踩看起来像已经选过
    setReasonPreset(null);
    setReasonText("");
  };

  /**
   * 登录态与「我的投票」都是只有客户端才知道的量, 服务端那帧必然是 pending/未投票。
   * 这里做两件必须同时做的事, 少任何一件都会坏:
   *
   * 1. 不 return null —— pending 渲染与其它三态**结构同构**的骨架。结构不一致时
   *    React 会报 #418 并丢弃整棵 SSR 子树客户端重渲(实测这条竞态在简报期页
   *    baseline 命中 11/12): SSR 那帧渲染 null, 而客户端首帧未必也是 pending ——
   *    session fetch 是模块初始化时排的一个 setTimeout(0) + 一次本地往返, React 19
   *    的 hydration 可中断、会让出主线程, 所以它有可能在 hydration 走到本组件之前
   *    就落地。(是竞态而非必然: 网络慢时客户端首帧也可能仍是 pending。) 同构之后
   *    无论竞态往哪边倒都不 mismatch, 顺带让控件与赞数进 SSR HTML、消掉布局跳动。
   *
   * 2. 本组件 hydration 那一次渲染强行按 pending 渲染, 之后才翻牌 —— 因为
   *    **React 的 hydration 不修补属性**: 结构/文本不一致会报错并丢弃子树重渲, 而
   *    属性不一致不会被写回 DOM。只做第 1 件事的话, 不一致会从「结构」降级成
   *    「属性」, 而属性这一档在**压缩构建下是静默的**(dev 构建会把属性级 mismatch
   *    打进控制台, 所以本地开发看得见; 线上看不见 —— 别据此以为它无害): session 落在
   *    本子树 hydrate 之前时, 本组件**第一次**渲染拿到的就已经是解析后的登录态, 它去
   *    hydrate 一批写着 aria-disabled="true" 的服务端节点, 那个属性就永久钉死, 按钮
   *    再也点不动(实测 5/5 复现)。所以 hydration 那次渲染必须逐属性等于服务端那帧,
   *    由 useHydrated 之后补的那次 update 翻牌。
   *
   * 别把 hydrated 这道门当多余代码删掉: 删了 mismatch 不会回来(结构仍同构), 坏掉的
   * 是按钮永久 inert —— 一个不报错、只有开浏览器点一下才看得见的故障。
   */
  const hydrated = useHydrated();
  const effectiveAuth: FeedbackAuthState = hydrated ? auth : "pending";
  const effectiveMyVote = hydrated ? myVote : undefined;

  // 真 disabled 只用来防连点: 只读演示账号走 aria-disabled——原生 disabled 的按钮
  // 在 Chrome 里既不显示 title 也拿不到焦点, 那条「演示账号不可投票」的提示就没人看得到
  const isMutating = setFeedback.isPending || clearFeedback.isPending;
  const isReadOnly = effectiveAuth === "readonly-guest";
  const isSessionPending = effectiveAuth === "pending";
  // pending 只需要「点不动」, 不挂提示: m.feedback_readonly() 说的是「只读账号」,
  // 语义不对; 而 session 解析通常几毫秒, 也没什么值得说的
  const hint = isReadOnly
    ? m.feedback_readonly()
    : effectiveAuth === "signed-out"
      ? m.feedback_login_required()
      : undefined;
  const isInert = isReadOnly || isSessionPending;

  /**
   * 未登录去登录、只读演示账号与 session 未解析直接吞掉(按钮已 aria-disabled,
   * 这里是第二道)。pending 必须返回 false: 否则已登录用户在这一帧点一下会被当成
   * 未登录踢去 GitHub OAuth。
   */
  const canVote = () => {
    if (isSessionPending) return false;
    if (effectiveAuth === "signed-out") {
      void startGitHubSignIn(signInCallbackURL);
      return false;
    }
    return effectiveAuth !== "readonly-guest";
  };

  const handleLike = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canVote()) return;
    if (effectiveMyVote === 1) clearFeedback.mutate({ paperId });
    else setFeedback.mutate({ paperId, vote: 1 });
  };

  const handleDislike = (event: MouseEvent<HTMLButtonElement>) => {
    // preventDefault 一举两得: 拦住外层 <Link> 的跳转, 同时让 PopoverTrigger
    // 跳过它自己的 open 切换(Radix 的 composeEventHandlers 见 defaultPrevented
    // 就不再调内部 handler), 开合完全由这里决定。
    event.preventDefault();
    event.stopPropagation();
    // 开着时再点 = 收起。Radix 不把落在 trigger 上的 pointerdown 当「点外面」,
    // 而它自己的切换又被上面的 preventDefault 挡掉了, 所以这一步得自己补
    if (popoverOpen) {
      closePopover();
      return;
    }
    if (!canVote()) return;
    if (effectiveMyVote === -1) {
      clearFeedback.mutate({ paperId });
      return;
    }
    setPopoverOpen(true);
  };

  const submitDislike = () => {
    setFeedback.mutate({
      paperId,
      vote: -1,
      reasonPreset: reasonPreset ?? undefined,
      reasonText: reasonText.trim() || undefined,
    });
    closePopover();
  };

  const isCard = variant === "card";
  const pillClassName = cn(
    "inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] text-[var(--ink-soft)] transition-colors",
    "hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--line)] disabled:hover:text-[var(--ink-soft)]",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-[var(--line)] aria-disabled:hover:text-[var(--ink-soft)]",
    isCard ? "h-7 px-2 text-[11px]" : "h-8 px-3 text-xs",
  );
  // 已投的一侧: 描边与文字转为 academic-brown, 图标填实——不靠背景色, 卡片上悬浮时
  // 也不会糊成一块
  const votedClassName =
    "border-[var(--academic-brown)] bg-[var(--parchment-warm)] text-[var(--academic-brown)]";
  const iconClassName = isCard ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    // data-feedback-open 不是死代码: 卡片形态靠 opacity-0 group-hover:opacity-100
    // 浮现, 而 popover 是 portal 到 body 的, 指针一移进浮层卡片就 un-hover, 按钮
    // 连着浮层的锚点一起淡出。父卡片用 has-[[data-feedback-open]]:opacity-100
    // 之类在开着的时候锁定可见。(group-focus-within 救不了: Radix FocusScope 把
    // 焦点移进了卡片 DOM 之外的 portal 内容。)
    <div
      className={cn("flex items-center gap-1.5", className)}
      data-feedback-open={popoverOpen || undefined}
    >
      <button
        type="button"
        onClick={handleLike}
        disabled={isMutating}
        aria-disabled={isInert || undefined}
        aria-pressed={effectiveMyVote === 1}
        // detail 形态自带文案(还带赞数), 再加 aria-label 反而把赞数从读屏里抹掉;
        // card 形态没文案, 赞数得拼进 label, 否则读屏用户听不到。
        // showCount=false 时不拼: 那种调用点自己在别处播报赞数, 拼进来会念两遍。
        aria-label={
          isCard
            ? showCount && likeCount > 0
              ? `${m.feedback_like()} (${likeCount})`
              : m.feedback_like()
            : undefined
        }
        title={hint}
        className={cn(pillClassName, effectiveMyVote === 1 && votedClassName)}
      >
        <ThumbsUp
          className={iconClassName}
          fill={effectiveMyVote === 1 ? "currentColor" : "none"}
        />
        {!isCard && <span>{m.feedback_like()}</span>}
        {showCount && likeCount > 0 && (
          <span className="tabular-nums">{likeCount}</span>
        )}
      </button>

      <Popover
        open={popoverOpen}
        onOpenChange={(next) => {
          // 打开只由 handleDislike 决定; 这里只接 Esc / 点外面带来的关闭
          if (!next) closePopover();
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={handleDislike}
            disabled={isMutating}
            aria-disabled={isInert || undefined}
            aria-pressed={effectiveMyVote === -1}
            aria-label={isCard ? m.feedback_dislike() : undefined}
            title={hint}
            className={cn(
              pillClassName,
              effectiveMyVote === -1 && votedClassName,
            )}
          >
            <ThumbsDown
              className={iconClassName}
              fill={effectiveMyVote === -1 ? "currentColor" : "none"}
            />
            {!isCard && <span>{m.feedback_dislike()}</span>}
          </button>
        </PopoverTrigger>
        {/* Radix portal 到 body, 但 React 事件仍沿组件树冒泡, 卡片场景要挡住外层 Link。
            aria-labelledby 是必须的: PopoverContent 是 role="dialog", 而仓库的
            PopoverTitle 只是个样式化的 div, 不会自动接线, 不给名字读屏会播报一个无名对话框。 */}
        <PopoverContent
          align="start"
          aria-labelledby={titleId}
          className="w-64 space-y-3 p-3"
          onClick={(event) => event.stopPropagation()}
        >
          <PopoverTitle id={titleId} className="text-xs text-[var(--ink-soft)]">
            {m.feedback_reason_title()}
          </PopoverTitle>
          <div className="flex flex-wrap gap-1.5">
            {REASON_CHIPS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setReasonPreset((prev) => (prev === preset ? null : preset));
                }}
                aria-pressed={reasonPreset === preset}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  reasonPreset === preset
                    ? "border-[var(--academic-brown)] bg-[var(--parchment-warm)] text-[var(--academic-brown)]"
                    : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--academic-brown)] hover:text-[var(--academic-brown)]",
                )}
              >
                {REASON_CHIP_LABELS[preset]()}
              </button>
            ))}
          </div>
          <Input
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
            onKeyDown={(event) => {
              // 回车即提交: 理由都是短句, 不必移到提交按钮
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitDislike();
            }}
            placeholder={m.feedback_reason_placeholder()}
            // 与后端 setFeedback 的 zod .max() 共用一个常量, 别改回字面量
            maxLength={FEEDBACK_REASON_TEXT_MAX_LENGTH}
            className="h-8 text-sm"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                submitDislike();
              }}
              disabled={setFeedback.isPending}
            >
              {m.feedback_submit()}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
