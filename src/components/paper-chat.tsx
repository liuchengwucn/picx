import { useChat } from "@ai-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import {
  BookOpen,
  Check,
  ChevronDown,
  Globe,
  Loader2,
  MessageSquareQuote,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ChatInputArea } from "#/components/chat/chat-input";
import {
  ChatMessage,
  ChatThinking,
  resolveChatErrorMessage,
  type ToolDisplayMap,
} from "#/components/chat/chat-message";
import { createTextOnlyChatTransport } from "#/components/chat/chat-transport";
import { useChatSettings } from "#/components/chat/use-chat-settings";
import { useStickToBottom } from "#/components/chat/use-stick-to-bottom";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/** 聊天栏宽度（xl 三栏形态的第三列）。页面组件负责持久化与写 CSS 变量 */
export const CHAT_PANEL_WIDTH_STORAGE_KEY = "picx.chat.panelWidth";
/**
 * 可拖范围。上限按 1520px 容器倒推：1520 − 300(左栏) − 48(两道 gap) − 560
 * 仍给正文留 ~612px，再宽就把正文挤垮了。
 */
export const CHAT_PANEL_WIDTH = { min: 320, max: 560, default: 360 } as const;

export function clampChatPanelWidth(width: number): number {
  return Math.min(
    CHAT_PANEL_WIDTH.max,
    Math.max(CHAT_PANEL_WIDTH.min, Math.round(width)),
  );
}

/** paper 聊天的工具展示（行为与原硬编码一致） */
const PAPER_CHAT_TOOLS: ToolDisplayMap = {
  readPaper: {
    icon: BookOpen,
    running: m.chat_reading_paper,
    done: m.chat_read_paper_done,
  },
  web_search: {
    icon: Globe,
    running: m.chat_searching_web,
    done: m.chat_searched_web,
    // 搜索在 OpenRouter 服务端执行，流里只有工具调用没有 output part：
    // 参数一到齐（input-available）就当「已搜索」，结果以 source part 到达
    isDone: (state) => state !== "input-streaming",
  },
};

interface ConversationProps {
  paperShortId: string;
  /** 浮层形态下由面板自己渲染关闭按钮，避免和头部控件叠在一起 */
  onClose?: () => void;
  /** 草稿提在 PaperChat 层：抽屉关闭会卸载整棵子树，state 留这儿会丢 */
  input: string;
  onInputChange: (value: string) => void;
}

function PaperChatConversation({
  paperShortId,
  onClose,
  input,
  onInputChange,
}: ConversationProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const sessionListId = useId();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  // useChat 只在 id 变化时重建 Chat。id 里刻意不含 sessionId：首次发言会隐式
  // 建会话，若 id 跟着变，正在流式的回答会被整条丢掉。
  const [chatEpoch, setChatEpoch] = useState(0);
  const [isSessionListOpen, setIsSessionListOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const {
    webSearchEnabled,
    reasoningEffort,
    settingsRef,
    toggleWebSearch,
    changeReasoningEffort,
  } = useChatSettings("chat");

  const hydratedSessionRef = useRef<string | null>(null);
  const didAutoSelectRef = useRef(false);
  // 流开始那一刻的 sessionId。onFinish 只认它，不认「当前选中」——流式期间用户
  // 可能已经切走，用当前值会去失效一个毫不相干的会话缓存。
  const streamingSessionIdRef = useRef<string | null>(null);

  const sessionsQuery = useQuery(
    trpc.chat.listSessions.queryOptions({ paperShortId }),
  );
  const sessions = useMemo(
    () => sessionsQuery.data ?? [],
    [sessionsQuery.data],
  );

  const messagesQuery = useQuery({
    ...trpc.chat.getMessages.queryOptions({
      sessionId: selectedSessionId ?? "",
    }),
    enabled: !!selectedSessionId,
  });
  /**
   * 历史还在路上。此时禁止发送：hydrate 用的是 setMessages(整表覆盖)，若这期间
   * 已经开流，历史一到就会把刚发出去的用户消息和正在写的回答一起抹掉。
   */
  const isHydrating = !!selectedSessionId && messagesQuery.isLoading;

  const transport = useMemo(
    () =>
      createTextOnlyChatTransport({
        api: "/api/chat",
        settingsRef,
        extraBody: () => ({ paperShortId }),
      }),
    [paperShortId, settingsRef],
  );

  const invalidateSessions = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.chat.listSessions.queryKey({ paperShortId }),
    });
  }, [queryClient, trpc, paperShortId]);

  const invalidateSessionMessages = useCallback(
    (sessionId: string | null) => {
      if (!sessionId) return;
      void queryClient.invalidateQueries({
        queryKey: trpc.chat.getMessages.queryKey({ sessionId }),
      });
    },
    [queryClient, trpc],
  );

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: `paper-chat:${paperShortId}:${chatEpoch}`,
    transport,
    // 流式 chunk 可以来得比一帧还密；50ms 合批，省掉大量无意义的整表重渲染
    throttle: 50,
    onError: (error) => {
      toast.error(resolveChatErrorMessage(error));
    },
    onFinish: () => {
      invalidateSessions();
      invalidateSessionMessages(streamingSessionIdRef.current);
      streamingSessionIdRef.current = null;
    },
  });

  const isBusy = status === "submitted" || status === "streaming";

  const createSessionMutation = useMutation(
    trpc.chat.createSession.mutationOptions(),
  );
  const deleteSessionMutation = useMutation(
    trpc.chat.deleteSession.mutationOptions(),
  );

  // 默认落在最近一次对话上；只自动选一次，之后由用户操作决定
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    const latest = sessions[0];
    if (!latest) return;
    didAutoSelectRef.current = true;
    setSelectedSessionId(latest.id);
  }, [sessions]);

  // 历史注入：每个会话只灌一次，避免流式过程中被后台 refetch 覆盖
  useEffect(() => {
    if (!selectedSessionId) return;
    if (hydratedSessionRef.current === selectedSessionId) return;
    const history = messagesQuery.data;
    if (!history) return;
    hydratedSessionRef.current = selectedSessionId;
    setMessages(history as unknown as UIMessage[]);
  }, [selectedSessionId, messagesQuery.data, setMessages]);

  // 流式每来一个 chunk，最后一条消息都是新对象 → 依赖它即可持续贴底。
  // 但只在用户本来就贴着底时跟随：他上滚回看前文时把视口拽回去是最烦人的交互。
  const lastMessage = messages[messages.length - 1];
  const { scrollRef, handleScroll, resetStick } = useStickToBottom(lastMessage);

  const openSession = (sessionId: string | null) => {
    // 先把「被打断的那个会话」抠出来再 stop()：abort 不会触发 onFinish，但服务端
    // 的 waitUntil(consumeStream) 仍会把助手消息落库，所以它的历史缓存必须失效，
    // 否则切回去看到的是缺一条回答的旧快照。
    const interruptedSessionId = isBusy ? streamingSessionIdRef.current : null;
    if (isBusy) void stop();
    streamingSessionIdRef.current = null;
    hydratedSessionRef.current = null;
    didAutoSelectRef.current = true;
    // 换了会话就该看最新的一条，别继承上一个会话「用户上滚过」的状态
    resetStick();
    setSelectedSessionId(sessionId);
    setChatEpoch((epoch) => epoch + 1);
    setIsSessionListOpen(false);
    setPendingDeleteId(null);
    invalidateSessionMessages(interruptedSessionId);
    if (interruptedSessionId) invalidateSessions();
  };

  const handleDelete = async (sessionId: string) => {
    try {
      await deleteSessionMutation.mutateAsync({ sessionId });
    } catch (error) {
      toast.error(resolveChatErrorMessage(error));
      return;
    }
    setPendingDeleteId(null);
    invalidateSessions();
    toast.success(m.chat_session_deleted());
    if (sessionId === selectedSessionId) openSession(null);
  };

  const handleSend = async () => {
    const text = input.trim();
    // createSession 还在飞时再按一次回车会建出第二个空会话；
    // isHydrating 期间发出去的消息会被随后到达的历史覆盖掉
    if (!text || isBusy || isHydrating || createSessionMutation.isPending) {
      return;
    }

    let sessionId = selectedSessionId;
    if (!sessionId) {
      try {
        const created = await createSessionMutation.mutateAsync({
          paperShortId,
        });
        sessionId = created?.id ?? null;
      } catch (error) {
        const code =
          error && typeof error === "object" && "data" in error
            ? (error as { data?: { code?: string } }).data?.code
            : undefined;
        toast.error(
          code === "TOO_MANY_REQUESTS"
            ? m.chat_error_too_many_sessions()
            : m.chat_error_generic(),
        );
        return;
      }
      if (!sessionId) {
        toast.error(m.chat_error_generic());
        return;
      }
      // 会话是隐式新建的，历史必然为空：先认领 hydrate 标记，防止 getMessages
      // 回来时把正在流式的消息清掉
      hydratedSessionRef.current = sessionId;
      didAutoSelectRef.current = true;
      setSelectedSessionId(sessionId);
      invalidateSessions();
    }

    streamingSessionIdRef.current = sessionId;
    // 主动发言就是「我要看新内容」：哪怕刚才上滚在读前文，也弹回底部跟自己的
    // 消息和随后的回答
    resetStick();
    onInputChange("");
    void sendMessage({ text }, { body: { sessionId } });
  };

  const activeSession = sessions.find(
    (session) => session.id === selectedSessionId,
  );
  const showThinking = status === "submitted";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 会话条：标题即开关，展开后就地列出全部对话 */}
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquareQuote className="h-4 w-4 shrink-0 text-[var(--academic-brown)]" />
          <h2 className="font-serif text-base font-semibold text-[var(--ink)]">
            {m.chat_title()}
          </h2>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openSession(null)}
              aria-label={m.chat_new_session()}
              title={m.chat_new_session()}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {onClose && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label={m.chat_close()}
                title={m.chat_close()}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsSessionListOpen((open) => !open)}
          aria-expanded={isSessionListOpen}
          aria-controls={sessionListId}
          title={m.chat_sessions_label()}
          className="mt-1.5 flex w-full items-center gap-1 rounded-sm text-left text-xs text-[var(--ink-soft)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
        >
          <span className="truncate">
            {activeSession
              ? (activeSession.title ?? m.chat_session_untitled())
              : m.chat_new_session()}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform",
              isSessionListOpen && "rotate-180",
            )}
          />
        </button>

        {isSessionListOpen && (
          <ul
            id={sessionListId}
            className="mt-2 max-h-52 space-y-0.5 overflow-y-auto"
          >
            {sessions.length === 0 && (
              <li className="px-1 py-1 text-xs text-[var(--ink-soft)]">
                {m.chat_sessions_empty()}
              </li>
            )}
            {sessions.map((session) => (
              <li key={session.id}>
                {pendingDeleteId === session.id ? (
                  <div className="flex items-center gap-2 rounded-md bg-[var(--parchment-warm)] px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--ink-soft)]">
                      {m.chat_delete_session_confirm()}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void handleDelete(session.id)}
                      disabled={deleteSessionMutation.isPending}
                      aria-label={m.chat_delete_confirm()}
                      title={m.chat_delete_confirm()}
                    >
                      <Check className="h-3.5 w-3.5 text-[var(--sienna)]" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setPendingDeleteId(null)}
                      aria-label={m.chat_cancel()}
                      title={m.chat_cancel()}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1.5",
                      session.id === selectedSessionId
                        ? "bg-[var(--parchment-warm)]"
                        : "hover:bg-[var(--parchment-warm)]/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openSession(session.id)}
                      className="min-w-0 flex-1 truncate rounded-sm text-left text-xs text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
                    >
                      {session.title ?? m.chat_session_untitled()}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setPendingDeleteId(session.id)}
                      aria-label={m.chat_delete_session()}
                      title={m.chat_delete_session()}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--ink-soft)]" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 对话区。role=log + polite：新回答播报给读屏，但不打断当前朗读 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label={m.chat_title()}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {isHydrating ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--academic-brown)]" />
          </div>
        ) : messages.length === 0 ? (
          <p className="max-w-[36ch] text-sm leading-relaxed text-[var(--ink-soft)]">
            {m.chat_empty_hint()}
          </p>
        ) : (
          messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={isBusy && message.id === lastMessage?.id}
              toolDisplays={PAPER_CHAT_TOOLS}
            />
          ))
        )}
        {showThinking && <ChatThinking />}
      </div>

      {/* 输入区。焦点指示的设计理由见 ChatInputArea（chat-input.tsx）的组件注释 */}
      <div className="border-t border-[var(--line)] p-2">
        <ChatInputArea
          input={input}
          onInputChange={onInputChange}
          onSend={() => void handleSend()}
          onStop={() => void stop()}
          isBusy={isBusy}
          sendDisabled={isHydrating || createSessionMutation.isPending}
          sendPending={createSessionMutation.isPending}
          placeholder={m.chat_placeholder()}
          webSearchEnabled={webSearchEnabled}
          onToggleWebSearch={toggleWebSearch}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={changeReasoningEffort}
        />
      </div>
    </div>
  );
}

function SignInPrompt({
  onSignIn,
  onClose,
}: {
  onSignIn: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="relative flex h-full flex-col justify-center gap-3 px-5 py-8">
      {onClose && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={m.chat_close()}
          className="absolute top-3 right-3"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
      <MessageSquareQuote className="h-5 w-5 text-[var(--academic-brown)]" />
      <h2 className="font-serif text-base font-semibold text-[var(--ink)]">
        {m.chat_signin_title()}
      </h2>
      <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
        {m.chat_signin_desc()}
      </p>
      <div>
        <Button size="sm" onClick={onSignIn}>
          {m.auth_sign_in_github()}
        </Button>
      </div>
    </div>
  );
}

/**
 * 聊天栏左缘的拖宽把手（仅 xl 常驻形态；本期只做指针拖拽，不做键盘）。
 * 宽度是受控的：页面持有状态并写成 CSS 变量驱动 grid 列宽，这里只上报新值。
 * 用 pointer capture：指针拖出把手区域后 move/up 仍会派发到这里。
 */
function PanelResizeHandle({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}) {
  // 拖拽起点：pointerdown 记一次，move 全程相对它算，不累计增量避免误差漂移
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    width: number;
  } | null>(null);

  // 组件若在拖拽中途被卸载（视口切换等），别把「禁止选择文本」留在 body 上
  useEffect(
    () => () => {
      document.body.style.userSelect = "";
    },
    [],
  );

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.userSelect = "";
  };

  return (
    // 纯装饰性交互（aria-hidden）：本期明确只做鼠标/触控拖拽、不做键盘，挂
    // separator 角色反而要求可聚焦 + aria-valuenow 一整套却给不了键盘操作
    <div
      aria-hidden="true"
      className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none select-none bg-transparent transition-colors hover:bg-[var(--academic-brown)]/35 active:bg-[var(--academic-brown)]/50"
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        dragRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        // 拖拽中禁选：不然指针扫过正文会拉出一路选区
        document.body.style.userSelect = "none";
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const start = dragRef.current;
        if (!start || start.pointerId !== event.pointerId) return;
        // 面板在页面右侧：往左拖是加宽
        onWidthChange(
          clampChatPanelWidth(start.width + start.x - event.clientX),
        );
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

export interface PaperChatProps {
  paperShortId: string;
  isSignedIn: boolean;
  onSignIn: () => void;
  /** xl 三栏形态的当前栏宽（px）。仅用作拖拽起点，布局由页面的 CSS 变量驱动 */
  panelWidth?: number;
  /** 提供了才渲染拖宽把手；新值已 clamp 到 CHAT_PANEL_WIDTH 范围 */
  onPanelWidthChange?: (width: number) => void;
}

/**
 * 论文页的提问面板。xl+ 作为第三栏常驻（sticky），以下折叠成右下角悬浮按钮 +
 * 底部浮层，两种形态共用同一份对话组件。
 */
export function PaperChat({
  paperShortId,
  isSignedIn,
  onSignIn,
  panelWidth,
  onPanelWidthChange,
}: PaperChatProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  // 两种形态共用一份对话组件，但绝不能同时挂载：那会跑出两个 useChat 实例，
  // 各自持有半截历史。SSR/首帧按宽屏渲染（aside 自带 hidden xl:block 兜底）。
  const [isWideViewport, setIsWideViewport] = useState(true);
  // 草稿留在这一层：抽屉关闭会卸载整个对话子树，state 放里面等于清空输入框
  const [input, setInput] = useState("");
  const sheetDescriptionId = useId();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // 用 rem 而非 px：Tailwind 的 xl 是 80rem，写死 1280px 会在用户调大浏览器
    // 默认字号时和断点错位，出现「两栏布局但面板不见了」。
    const mediaQuery = window.matchMedia("(min-width: 80rem)");
    const sync = (matches: boolean) => {
      setIsWideViewport(matches);
      if (matches) setIsSheetOpen(false);
    };
    sync(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  const handleSheetOpenChange = (open: boolean) => {
    setIsSheetOpen(open);
    // 抽屉关着的这段时间里，被中断的流仍可能由服务端的 waitUntil 落库；
    // 重新打开时先把 chat 相关缓存标脏，别拿旧快照当历史。
    if (!open) return;
    void queryClient.invalidateQueries({
      queryKey: trpc.chat.getMessages.pathKey(),
    });
    void queryClient.invalidateQueries({
      queryKey: trpc.chat.listSessions.pathKey(),
    });
  };

  if (isWideViewport) {
    return (
      <aside
        className={cn(
          "paper-card relative hidden overflow-hidden p-0 xl:sticky xl:top-24 xl:block",
          isSignedIn && "h-[calc(100dvh-8rem)]",
        )}
      >
        {onPanelWidthChange && (
          <PanelResizeHandle
            width={panelWidth ?? CHAT_PANEL_WIDTH.default}
            onWidthChange={onPanelWidthChange}
          />
        )}
        {isSignedIn ? (
          <PaperChatConversation
            paperShortId={paperShortId}
            input={input}
            onInputChange={setInput}
          />
        ) : (
          <SignInPrompt onSignIn={onSignIn} />
        )}
      </aside>
    );
  }

  const closeSheet = () => setIsSheetOpen(false);

  // display:contents —— 面板挂在论文页的 grid 里，窄屏形态只剩一个 fixed 触发
  // 按钮，若留下一个真实 grid item 会白白多出一行 gap。
  return (
    <div className="contents">
      <Dialog open={isSheetOpen} onOpenChange={handleSheetOpenChange}>
        {/* FAB 必须 portal 到 body：论文页的 .stagger-in > * 动画以 fill-mode:both
            把 transform: translateY(0) 永久留在网格容器上，而 transform 祖先会成
            为 fixed 元素的包含块——不 portal 的话按钮会「固定」在内容末尾而不是
            视窗右下角。此分支只在客户端渲染（SSR 走宽屏形态），document 必然存在。
            z-40 刻意低于 Dialog overlay 的 z-50：抽屉打开时 FAB 被遮罩盖住，
            不会出现两个入口叠着。bottom 加 safe-area 让 iOS 底部手势条让开。 */}
        {createPortal(
          <DialogTrigger asChild>
            <Button
              size="icon-lg"
              className="fixed right-5 bottom-[calc(1.25rem_+_env(safe-area-inset-bottom))] z-40 rounded-full shadow-[0_10px_30px_rgba(87,61,38,0.28)] xl:hidden"
              aria-label={m.chat_open()}
            >
              <MessageSquareQuote className="h-5 w-5" />
            </Button>
          </DialogTrigger>,
          document.body,
        )}
        <DialogContent
          showCloseButton={false}
          className={cn(
            "top-auto bottom-0 left-1/2 flex w-full max-w-none translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl rounded-b-none border-[var(--line)] bg-[var(--parchment)] p-0 sm:bottom-6 sm:max-w-lg sm:rounded-b-2xl",
            isSignedIn && "h-[86dvh]",
          )}
          aria-describedby={sheetDescriptionId}
        >
          <DialogTitle className="sr-only">{m.chat_title()}</DialogTitle>
          <DialogDescription id={sheetDescriptionId} className="sr-only">
            {m.chat_empty_hint()}
          </DialogDescription>
          <div className="min-h-0 flex-1">
            {isSignedIn ? (
              <PaperChatConversation
                paperShortId={paperShortId}
                onClose={closeSheet}
                input={input}
                onInputChange={setInput}
              />
            ) : (
              <SignInPrompt onSignIn={onSignIn} onClose={closeSheet} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
