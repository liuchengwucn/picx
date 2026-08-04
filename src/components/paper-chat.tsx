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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/** 与服务端 CHAT_LIMITS.maxInputChars 对齐（/api/chat 超出直接 413） */
const MAX_INPUT_CHARS = 4000;
/** 只在接近上限时才露出计数器，平时不干扰书写 */
const COUNTER_VISIBLE_FROM = 3600;

/**
 * react-markdown 生成的 DOM 没有 class 可挂，项目也没装 typography 插件
 * （preflight 会把列表/标题的默认样式清掉），所以排版全靠这里的后代选择器。
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
  switch (code) {
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
    default:
      return m.chat_error_generic();
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

function ChatMessage({ message }: { message: UIMessage }) {
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
}

interface ConversationProps {
  paperShortId: string;
  /** 浮层形态下由面板自己渲染关闭按钮，避免和头部控件叠在一起 */
  onClose?: () => void;
}

function PaperChatConversation({ paperShortId, onClose }: ConversationProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  // useChat 只在 id 变化时重建 Chat。id 里刻意不含 sessionId：首次发言会隐式
  // 建会话，若 id 跟着变，正在流式的回答会被整条丢掉。
  const [chatEpoch, setChatEpoch] = useState(0);
  const [input, setInput] = useState("");
  const [isSessionListOpen, setIsSessionListOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const hydratedSessionRef = useRef<string | null>(null);
  const didAutoSelectRef = useRef(false);
  const activeSessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    id: `paper-chat:${paperShortId}:${chatEpoch}`,
    transport,
    onError: (error) => {
      toast.error(resolveChatErrorMessage(error));
    },
    onFinish: () => {
      invalidateSessions();
      const sessionId = activeSessionIdRef.current;
      if (sessionId) {
        void queryClient.invalidateQueries({
          queryKey: trpc.chat.getMessages.queryKey({ sessionId }),
        });
      }
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
    activeSessionIdRef.current = latest.id;
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

  // 流式每来一个 chunk，最后一条消息都是新对象 → 依赖它即可持续贴底
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !lastMessage) return;
    node.scrollTop = node.scrollHeight;
  }, [lastMessage]);

  const openSession = (sessionId: string | null) => {
    if (isBusy) void stop();
    hydratedSessionRef.current = null;
    didAutoSelectRef.current = true;
    activeSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setChatEpoch((epoch) => epoch + 1);
    setIsSessionListOpen(false);
    setPendingDeleteId(null);
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
    // createSession 还在飞时再按一次回车会建出第二个空会话
    if (!text || isBusy || createSessionMutation.isPending) return;

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

    activeSessionIdRef.current = sessionId;
    setInput("");
    void sendMessage({ text }, { body: { sessionId } });
  };

  const activeSession = sessions.find(
    (session) => session.id === selectedSessionId,
  );
  const isHydrating = !!selectedSessionId && messagesQuery.isLoading;
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
          title={m.chat_sessions_label()}
          className="mt-1.5 flex w-full items-center gap-1 text-left text-xs text-[var(--ink-soft)] hover:text-[var(--ink)]"
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
          <ul className="mt-2 max-h-52 space-y-0.5 overflow-y-auto">
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
                      className="min-w-0 flex-1 truncate text-left text-xs text-[var(--ink)]"
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

      {/* 对话区 */}
      <div
        ref={scrollRef}
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

      {/* 输入区 */}
      <div className="border-t border-[var(--line)] px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
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
              disabled={!input.trim() || createSessionMutation.isPending}
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
          <p className="mt-1 text-right text-[11px] tabular-nums text-[var(--ink-soft)]">
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
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  // 两种形态共用一份对话组件，但绝不能同时挂载：那会跑出两个 useChat 实例，
  // 各自持有半截历史。SSR/首帧按宽屏渲染（aside 自带 hidden xl:block 兜底）。
  const [isWideViewport, setIsWideViewport] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const sync = (matches: boolean) => {
      setIsWideViewport(matches);
      if (matches) setIsSheetOpen(false);
    };
    sync(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  if (isWideViewport) {
    return (
      <aside
        className={cn(
          "paper-card hidden overflow-hidden p-0 xl:sticky xl:top-24 xl:block",
          isSignedIn && "h-[calc(100dvh-8rem)]",
        )}
      >
        {isSignedIn ? (
          <PaperChatConversation paperShortId={paperShortId} />
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
      <Dialog open={isSheetOpen} onOpenChange={setIsSheetOpen}>
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
        >
          <DialogTitle className="sr-only">{m.chat_title()}</DialogTitle>
          <div className="min-h-0 flex-1">
            {isSignedIn ? (
              <PaperChatConversation
                paperShortId={paperShortId}
                onClose={closeSheet}
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
