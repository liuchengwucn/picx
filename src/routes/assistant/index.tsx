import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { UIMessage } from "ai";
import {
  Check,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AssistantChat } from "#/components/assistant/assistant-chat";
import { ProfileDialog } from "#/components/assistant/profile-dialog";
import { resolveChatErrorMessage } from "#/components/chat/chat-message";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useRequireAuth } from "#/hooks/use-require-auth";
import { useTRPC } from "#/integrations/trpc/react";
import type { TRPCRouter } from "#/integrations/trpc/router";
import { formatRelative } from "#/lib/relative-time";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

export const Route = createFileRoute("/assistant/")({
  component: AssistantPage,
  head: () => ({
    meta: [{ title: m.assistant_page_title() }],
  }),
});

/** 服务端标题上限 80，输入框跟着卡同一个值，避免提交后被 tRPC 拒掉 */
const TITLE_MAX_CHARS = 80;

type ConversationSummary =
  inferRouterOutputs<TRPCRouter>["assistant"]["listConversations"][number];

interface ConversationRowProps {
  conversation: ConversationSummary;
  isActive: boolean;
  isRenaming: boolean;
  /** 已点过删除、正在等第二次确认（就地两步确认，不弹系统对话框） */
  isConfirmingDelete: boolean;
  isDeleting: boolean;
  now: number;
  onSelect: () => void;
  onStartRename: () => void;
  onSubmitRename: (title: string) => void;
  onCancelRename: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/**
 * 会话行。选中态用左侧棕色细线标记——与助手回答的左边线同一个记号，
 * 「当前这条线索」在侧栏和正文里说的是同一句话。
 */
function ConversationRow({
  conversation,
  isActive,
  isRenaming,
  isConfirmingDelete,
  isDeleting,
  now,
  onSelect,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: ConversationRowProps) {
  const title = conversation.title ?? m.assistant_untitled();

  if (isConfirmingDelete) {
    return (
      <li className="flex items-start gap-1 rounded-md bg-[var(--parchment-warm)] px-2 py-1.5">
        <span className="min-w-0 flex-1 text-xs leading-snug text-[var(--ink-soft)]">
          {m.assistant_delete_confirm()}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onConfirmDelete}
          disabled={isDeleting}
          aria-label={m.assistant_delete()}
          title={m.assistant_delete()}
        >
          {isDeleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5 text-[var(--sienna)]" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onCancelDelete}
          aria-label={m.cancel()}
          title={m.cancel()}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </li>
    );
  }

  if (isRenaming) {
    return (
      <li className="rounded-md bg-[var(--parchment-warm)] px-2 py-1.5">
        <input
          // biome-ignore lint/a11y/noAutofocus: 重命名是用户点菜单显式发起的，光标必须落进来
          autoFocus
          // 空标题会话不能拿 i18n 兜底串当初值：直接失焦就会把「新会话」写死进库
          defaultValue={conversation.title ?? ""}
          placeholder={m.assistant_untitled()}
          maxLength={TITLE_MAX_CHARS}
          aria-label={m.assistant_rename()}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmitRename(event.currentTarget.value);
            }
            if (event.key === "Escape") onCancelRename();
          }}
          onBlur={(event) => onSubmitRename(event.currentTarget.value)}
          className="w-full rounded-sm border-b border-[var(--academic-brown)]/50 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]"
        />
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-1 rounded-md border-l-2 pr-1 pl-2 transition-colors",
        isActive
          ? "border-[var(--academic-brown)]/70 bg-[var(--parchment-warm)]"
          : "border-transparent hover:bg-[var(--parchment-warm)]/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={isActive ? "true" : undefined}
        className="min-w-0 flex-1 rounded-sm py-1.5 text-left focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
      >
        <span className="block truncate text-sm text-[var(--ink)]">
          {title}
        </span>
        <span className="block text-[11px] text-[var(--ink-soft)]">
          {formatRelative(conversation.updatedAt.getTime(), now, getLocale())}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            // 每行一个同样的菜单按钮，标签里带上会话名读屏才分得清是哪一条
            aria-label={`${m.edit()}: ${title}`}
            // 触屏没有 hover：窄屏常驻，md 起才藏进 hover/焦点
            className="opacity-70 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onStartRename}>
            <Pencil className="h-3.5 w-3.5" />
            {m.assistant_rename()}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={isDeleting}
            onSelect={onRequestDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {m.assistant_delete()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function AssistantPage() {
  const { session, isSessionPending } = useRequireAuth("/assistant");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // 窄屏展开区的列表要被开关的 aria-controls 指向（桌面那份不需要 id）
  const mobileListId = useId();

  const [activeId, setActiveId] = useState<string | null>(null);
  /** 选中当前会话的时刻，用来判断历史缓存是否已在这次选中之后刷新过 */
  const [selectedAt, setSelectedAt] = useState(0);
  const [isListOpen, setIsListOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** 按会话存草稿：换会话会卸载整个对话组件，输入框内容得由页面替它保管 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** 「空列表就自动建一个会话」只做一次，否则删光会话会陷入无限新建 */
  const didAutoCreateRef = useRef(false);

  const conversationsQuery = useQuery({
    ...trpc.assistant.listConversations.queryOptions(),
    enabled: !!session,
  });
  const conversations = conversationsQuery.data;

  const messagesQuery = useQuery({
    ...trpc.assistant.getMessages.queryOptions({
      conversationId: activeId ?? "",
    }),
    enabled: !!activeId,
    // 覆盖全局 1 分钟 staleTime：每次切回会话都必须重取。历史真源在 D1，被中断
    // 的流仍会由服务端 waitUntil 补写回答，缓存里的旧快照会少一条。
    staleTime: 0,
  });

  const invalidateList = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.assistant.listConversations.queryKey(),
    });
  }, [queryClient, trpc]);

  const selectConversation = useCallback((id: string | null) => {
    setActiveId(id);
    // 打上时间戳：在这之前落地的历史缓存一律当过期（中断的流由服务端异步落库，
    // 旧快照可能缺最后一条回答，而 useChat 只在挂载时读一次 initialMessages）
    setSelectedAt(Date.now());
    setIsListOpen(false);
    setRenamingId(null);
    setPendingDeleteId(null);
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
      onSettled: () => setPendingDeleteId(null),
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

  const handleDelete = (conversationId: string) => {
    // 一次只删一个：pending 期间再点会重复发同一个请求
    if (deleteMutation.isPending) return;
    deleteMutation.mutate({ conversationId });
  };

  const handleRename = (conversationId: string, rawTitle: string) => {
    setRenamingId(null);
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

  const renderConversationList = (id?: string) => (
    <ul id={id} className="space-y-0.5">
      {conversations?.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          isActive={conversation.id === activeId}
          isRenaming={renamingId === conversation.id}
          isConfirmingDelete={pendingDeleteId === conversation.id}
          isDeleting={
            deleteMutation.isPending &&
            deleteMutation.variables?.conversationId === conversation.id
          }
          now={now}
          onSelect={() => selectConversation(conversation.id)}
          onStartRename={() => setRenamingId(conversation.id)}
          onSubmitRename={(title) => handleRename(conversation.id, title)}
          onCancelRename={() => setRenamingId(null)}
          onRequestDelete={() => setPendingDeleteId(conversation.id)}
          onConfirmDelete={() => handleDelete(conversation.id)}
          onCancelDelete={() => setPendingDeleteId(null)}
        />
      ))}
    </ul>
  );

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
    // 视口高度减去 header（≈60/68px）：对话区自己滚，输入框吸在底部
    <main className="page-wrap flex h-[calc(100dvh-3.75rem)] sm:h-[calc(100dvh-4.25rem)]">
      <h1 className="sr-only">{m.assistant_page_title()}</h1>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--line)] py-4 pr-4 md:flex">
        <h2 className="text-[11px] tracking-[0.18em] text-[var(--ink-soft)] uppercase">
          {m.assistant_conversations()}
        </h2>
        {/* 新对话是主动作，个人档案挨着它但降一级（ghost）——同一层工具，不同分量 */}
        {/* 按钮不换行也不收缩：日文标签比侧栏还宽时靠 flex-wrap 落到第二行 */}
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {newConversationButton}
          <ProfileDialog />
        </div>
        <nav
          aria-label={m.assistant_conversations()}
          className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
        >
          {conversationsQuery.isPending ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--academic-brown)]" />
            </div>
          ) : (
            renderConversationList()
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-5">
        {/* 窄屏：侧栏收成一行「当前会话」开关，展开后就地列出全部会话 */}
        <div className="flex items-center gap-2 border-b border-[var(--line)] py-2 md:hidden">
          <button
            type="button"
            onClick={() => setIsListOpen((open) => !open)}
            aria-expanded={isListOpen}
            aria-controls={mobileListId}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left text-sm text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
          >
            <span className="truncate">
              {activeConversation?.title ?? m.assistant_untitled()}
            </span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)] transition-transform",
                isListOpen && "rotate-180",
              )}
            />
          </button>
          <ProfileDialog />
          {newConversationButton}
        </div>
        {isListOpen && (
          <div className="max-h-64 overflow-y-auto border-b border-[var(--line)] py-2 md:hidden">
            {renderConversationList(mobileListId)}
          </div>
        )}

        {/* min-h-0 flex-1 包一层：AssistantChat 内部按 h-full 撑满，直接当 flex
            item 会连同上面的窄屏会话条一起算进 100%，把输入区挤出视口 */}
        {activeId && isHistoryReady && messagesQuery.data ? (
          <div className="min-h-0 flex-1">
            <AssistantChat
              // 换会话必须重建 Chat：useChat 只在挂载时读一次 initialMessages
              key={activeId}
              conversationId={activeId}
              initialMessages={messagesQuery.data as unknown as UIMessage[]}
              input={drafts[activeId] ?? ""}
              onInputChange={(value) =>
                setDrafts((previous) => ({ ...previous, [activeId]: value }))
              }
              onFirstMessage={invalidateList}
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
