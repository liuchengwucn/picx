import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import type { UIMessage } from "ai";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AssistantChat } from "#/components/assistant/assistant-chat";
import { ConversationHeader } from "#/components/assistant/conversation-header";
import { ConversationList } from "#/components/assistant/conversation-list";
import { ProfileDialog } from "#/components/assistant/profile-dialog";
import { resolveChatErrorMessage } from "#/components/chat/chat-message";
import { Button } from "#/components/ui/button";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

export const Route = createFileRoute("/assistant/")({
  component: AssistantPage,
  head: () => ({
    meta: [{ title: m.assistant_page_title() }],
  }),
});

/** 服务端标题上限 80，输入框跟着卡同一个值，避免提交后被 tRPC 拒掉 */
const TITLE_MAX_CHARS = 80;

function AssistantPage() {
  const { session, isSessionPending } = useRequireAuth("/assistant");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  // 窄屏展开区的列表要被开关的 aria-controls 指向（桌面那份不需要 id）
  const mobileListId = useId();
  // 技能编辑页「用它开一段对话」带来的预选技能名
  const pendingSkillName = useLocation({
    select: (location) => location.state.pendingSkillName,
  });
  // 预选生效后把它从路由 state 里清掉：不清的话它会一直挂在 location.state
  // 上，用户之后点的每一个会话都会被重新预选上同一条技能
  const clearPendingSkillName = useCallback(() => {
    void navigate({
      replace: true,
      state: (prev) => ({ ...prev, pendingSkillName: undefined }),
    });
  }, [navigate]);

  const [activeId, setActiveId] = useState<string | null>(null);
  /** 选中当前会话的时刻，用来判断历史缓存是否已在这次选中之后刷新过 */
  const [selectedAt, setSelectedAt] = useState(0);
  const [isListOpen, setIsListOpen] = useState(false);
  /** 按会话存草稿：换会话会卸载整个对话组件，输入框内容得由页面替它保管 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** 「空列表就自动建一个会话」只做一次，否则删光会话会陷入无限新建 */
  const didAutoCreateRef = useRef(false);

  const conversationsQuery = useQuery({
    ...trpc.assistant.listConversations.queryOptions(),
    enabled: !!session,
  });
  const conversations = conversationsQuery.data;

  // 与 AssistantChat 里 slash 选择器用的是同一个 queryKey，react-query 会去重，
  // 不产生额外请求
  const skillsQuery = useQuery({
    ...trpc.skills.list.queryOptions(),
    enabled: !!session,
  });
  const enabledSkillCount =
    skillsQuery.data?.filter((row) => row.enabled).length ?? 0;

  const messagesQuery = useQuery({
    ...trpc.assistant.getMessages.queryOptions({
      conversationId: activeId ?? "",
    }),
    enabled: !!activeId,
    // 覆盖全局 1 分钟 staleTime：每次切回会话都必须重取。历史真源在 D1，断流后
    // 生成仍在 ChatRunner DO 里跑完并落库，缓存里的旧快照会少一条。
    staleTime: 0,
  });

  const invalidateList = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.assistant.listConversations.queryKey(),
    });
  }, [queryClient, trpc]);

  const selectConversation = useCallback((id: string | null) => {
    setActiveId(id);
    // 打上时间戳：在这之前落地的历史缓存一律当过期（断流后 ChatRunner DO 仍会
    // 把回答落库，旧快照可能缺最后一条，而 useChat 只在挂载时读一次 initialMessages）
    setSelectedAt(Date.now());
    setIsListOpen(false);
  }, []);

  const createMutation = useMutation(
    trpc.assistant.createConversation.mutationOptions({
      onSuccess: (row) => {
        invalidateList();
        if (row) selectConversation(row.id);
      },
      onError: (error) => toast.error(resolveChatErrorMessage(error)),
    }),
  );

  const renameMutation = useMutation(
    trpc.assistant.renameConversation.mutationOptions({
      onSuccess: invalidateList,
      onError: (error) => toast.error(resolveChatErrorMessage(error)),
    }),
  );

  const deleteMutation = useMutation(
    trpc.assistant.deleteConversation.mutationOptions({
      onSuccess: (_result, variables) => {
        // 必须先就地把这行从列表缓存里剔掉再决定选谁：invalidate 触发的 refetch 是
        // 异步的，同一帧读到的列表还带着刚删的那条，会把 activeId 换成幽灵 id。
        const remaining = queryClient.setQueryData(
          trpc.assistant.listConversations.queryKey(),
          (rows) => rows?.filter((row) => row.id !== variables.conversationId),
        );
        invalidateList();
        // 这个会话的草稿也跟着走，别在内存里留着一条永远回不去的输入
        setDrafts(({ [variables.conversationId]: _removed, ...rest }) => rest);
        // 删的是当前会话：直接落到剩下最近更新的一条（没有就回到空态）
        if (variables.conversationId === activeId) {
          selectConversation(remaining?.[0]?.id ?? null);
        }
      },
      onError: (error) => toast.error(resolveChatErrorMessage(error)),
    }),
  );

  // 列表空且从没自动建过 → 建一个，让用户进来就能直接说话
  useEffect(() => {
    if (didAutoCreateRef.current) return;
    if (!conversationsQuery.isSuccess) return;
    if ((conversations?.length ?? 0) > 0) return;
    didAutoCreateRef.current = true;
    createMutation.mutate(undefined);
  }, [conversationsQuery.isSuccess, conversations, createMutation.mutate]);

  // 没有选中项时落到最近更新的一条（首次进入、以及删除当前会话之后）
  useEffect(() => {
    if (activeId) return;
    const latest = conversations?.[0];
    if (latest) selectConversation(latest.id);
  }, [activeId, conversations, selectConversation]);

  const [now, setNow] = useState(() => Date.now());
  // 相对时间每分钟走一次针，别让「3 分钟前」在页面上冻住
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // 窄屏面板是 overlay，Esc 要能关掉它（点遮罩与选中会话另有出口）
  useEffect(() => {
    if (!isListOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsListOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isListOpen]);

  const handleDelete = (conversationId: string) => {
    // 一次只删一个：pending 期间再点会重复发同一个请求
    if (deleteMutation.isPending) return;
    deleteMutation.mutate({ conversationId });
  };

  const handleRename = (conversationId: string, rawTitle: string) => {
    const title = rawTitle.trim().slice(0, TITLE_MAX_CHARS);
    const current = conversations?.find((row) => row.id === conversationId);
    // 空标题（服务端也不收）或原样提交一律当取消：直接失焦不该写任何东西
    if (!title || title === current?.title) return;
    renameMutation.mutate({ conversationId, title });
  };

  const activeConversation = conversations?.find((row) => row.id === activeId);
  /**
   * 历史是否已经是「这次选中之后」拿到的。react-query 会先把旧缓存吐出来再后台
   * 重取，而 useChat 只读一次 initialMessages——直接用缓存挂载会漏掉上一轮被中断
   * 后由服务端补写的回答。取数失败（isFetching 落回 false 但没拿到新数据）时
   * 放行现有缓存，总比让用户对着转圈强。
   * 判定只看有没有数据、不看 isSuccess：后台重取一失败 status 就变 error，用它
   * 当门会把正在对话的聊天区连同草稿一起卸载掉。
   */
  const isHistoryReady =
    !!activeId &&
    !!messagesQuery.data &&
    (messagesQuery.dataUpdatedAt >= selectedAt || !messagesQuery.isFetching);

  if (isSessionPending) {
    return (
      <main className="page-wrap flex items-center justify-center py-24">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
      </main>
    );
  }

  // 未登录会被 useRequireAuth 送去登录页，这里不渲染任何东西
  if (!session) return null;

  const newConversationButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => createMutation.mutate(undefined)}
      disabled={createMutation.isPending}
      aria-label={m.assistant_new_conversation()}
    >
      {createMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      <span className="max-md:sr-only">{m.assistant_new_conversation()}</span>
    </Button>
  );

  // 桌面侧栏头部的整宽变体：与上面共享同一个 mutation，只是撑满整行。
  // 不复用 newConversationButton 本体是因为它还被窄屏头栏与空态兜底共用，
  // 那两处不能被 w-full 撑开。
  const newConversationButtonWide = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => createMutation.mutate(undefined)}
      disabled={createMutation.isPending}
      className="w-full"
    >
      {createMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
      {m.assistant_new_conversation()}
    </Button>
  );

  // 技能管理入口：与个人档案同级同分量（ghost），样式沿用 ProfileDialog 的触发按钮。
  // min-w-0 + shrink 覆盖 Button 默认的 shrink-0：技能数到两位数、日语这类
  // 较长的字符集会把这一行撑到 244.6px，比 w-64 侧栏刨去 padding 后的 240px
  // 还宽——不许它收缩就只能眼睁睁溢出边框；文字 span 配 truncate 兜底省略号。
  const skillsLink = (
    <Button asChild variant="ghost" size="sm" className="min-w-0 shrink">
      <Link to="/assistant/skills" title={m.assistant_skills_title()}>
        <Sparkles className="h-4 w-4 shrink-0" />
        <span className="truncate">
          {m.assistant_skills_count({ count: enabledSkillCount })}
        </span>
      </Link>
    </Button>
  );

  // 三态：加载中 / 加载失败（带重试）/ 列表。失败时绝不能落到 ConversationList
  // 的空态去——那句文案说的是「没搜到」，不是「没拉到」。
  const conversationListPane = conversationsQuery.isPending ? (
    <div className="flex flex-1 justify-center py-4">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--academic-brown)]" />
    </div>
  ) : conversationsQuery.isError ? (
    <div className="flex flex-col items-start gap-2 px-3 py-4">
      <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
        {resolveChatErrorMessage(conversationsQuery.error)}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void conversationsQuery.refetch()}
      >
        {m.assistant_history_retry()}
      </Button>
    </div>
  ) : null;

  // 会话未就绪时的三种落点：拉历史失败、一条会话都没有、正在拉取
  const chatFallback = (() => {
    // 只有「一条历史都没拿到」才算失败落地：后台重取失败时 data 还在，聊天区照常
    // 挂着（见 isHistoryReady），这里不能把它换成错误屏
    if (
      messagesQuery.isLoadingError ||
      (messagesQuery.isError && !messagesQuery.data)
    ) {
      return (
        <>
          <p className="text-sm text-[var(--ink-soft)]">
            {resolveChatErrorMessage(messagesQuery.error)}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void messagesQuery.refetch()}
          >
            {m.assistant_history_retry()}
          </Button>
        </>
      );
    }
    // 会话被删光了：给一个明确的下一步，而不是无限转圈
    if (
      !activeId &&
      conversationsQuery.isSuccess &&
      (conversations?.length ?? 0) === 0 &&
      !createMutation.isPending
    ) {
      return newConversationButton;
    }
    return (
      <Loader2 className="h-5 w-5 animate-spin text-[var(--academic-brown)]" />
    );
  })();

  return (
    // 视口高度减去 header（≈60/68px）与底部 Tab 栏（md 起消失）及顶/底 safe-area：
    // 对话区自己滚，输入框吸在底部
    <main className="page-wrap flex h-[calc(100dvh-3.75rem-3.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] sm:h-[calc(100dvh-4.25rem-3.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:h-[calc(100dvh-4.25rem-env(safe-area-inset-top))]">
      <h1 className="sr-only">{m.assistant_page_title()}</h1>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--line)] py-4 md:flex">
        <div className="px-3">
          <h2 className="text-[11px] tracking-[0.18em] text-[var(--ink-soft)] uppercase">
            {m.assistant_conversations()}
          </h2>
          <div className="mt-2">{newConversationButtonWide}</div>
        </div>
        {conversationListPane ?? (
          <ConversationList
            conversations={conversations ?? []}
            activeId={activeId}
            onSelect={selectConversation}
            now={now}
          />
        )}
        {/* 技能与档案：不是每天点的东西，降到细线之下，并带上状态 */}
        <div className="mt-2 flex min-w-0 items-center gap-1 border-t border-[var(--line)] px-2 pt-2">
          {skillsLink}
          <span className="h-3 w-px shrink-0 bg-[var(--line)]" />
          <ProfileDialog />
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col md:pl-5">
        {/* 报头本身不再是面板的定位上下文（面板改锚在外层列上，见下），
            z-30 留着只为压过遮罩——它是这一列的 flex item，z-index 不需要
            额外的 position 就能生效。 */}
        <div className="z-30">
          {activeConversation && (
            <ConversationHeader
              // 换会话必须重挂：isRenaming/isConfirmingDelete 是组件内部 state，
              // 没有 key 时切会话不重挂，确认删除态会跟着漂到下一个会话头上
              // （对着新会话再点一下确认键，就把它删了）。用 id 不用整个对象，
              // 后台 invalidate 换引用时不会误触发重挂。
              key={activeConversation.id}
              title={activeConversation.title}
              messageCount={activeConversation.messageCount}
              updatedAt={activeConversation.updatedAt}
              now={now}
              isListOpen={isListOpen}
              onToggleList={() => setIsListOpen((open) => !open)}
              listId={mobileListId}
              onRename={(value) => handleRename(activeConversation.id, value)}
              onDelete={() => handleDelete(activeConversation.id)}
              isDeleting={
                deleteMutation.isPending &&
                deleteMutation.variables?.conversationId ===
                  activeConversation.id
              }
            />
          )}
        </div>

        {/* 面板锚在外层列（有 h-[calc(100dvh-...)]）上，用 top-10（=报头高度）
            与 bottom-0 双向卡住：可用高度不够 60vh 时，浏览器按 CSS2.1 10.6.4
            的「top/height 优先、bottom 被忽略」规则，把面板钉在顶端、按剩余空间
            收缩，永远不会探出这一列的底边、被下面 z-50 的 MobileTabBar 盖住。 */}
        {isListOpen && (
          <div className="absolute inset-x-0 top-10 bottom-0 z-30 flex max-h-[60vh] flex-col border-b border-[var(--line)] bg-[var(--parchment)] shadow-lg md:hidden">
            <div className="px-3 pt-2">{newConversationButtonWide}</div>
            {conversationListPane ?? (
              <ConversationList
                conversations={conversations ?? []}
                activeId={activeId}
                onSelect={selectConversation}
                now={now}
                listId={mobileListId}
              />
            )}
            <div className="flex min-w-0 items-center gap-1 border-t border-[var(--line)] px-2 py-1.5">
              {skillsLink}
              <span className="h-3 w-px shrink-0 bg-[var(--line)]" />
              <ProfileDialog />
            </div>
          </div>
        )}

        {/* 遮罩：盖住对话区，点它关面板。z 低于面板容器 */}
        {isListOpen && (
          <button
            type="button"
            aria-label={m.cancel()}
            onClick={() => setIsListOpen(false)}
            className="absolute inset-0 z-20 bg-[var(--ink)]/15 md:hidden"
          />
        )}

        {/* min-h-0 flex-1 包一层：AssistantChat 内部按 h-full 撑满，直接当 flex
            item 会连同报头一起算进 100%，把输入区挤出视口 */}
        {activeId && isHistoryReady && messagesQuery.data ? (
          <div className="min-h-0 flex-1">
            <AssistantChat
              key={activeId}
              conversationId={activeId}
              initialMessages={messagesQuery.data as unknown as UIMessage[]}
              input={drafts[activeId] ?? ""}
              onInputChange={(value) =>
                setDrafts((previous) => ({ ...previous, [activeId]: value }))
              }
              onFirstMessage={invalidateList}
              pendingSkillName={pendingSkillName}
              onPendingSkillApplied={clearPendingSkillName}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
            {chatFallback}
          </div>
        )}
      </div>
    </main>
  );
}
