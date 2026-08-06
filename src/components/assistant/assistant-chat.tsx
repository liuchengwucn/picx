import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import type { ToolUIPart, UIMessage } from "ai";
import {
  BookOpen,
  Globe,
  Library,
  Newspaper,
  Sparkles,
  UserPen,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  type DiscoveredPaper,
  PaperResultCards,
} from "#/components/assistant/paper-result-cards";
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
import { useTRPC } from "#/integrations/trpc/react";
import { m } from "#/paraglide/messages";

/** agent 的 9 个工具在活动区块里的展示（键名与 buildAgentTools 一一对应） */
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
  recommendPapers: {
    icon: Sparkles,
    running: m.assistant_tool_recommend_papers,
    done: m.assistant_tool_recommend_papers_done,
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

  const {
    webSearchEnabled,
    reasoningEffort,
    settingsRef,
    toggleWebSearch,
    changeReasoningEffort,
  } = useChatSettings("assistant");

  /** 本会话的首条用户消息已发出、还没通知父层 */
  const pendingFirstMessageRef = useRef(false);
  // 回调可能是父层的内联箭头函数（每次渲染换身份），存 ref 避免 effect 反复触发
  const onFirstMessageRef = useRef(onFirstMessage);
  onFirstMessageRef.current = onFirstMessage;

  const transport = useMemo(
    () =>
      createTextOnlyChatTransport({
        api: "/api/agent",
        settingsRef,
        extraBody: () => ({ conversationId }),
      }),
    [conversationId, settingsRef],
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
      // 这一轮可能调了 updateProfile 工具：标脏档案，下次打开编辑器拿到的是新的
      // （对话框关着时 query enabled:false，这里不会真发请求）
      void queryClient.invalidateQueries({
        queryKey: trpc.assistant.getProfile.queryKey(),
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

  const lastMessage = messages[messages.length - 1];
  const { scrollRef, handleScroll, resetStick } = useStickToBottom(lastMessage);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isBusy) return;
    if (messages.length === 0) pendingFirstMessageRef.current = true;
    // 主动发言就是「我要看新内容」：哪怕刚才上滚在读前文，也弹回底部
    resetStick();
    onInputChange("");
    void sendMessage({ text });
  };

  const showThinking = status === "submitted";

  /**
   * recommendPapers（模型精选推荐）的输出在正文流里就地渲染成可入库的卡片；
   * 搜索工具的结果只有模型自己可见，不再渲染。服务端落库时保留了该工具的
   * output，历史回显也能重建出同样的卡片。
   * useCallback：ChatMessage 是 memo 的，每渲染换一个函数身份会让整列消息重渲染。
   */
  const renderToolOutput = useCallback(
    (part: ToolUIPart, _messageId: string) => {
      if (part.type !== "tool-recommendPapers") return null;
      if (part.state !== "output-available") return null;
      // output 来自 D1 里存着的历史 JSON：早期格式或 {error} 分支都可能到这儿，
      // 形状不对就当没有卡片，别让一条旧消息把整个聊天区渲染崩掉
      const output = part.output as { results?: unknown } | undefined;
      if (!Array.isArray(output?.results) || output.results.length === 0)
        return null;
      return <PaperResultCards results={output.results as DiscoveredPaper[]} />;
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 对话区。role=log + polite：新回答播报给读屏，但不打断当前朗读 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
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
                renderToolOutput={renderToolOutput}
              />
            ))}
            {showThinking && <ChatThinking />}
          </div>
        )}
      </div>

      {/* 输入区。焦点指示的设计理由见 ChatInputArea（chat-input.tsx）的组件注释 */}
      <div className="border-t border-[var(--line)] px-4 pt-2 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <ChatInputArea
            input={input}
            onInputChange={onInputChange}
            onSend={handleSend}
            onStop={() => void stop()}
            isBusy={isBusy}
            placeholder={m.assistant_input_placeholder()}
            webSearchEnabled={webSearchEnabled}
            onToggleWebSearch={toggleWebSearch}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={changeReasoningEffort}
          />
        </div>
      </div>
    </div>
  );
}
