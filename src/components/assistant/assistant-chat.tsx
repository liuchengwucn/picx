import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  BookOpen,
  Brain,
  Globe,
  Library,
  Loader2,
  Newspaper,
  SendHorizontal,
  Sparkles,
  UserPen,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChatMessage,
  resolveChatErrorMessage,
  type ToolDisplayMap,
} from "#/components/chat/chat-message";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useTRPC } from "#/integrations/trpc/react";
// 仅类型导入：chat.ts 是服务端模块，值导入会被打进客户端包
import type { ChatReasoningEffort } from "#/lib/chat";
import { CHAT_CLIENT_LIMITS } from "#/lib/chat-errors";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/** 与服务端 AGENT_LIMITS.maxInputChars 同源（两者都取自 CHAT_LIMITS） */
const MAX_INPUT_CHARS = CHAT_CLIENT_LIMITS.maxInputChars;
/** 只在接近上限时才露出计数器，平时不干扰书写 */
const COUNTER_VISIBLE_FROM = Math.floor(MAX_INPUT_CHARS * 0.9);
/** 只有贴近底部时才自动跟随流式输出，用户上滚回看时不把他拽回去 */
const STICK_TO_BOTTOM_PX = 80;

/** 输入区微开关的视觉语言，与论文页聊天保持同一套（开=按下的实体按钮） */
const TOGGLE_BASE_CLASS =
  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] tracking-[0.14em] uppercase transition-colors focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none";
const TOGGLE_ON_CLASS =
  "border-[var(--academic-brown)]/40 bg-[var(--academic-brown)]/10 text-[var(--academic-brown)] shadow-[inset_0_1px_3px_rgba(87,61,38,0.22)] hover:bg-[var(--academic-brown)]/15";
const TOGGLE_OFF_CLASS =
  "border-transparent text-[var(--ink-soft)]/50 hover:border-[var(--line)] hover:text-[var(--ink-soft)]";

/** 助手的设置独立于论文页聊天（两处默认值与使用场景不同），键名分开 */
const WEB_SEARCH_STORAGE_KEY = "picx.assistant.webSearch";
const REASONING_STORAGE_KEY = "picx.assistant.reasoningEffort";

const REASONING_EFFORTS: readonly ChatReasoningEffort[] = [
  "off",
  "low",
  "medium",
  "high",
];

/** 默认开：搜索是 agentic 的（模型自主决定调不调），常开的成本可控 */
function loadStoredWebSearch(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WEB_SEARCH_STORAGE_KEY) !== "0";
  } catch {
    // Chrome「阻止所有 cookie」下访问 localStorage 本身就抛 SecurityError
    return true;
  }
}

/** 默认关：多数提问不值得为思考 token 买单 */
function loadStoredReasoningEffort(): ChatReasoningEffort {
  if (typeof window === "undefined") return "off";
  try {
    const raw = window.localStorage.getItem(REASONING_STORAGE_KEY);
    const known = REASONING_EFFORTS.find((effort) => effort === raw);
    return known ?? "off";
  } catch {
    return "off";
  }
}

function persistSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 隐私模式等场景写不进就算了，设置退化为仅当前页面生效
  }
}

function reasoningEffortLabel(effort: ChatReasoningEffort): string {
  switch (effort) {
    case "off":
      return m.chat_reasoning_off();
    case "low":
      return m.chat_reasoning_low();
    case "medium":
      return m.chat_reasoning_medium();
    case "high":
      return m.chat_reasoning_high();
  }
}

/** agent 的 8 个工具在活动区块里的展示（键名与 buildAgentTools 一一对应） */
const ASSISTANT_TOOLS: ToolDisplayMap = {
  searchMyPapers: {
    icon: Library,
    running: m.assistant_tool_search_library,
    done: m.assistant_tool_search_library_done,
  },
  listMyPapers: {
    icon: Library,
    running: m.assistant_tool_search_library,
    done: m.assistant_tool_search_library_done,
  },
  readPaper: {
    icon: BookOpen,
    running: m.chat_reading_paper,
    done: m.chat_read_paper_done,
  },
  searchArxiv: {
    icon: Sparkles,
    running: m.assistant_tool_search_arxiv,
    done: m.assistant_tool_search_arxiv_done,
  },
  listDailyPapers: {
    icon: Sparkles,
    running: m.assistant_tool_daily_papers,
    done: m.assistant_tool_daily_papers_done,
  },
  searchNews: {
    icon: Newspaper,
    running: m.assistant_tool_search_news,
    done: m.assistant_tool_search_news_done,
  },
  updateProfile: {
    icon: UserPen,
    running: m.assistant_tool_update_profile,
    done: m.assistant_tool_update_profile_done,
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

export interface AssistantChatProps {
  conversationId: string;
  /** 挂载时一次性注入的历史（useChat 只在建 Chat 时读一次），父层负责 key 换会话 */
  initialMessages: UIMessage[];
  /** 草稿提在父层：换会话会按 key 卸载整棵子树，state 留这儿会把没发出去的话丢掉 */
  input: string;
  onInputChange: (value: string) => void;
  /** 本会话第一条用户消息发出后回调：服务端此时已写好标题，父层可刷新会话列表 */
  onFirstMessage?: () => void;
}

/**
 * 助手对话区：全页主区形态（消息列居中、输入区吸底），与论文页的侧栏聊天共用
 * ChatMessage 与同一套输入区语汇，但会话生命周期由 /assistant 页面持有。
 */
export function AssistantChat({
  conversationId,
  initialMessages,
  input,
  onInputChange,
  onFirstMessage,
}: AssistantChatProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // 聊天设置（lazy init 只在挂载时读一次 localStorage）
  const [webSearchEnabled, setWebSearchEnabled] =
    useState<boolean>(loadStoredWebSearch);
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>(
    loadStoredReasoningEffort,
  );
  // transport 是 useMemo 一次性建好的，prepareSendMessagesRequest 里必须经 ref
  // 拿最新设置；每次渲染同步一份是幂等写
  const chatSettingsRef = useRef({
    webSearch: webSearchEnabled,
    reasoningEffort,
  });
  chatSettingsRef.current = { webSearch: webSearchEnabled, reasoningEffort };

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /**
   * 是否跟随最新内容。只由 scroll 事件写入——在 effect 里现算距底距离分不清
   * 「用户上滚了」和「内容刚变高」（详见 paper-chat.tsx 同名 ref 的注释）。
   */
  const stickToBottomRef = useRef(true);
  /** 本会话的首条用户消息已发出、还没通知父层 */
  const pendingFirstMessageRef = useRef(false);
  // 回调可能是父层的内联箭头函数（每次渲染换身份），存 ref 避免 effect 反复触发
  const onFirstMessageRef = useRef(onFirstMessage);
  onFirstMessageRef.current = onFirstMessage;

  const toggleWebSearch = () => {
    const next = !webSearchEnabled;
    setWebSearchEnabled(next);
    persistSetting(WEB_SEARCH_STORAGE_KEY, next ? "1" : "0");
  };

  const changeReasoningEffort = (value: string) => {
    const next = REASONING_EFFORTS.find((effort) => effort === value) ?? "off";
    setReasoningEffort(next);
    persistSetting(REASONING_STORAGE_KEY, next);
  };

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/agent",
        // 服务端只收最后一条消息（历史真源在 D1），且 parts 仅放行 text
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages[messages.length - 1];
          return {
            body: {
              ...body,
              conversationId,
              locale: getLocale(),
              webSearch: chatSettingsRef.current.webSearch,
              reasoningEffort: chatSettingsRef.current.reasoningEffort,
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
    [conversationId],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: `assistant:${conversationId}`,
    messages: initialMessages,
    transport,
    // 流式 chunk 可以来得比一帧还密；50ms 合批，省掉大量无意义的整表重渲染
    throttle: 50,
    onError: (error) => {
      toast.error(resolveChatErrorMessage(error));
    },
    onFinish: () => {
      // 历史真源在 D1：把本会话的缓存标脏，切走再切回来时拿到的才是完整记录。
      // refetchType none —— 只标脏不立刻重取：此刻正确的历史就在 useChat 手里，
      // 拉回来也没人消费；而一次失败的后台重取会把活着的聊天区判成错误态。
      void queryClient.invalidateQueries({
        queryKey: trpc.assistant.getMessages.queryKey({ conversationId }),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.assistant.listConversations.queryKey(),
      });
    },
  });

  const isBusy = status === "submitted" || status === "streaming";

  // 卸载（换会话/离开页面）时主动断流，别让一个没人看的请求继续占着连接。
  // 回复不会因此丢：服务端 waitUntil(consumeStream) 会把完整回答落进 D1，
  // 下次进这个会话拉到的历史是全的。
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(
    () => () => {
      void stopRef.current();
    },
    [],
  );

  /**
   * 首条消息一开始流式回传，就说明服务端已经把标题（取自首条消息）写进库了，
   * 此时通知父层刷新列表是安全的——不必等整段回答写完。
   */
  useEffect(() => {
    if (status !== "streaming") return;
    if (!pendingFirstMessageRef.current) return;
    pendingFirstMessageRef.current = false;
    onFirstMessageRef.current?.();
  }, [status]);

  // 流式每来一个 chunk，最后一条消息都是新对象 → 依赖它即可持续贴底
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

  const handleSend = () => {
    const text = input.trim();
    if (!text || isBusy) return;
    if (messages.length === 0) pendingFirstMessageRef.current = true;
    // 主动发言就是「我要看新内容」：哪怕刚才上滚在读前文，也弹回底部
    stickToBottomRef.current = true;
    onInputChange("");
    void sendMessage({ text });
  };

  const showThinking = status === "submitted";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 对话区。role=log + polite：新回答播报给读屏，但不打断当前朗读 */}
      <div
        ref={scrollRef}
        onScroll={handleTranscriptScroll}
        role="log"
        aria-live="polite"
        aria-label={m.assistant_page_title()}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {messages.length === 0 ? (
          // 开场白：整页居中，标题用衬线体——空会话是这页唯一的「封面」时刻
          <div className="flex h-full items-center justify-center px-6 py-10">
            <div className="max-w-[46ch] text-center">
              <span
                aria-hidden="true"
                className="mx-auto block h-px w-10 bg-[var(--academic-brown)]/45"
              />
              <h2 className="mt-5 font-serif text-2xl font-semibold text-balance text-[var(--ink)] sm:text-[1.75rem]">
                {m.assistant_empty_title()}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
                {m.assistant_empty_hint()}
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={isBusy && message.id === lastMessage?.id}
                toolDisplays={ASSISTANT_TOOLS}
              />
            ))}
            {showThinking && (
              <p className="flex items-center gap-2 border-l-2 border-[var(--academic-brown)]/35 pl-3 text-[11px] tracking-[0.14em] text-[var(--ink-soft)] uppercase">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {m.chat_thinking()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 输入区。textarea 静息态无边框（像纸面而不是控件），焦点指示做在包裹层的
          描边与底色上（理由同 paper-chat.tsx 的输入区注释） */}
      <div className="border-t border-[var(--line)] px-4 pt-2 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors focus-within:border-[var(--academic-brown)]/60 focus-within:bg-[var(--parchment-warm)]/60">
            <textarea
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                // 中文/日文输入法选字时的 Enter 属于组合过程，不能当成发送
                if (event.nativeEvent.isComposing) return;
                event.preventDefault();
                handleSend();
              }}
              maxLength={MAX_INPUT_CHARS}
              rows={2}
              placeholder={m.assistant_input_placeholder()}
              aria-label={m.assistant_input_placeholder()}
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
                onClick={handleSend}
                disabled={!input.trim()}
                aria-label={m.chat_send()}
                title={m.chat_send()}
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            )}
          </div>
          {/* 设置行：与活动区块同一套 11px 大写微标签语汇 */}
          <div className="mt-1 flex items-center gap-1.5 px-2 pb-0.5">
            <button
              type="button"
              onClick={toggleWebSearch}
              aria-pressed={webSearchEnabled}
              title={m.chat_web_search_hint()}
              className={cn(
                TOGGLE_BASE_CLASS,
                webSearchEnabled ? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS,
              )}
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
              {m.chat_web_search()}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={m.chat_reasoning_label()}
                  title={m.chat_reasoning_label()}
                  className={cn(
                    TOGGLE_BASE_CLASS,
                    // 非「关」档就是激活态，且按钮上直接写当前档位名
                    reasoningEffort !== "off"
                      ? TOGGLE_ON_CLASS
                      : TOGGLE_OFF_CLASS,
                  )}
                >
                  <Brain className="h-3.5 w-3.5 shrink-0" />
                  {reasoningEffortLabel(reasoningEffort)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                <DropdownMenuRadioGroup
                  value={reasoningEffort}
                  onValueChange={changeReasoningEffort}
                >
                  {REASONING_EFFORTS.map((effort) => (
                    <DropdownMenuRadioItem key={effort} value={effort}>
                      {reasoningEffortLabel(effort)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {input.length >= COUNTER_VISIBLE_FROM && (
              <p className="ml-auto text-[11px] tabular-nums text-[var(--ink-soft)]">
                {input.length} / {MAX_INPUT_CHARS}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
