import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { type MouseEvent, useId, useState } from "react";
import { toast } from "sonner";
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
import { startGitHubSignIn } from "#/lib/auth-client";
import {
  type ChipReasonPreset,
  REASON_CHIP_LABELS,
  REASON_CHIPS,
} from "#/lib/feedback-reasons";
import { GALLERY_LIST_QUERY_KEY } from "#/lib/gallery-search";
import { FEEDBACK_REASON_TEXT_MAX_LENGTH } from "#/lib/paper-feedback";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/**
 * 同一时刻最多开一个浮层, 所以用一个三选一而不是三个 boolean —— 后者能表达
 * 「赞和踩的浮层同时开着」这种非法态, 而两个浮层各自 portal 到 body, 真开出来
 * 会在页面上叠成两块。三种用途:
 * - reason: 踩票的理由表单(原有)
 * - signin-like / signin-dislike: 未登录点赞/点踩弹的登录提示。分成两个是因为浮层
 *   要锚在**被点的那个**按钮下面, 而锚点由它挂在哪个 Popover 下决定, 光靠一个
 *   "signin" 分不出该挂谁。
 */
type OpenPopover = "reason" | "signin-like" | "signin-dislike";

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
  const [openPopover, setOpenPopover] = useState<OpenPopover | null>(null);
  // 三个浮层共用一个 id: 任意时刻只有一个 PopoverContent 挂载(见 OpenPopover 的注释),
  // 所以 DOM 里永远不会同时出现两个用它的节点, 撞不了。
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
  // 投票没有乐观更新, 界面要等失效重取才动: 失败时如果连提示都不给, 用户看到的就是
  // 「点了赞, 什么也没发生」, 与「点成功了但赞数还没刷回来」完全无法区分, 于是只会
  // 反复点。mutation 默认 retry: 0, 一次网络抖动就是终局, 更得说出来。
  const toastError = () => toast.error(m.feedback_failed());
  const setFeedback = useMutation(
    trpc.paper.setFeedback.mutationOptions({
      onSuccess: invalidate,
      onError: toastError,
    }),
  );
  const clearFeedback = useMutation(
    trpc.paper.clearFeedback.mutationOptions({
      onSuccess: invalidate,
      onError: toastError,
    }),
  );

  const closePopover = () => {
    setOpenPopover(null);
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
   * 未登录弹登录浮层、只读演示账号与 session 未解析直接吞掉(按钮已 aria-disabled,
   * 这里是第二道)。pending 必须返回 false: 否则已登录用户在这一帧点一下会被当成
   * 未登录, 平白弹一次登录墙。
   *
   * 未登录这一档以前是直接 void startGitHubSignIn(...) —— 整页当场甩去 github.com,
   * 唯一预告是要悬停一秒才出的原生 title(触屏上根本没有), 而 /gallery 是无限滚动,
   * 跳走等于把已展开的十几页全丢掉(回跳只还原 URL)。现在改成先弹浮层, 跳转由用户
   * 在浮层里的第二次点击发起。signInPopover 决定浮层锚在哪个按钮下。
   */
  const canVote = (signInPopover: "signin-like" | "signin-dislike") => {
    if (isSessionPending) return false;
    if (effectiveAuth === "signed-out") {
      setOpenPopover(signInPopover);
      return false;
    }
    return effectiveAuth !== "readonly-guest";
  };

  const handleLike = (event: MouseEvent<HTMLButtonElement>) => {
    // preventDefault 一举两得: 拦住外层 <Link> 的跳转, 同时让 PopoverTrigger
    // 跳过它自己的 open 切换(Radix 的 composeEventHandlers 见 defaultPrevented
    // 就不再调内部 handler), 开合完全由这里决定。
    event.preventDefault();
    event.stopPropagation();
    // 开着时再点 = 收起。Radix 不把落在 trigger 上的 pointerdown 当「点外面」,
    // 而它自己的切换又被上面的 preventDefault 挡掉了, 所以这一步得自己补
    if (openPopover === "signin-like") {
      closePopover();
      return;
    }
    if (!canVote("signin-like")) return;
    if (effectiveMyVote === 1) clearFeedback.mutate({ paperId });
    else setFeedback.mutate({ paperId, vote: 1 });
  };

  const handleDislike = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // 同上: 自己接管「再点一次收起」。理由表单和登录提示都挂在这个 trigger 上,
    // 两种都算「开着」
    if (openPopover === "reason" || openPopover === "signin-dislike") {
      closePopover();
      return;
    }
    // 未登录时到不了下面: canVote 已经把浮层切到 signin-dislike 并返回 false。
    // 这是有意的 —— 还没登录就问「为什么不喜欢」收不到能用的口味样本。
    if (!canVote("signin-dislike")) return;
    if (effectiveMyVote === -1) {
      clearFeedback.mutate({ paperId });
      return;
    }
    setOpenPopover("reason");
  };

  /**
   * 提交成功才关 popover。改动前是无条件先关: 请求还没落地就把 preset 与自由文本
   * 一起 reset 掉了, 失败时用户刚敲的理由直接没了, 连重试都得重打一遍。
   *
   * 收在 mutate 的 per-call onSuccess 里而不是把 reset 从 closePopover 里挪出来 ——
   * closePopover 的「关闭 + 清空」是一体的语义, 另一个调用点(handleDislike 里再点一次
   * 收起)正需要它清空, 不然下次点踩会残留上次选的 chip。失败路径什么都不做: popover
   * 保持打开、输入原样留着, 错误由 mutation 的 onError 弹提示。
   */
  const submitDislike = () => {
    setFeedback.mutate(
      {
        paperId,
        vote: -1,
        reasonPreset: reasonPreset ?? undefined,
        reasonText: reasonText.trim() || undefined,
      },
      { onSuccess: closePopover },
    );
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

  /**
   * 未登录点赞/点踩弹的登录提示。刻意跟理由浮层长得一样(同样的 PopoverContent 外壳、
   * 同样 text-xs/ink-soft 的标题), 它是个功能性提示, 不该自成一套视觉。
   * 赞和踩各挂一份, 但同一时刻只有一份是挂载的。
   */
  const signInPopoverContent = (
    // aria-labelledby 与理由浮层同理: PopoverContent 是 role="dialog", 而仓库的
    // PopoverTitle 只是个样式化 div, 不接线的话读屏播报的是一个无名对话框。
    // stopPropagation 挡住卡片场景的外层 Link。
    <PopoverContent
      align="start"
      aria-labelledby={titleId}
      className="w-56 space-y-2.5 p-3"
      onClick={(event) => event.stopPropagation()}
    >
      <PopoverTitle id={titleId} className="text-xs text-[var(--ink-soft)]">
        {m.feedback_login_required()}
      </PopoverTitle>
      <Button
        size="sm"
        className="w-full"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void startGitHubSignIn(signInCallbackURL);
        }}
      >
        {m.auth_sign_in_github()}
      </Button>
    </PopoverContent>
  );

  return (
    // data-feedback-open 不是死代码: 卡片形态靠 opacity-0 group-hover:opacity-100
    // 浮现, 而 popover 是 portal 到 body 的, 指针一移进浮层卡片就 un-hover, 按钮
    // 连着浮层的锚点一起淡出。父卡片用 has-[[data-feedback-open]]:opacity-100
    // 之类在开着的时候锁定可见。(group-focus-within 救不了: Radix FocusScope 把
    // 焦点移进了卡片 DOM 之外的 portal 内容。)
    <div
      className={cn("flex items-center gap-1.5", className)}
      data-feedback-open={openPopover ?? undefined}
    >
      <Popover
        open={openPopover === "signin-like"}
        onOpenChange={(next) => {
          // 打开只由 handleLike 决定; 这里只接 Esc / 点外面带来的关闭
          if (!next) closePopover();
        }}
      >
        <PopoverTrigger asChild>
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
            className={cn(
              pillClassName,
              effectiveMyVote === 1 && votedClassName,
            )}
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
        </PopoverTrigger>
        {signInPopoverContent}
      </Popover>

      <Popover
        open={openPopover === "reason" || openPopover === "signin-dislike"}
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
        {/* 踩按钮下面挂两种内容, 按开态二选一: 未登录是登录提示, 已登录才是理由表单。
            Radix portal 到 body, 但 React 事件仍沿组件树冒泡, 卡片场景要挡住外层 Link。
            aria-labelledby 是必须的: PopoverContent 是 role="dialog", 而仓库的
            PopoverTitle 只是个样式化的 div, 不会自动接线, 不给名字读屏会播报一个无名对话框。 */}
        {openPopover === "signin-dislike" ? (
          signInPopoverContent
        ) : (
          <PopoverContent
            align="start"
            aria-labelledby={titleId}
            className="w-64 space-y-3 p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <PopoverTitle
              id={titleId}
              className="text-xs text-[var(--ink-soft)]"
            >
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
                    setReasonPreset((prev) =>
                      prev === preset ? null : preset,
                    );
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
        )}
      </Popover>
    </div>
  );
}
