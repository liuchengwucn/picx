import { useChat } from "@ai-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  BookOpen,
  Check,
  ChevronDown,
  Loader2,
  MessageSquareQuote,
  Plus,
  SendHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { useTRPC } from "#/integrations/trpc/react";
import {
  CHAT_CLIENT_LIMITS,
  CHAT_ERROR_CODES,
  type ChatErrorCode,
} from "#/lib/chat-errors";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/** 与服务端 CHAT_LIMITS.maxInputChars 同源（/api/chat 超出直接 413） */
const MAX_INPUT_CHARS = CHAT_CLIENT_LIMITS.maxInputChars;
/** 只在接近上限时才露出计数器，平时不干扰书写 */
const COUNTER_VISIBLE_FROM = Math.floor(MAX_INPUT_CHARS * 0.9);
/** 只有贴近底部时才自动跟随流式输出，用户上滚回看时不把他拽回去 */
const STICK_TO_BOTTOM_PX = 80;

/**
 * react-markdown 生成的 DOM 没有 class 可挂，只能靠后代选择器排版。
 *
 * 这里没用站内常见的 `prose`（typography 插件是装了的）：prose 的字号/行距/垂直
 * 节奏是按正文栏宽调的，塞进 360px 的侧栏会显得又大又松，而且它自带 max-width
 * 与一堆需要 `max-w-none`、`prose-sm` 层层压回去的默认值。侧栏只需要一套更紧的
 * 排版，直接写清单比对抗 prose 更短也更可控。
 */
const MARKDOWN_CLASS = [
  "text-sm leading-relaxed break-words text-[var(--ink)]",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_p]:my-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-1",
  "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:font-serif [&_h1]:text-[15px] [&_h1]:font-semibold",
  "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:font-serif [&_h2]:text-[15px] [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-serif [&_h3]:font-semibold",
  "[&_a]:text-[var(--academic-brown)] [&_a]:underline",
  "[&_strong]:font-semibold",
  "[&_code]:rounded [&_code]:bg-[var(--parchment-warm)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-[var(--parchment-warm)] [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--line)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--ink-soft)]",
  "[&_table]:my-2 [&_table]:w-full [&_table]:text-xs",
  "[&_th]:border-b [&_th]:border-[var(--line)] [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border-b [&_td]:border-[var(--line)] [&_td]:py-1",
].join(" ");

interface SourceLink {
  url: string;
  title?: string;
}

/**
 * /api/chat 的错误以稳定 code 下发：HTTP 非 2xx 时 body 是 `{"error": code}`，
 * transport 把整个 body 文本塞进 Error.message；流内错误则是裸 code
 * （`stream_failed`）。两条路径都在这里归一成用户文案。
 */
function resolveChatErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : "";
  let code = raw;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string") code = parsed.error;
    } catch {
      // 非 JSON body（网关错误页等）→ 落到通用文案
    }
  }
  // 用 find 而不是 includes + as：只有真正被收窄成 ChatErrorCode 的变量，
  // 才能让下面 default 分支里的 never 赋值起到穷尽检查作用
  const known: ChatErrorCode | undefined = CHAT_ERROR_CODES.find(
    (candidate) => candidate === code,
  );
  if (!known) return m.chat_error_generic();
  switch (known) {
    case "unauthorized":
      return m.chat_error_unauthorized();
    case "message_too_long":
      return m.chat_error_message_too_long();
    case "session_full":
      return m.chat_error_session_full();
    case "rate_limited_minute":
      return m.chat_error_rate_limited_minute();
    case "rate_limited_day":
      return m.chat_error_rate_limited_day();
    // 这些码用户无从自处（会话被删/无权/请求畸形/流中断），一律通用文案
    case "bad_request":
    case "session_not_found":
    case "forbidden":
    case "stream_failed":
      return m.chat_error_generic();
    default: {
      // 码表新增码却忘了在这里映射时，此处编译期报错
      const exhaustive: never = known;
      void exhaustive;
      return m.chat_error_generic();
    }
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function collectSources(message: UIMessage): SourceLink[] {
  const seen = new Set<string>();
  const sources: SourceLink[] = [];
  for (const part of message.parts) {
    if (part.type !== "source-url") continue;
    if (seen.has(part.url)) continue;
    seen.add(part.url);
    sources.push({ url: part.url, title: part.title });
  }
  return sources;
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

/** 助手回复里的工具调用：只以一行状态出现，不展开原始输入输出 */
function ToolTrace({ done }: { done: boolean }) {
  return (
    <p className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-[var(--ink-soft)] uppercase">
      {done ? (
        <BookOpen className="h-3.5 w-3.5" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      )}
      {done ? m.chat_read_paper_done() : m.chat_reading_paper()}
    </p>
  );
}

function SourceFootnotes({ sources }: { sources: SourceLink[] }) {
  return (
    <div className="mt-3 border-t border-dashed border-[var(--line)] pt-2">
      <p className="text-[10px] tracking-[0.18em] text-[var(--ink-soft)] uppercase">
        {m.chat_sources()}
      </p>
      <ol className="mt-1.5 space-y-1">
        {sources.map((source, index) => (
          <li key={source.url} className="flex gap-2 text-xs">
            <span className="tabular-nums text-[var(--ink-soft)]">
              {index + 1}.
            </span>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate text-[var(--academic-brown)] hover:underline"
            >
              {source.title || hostnameOf(source.url)}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 模型生成的链接一律新开标签页，且不给外链传递权重 */
const MARKDOWN_COMPONENTS = {
  a: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

/**
 * memo：流式期间只有最后一条消息在变，前面几十条不该跟着 re-render
 * （每条都要重跑 react-markdown 的解析）。
 */
const ChatMessage = memo(function ChatMessage({
  message,
}: {
  message: UIMessage;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg rounded-tr-sm border border-[var(--line)] bg-[var(--parchment-warm)] px-3 py-2 text-sm whitespace-pre-wrap text-[var(--ink)]">
          {messageText(message)}
        </p>
      </div>
    );
  }

  const sources = collectSources(message);
  return (
    <div className="border-l-2 border-[var(--academic-brown)]/35 pl-3">
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <div
              // part 本身没有 id，但同一条消息内的 part 顺序是稳定追加的
              key={`${message.id}-text-${index}`}
              className={MARKDOWN_CLASS}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS}
              >
                {part.text}
              </ReactMarkdown>
            </div>
          );
        }
        if (isToolUIPart(part) && part.type === "tool-readPaper") {
          return (
            <div
              key={part.toolCallId}
              className={index === 0 ? "pb-1" : "py-1"}
            >
              <ToolTrace
                done={
                  part.state === "output-available" ||
                  part.state === "output-error"
                }
              />
            </div>
          );
        }
        return null;
      })}
      {sources.length > 0 && <SourceFootnotes sources={sources} />}
    </div>
  );
});

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

  const hydratedSessionRef = useRef<string | null>(null);
  const didAutoSelectRef = useRef(false);
  // 流开始那一刻的 sessionId。onFinish 只认它，不认「当前选中」——流式期间用户
  // 可能已经切走，用当前值会去失效一个毫不相干的会话缓存。
  const streamingSessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * 是否跟随最新内容。只由 scroll 事件写入——scroll 事件只在滚动位置真的变化时
   * 触发，所以它读到的是「用户主动滚到哪」；而在 effect 里现算距底距离是分不清
   * 「用户上滚了」和「内容刚变高」的：注水整段历史后 scrollTop 还是 0、距底巨大，
   * 会被误判成用户上滚，结果会话一打开就停在最旧的一条。
   */
  const stickToBottomRef = useRef(true);

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
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        // 服务端只收最后一条消息（历史真源在 D1），且 parts 仅放行 text
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1];
          return {
            body: {
              ...body,
              paperShortId,
              locale: getLocale(),
              message: {
                id: last?.id,
                role: "user",
                parts: (last?.parts ?? [])
                  .filter((part) => part.type === "text")
                  .map((part) => ({ type: "text" as const, text: part.text })),
              },
            },
          };
        },
      }),
    [paperShortId],
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
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !lastMessage) return;
    if (!stickToBottomRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [lastMessage]);

  const handleTranscriptScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    stickToBottomRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight <=
      STICK_TO_BOTTOM_PX;
  };

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
    stickToBottomRef.current = true;
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
        onScroll={handleTranscriptScroll}
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
            <ChatMessage key={message.id} message={message} />
          ))
        )}
        {showThinking && (
          <p className="flex items-center gap-2 border-l-2 border-[var(--academic-brown)]/35 pl-3 text-[11px] tracking-[0.14em] text-[var(--ink-soft)] uppercase">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {m.chat_thinking()}
          </p>
        )}
      </div>

      {/* 输入区。textarea 自身无边框（静息态就该像纸面而不是控件），焦点指示放在
          内层这个有圆角、且被 p-2 从容器边缘让开的 wrapper 上：外层贴边，而
          paper-card / DialogContent 都是 overflow-hidden，挂在那儿的 ring 会被
          裁得只剩上边一条。这里用「描边显形 + 底色微亮」而不是 ring，既不会被裁，
          也保住了静息态的无边框观感。 */}
      <div className="border-t border-[var(--line)] p-2">
        <div className="flex items-end gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors focus-within:border-[var(--academic-brown)]/60 focus-within:bg-[var(--parchment-warm)]/60">
          <textarea
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              // 中文/日文输入法选字时的 Enter 属于组合过程，不能当成发送
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
              void handleSend();
            }}
            maxLength={MAX_INPUT_CHARS}
            rows={2}
            placeholder={m.chat_placeholder()}
            aria-label={m.chat_placeholder()}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent text-sm leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]"
          />
          {isBusy ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void stop()}
              aria-label={m.chat_stop()}
              title={m.chat_stop()}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={() => void handleSend()}
              disabled={
                !input.trim() || isHydrating || createSessionMutation.isPending
              }
              aria-label={m.chat_send()}
              title={m.chat_send()}
            >
              {createSessionMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
        {input.length >= COUNTER_VISIBLE_FROM && (
          <p className="mt-1 pr-2 text-right text-[11px] tabular-nums text-[var(--ink-soft)]">
            {input.length} / {MAX_INPUT_CHARS}
          </p>
        )}
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

export interface PaperChatProps {
  paperShortId: string;
  isSignedIn: boolean;
  onSignIn: () => void;
}

/**
 * 论文页的提问面板。xl+ 作为第三栏常驻（sticky），以下折叠成右下角悬浮按钮 +
 * 底部浮层，两种形态共用同一份对话组件。
 */
export function PaperChat({
  paperShortId,
  isSignedIn,
  onSignIn,
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
          "paper-card hidden overflow-hidden p-0 xl:sticky xl:top-24 xl:block",
          isSignedIn && "h-[calc(100dvh-8rem)]",
        )}
      >
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
        <DialogTrigger asChild>
          <Button
            size="icon-lg"
            className="fixed right-5 bottom-5 z-40 rounded-full shadow-[0_10px_30px_rgba(87,61,38,0.28)] xl:hidden"
            aria-label={m.chat_open()}
          >
            <MessageSquareQuote className="h-5 w-5" />
          </Button>
        </DialogTrigger>
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
