import { useChat } from "@ai-sdk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { BookOpen, Library, Newspaper, Sparkles, UserPen } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AssistantEmptyState } from "#/components/assistant/assistant-empty-state";
import {
  ChatInputArea,
  type SlashCommandItem,
} from "#/components/chat/chat-input";
import {
  ChatMessage,
  ChatThinking,
  hasVisibleParts,
  resolveChatErrorMessage,
  type ToolDisplayMap,
  WEB_SEARCH_TOOL_DISPLAY,
} from "#/components/chat/chat-message";
import { createTextOnlyChatTransport } from "#/components/chat/chat-transport";
import {
  DISCOVERY_TOOL_DISPLAYS,
  renderDiscoveryToolOutput,
} from "#/components/chat/discovery-ui";
import { useChatSettings } from "#/components/chat/use-chat-settings";
import { useStickToBottom } from "#/components/chat/use-stick-to-bottom";
import { useTRPC } from "#/integrations/trpc/react";
import { buildSkillDirectiveText } from "#/lib/skills";
import { m } from "#/paraglide/messages";

/** agent 的 10 个工具在活动区块里的展示（键名与 buildAgentTools 一一对应） */
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
  ...DISCOVERY_TOOL_DISPLAYS,
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
  readSkill: {
    icon: Sparkles,
    running: m.assistant_tool_read_skill,
    done: m.assistant_tool_read_skill_done,
  },
  ...WEB_SEARCH_TOOL_DISPLAY,
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

  // slash 选择器的候选（只列启用的 skill）与当前选中项。会话切换时父层按 key
  // 重挂本组件，selectedSkill 随之清零，正合预期
  const { data: skillRows } = useQuery(trpc.skills.list.queryOptions());
  const slashCommands = useMemo(
    () =>
      (skillRows ?? [])
        .filter((row) => row.enabled)
        .map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
        })),
    [skillRows],
  );
  const [selectedSkill, setSelectedSkill] = useState<SlashCommandItem | null>(
    null,
  );
  // 芯片点完要把光标送回输入框，否则用户还得再点一次才能打字
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

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
        reconnectQuery: () => ({ conversationId }),
      }),
    [conversationId, settingsRef],
  );

  // 历史末尾停在 user 消息 = 有一轮生成没送达（正在 DO 里跑，或已丢）。
  // 只在这种指纹下探测：204 静默返回，全量探测则是每次进会话白打一个请求。
  // 挂载时冻结成一次性判定：SDK 里 resume 不是 mount-only（effect 依赖它，每次
  // 渲染重求值），若 initialMessages 随 refetch 换身份，false→true 可能在 POST
  // 流进行中翻转、resumeStream 与其互踩。探测意图本来就只看进入会话那一刻。
  const [shouldResume] = useState(
    () => initialMessages[initialMessages.length - 1]?.role === "user",
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: `assistant:${conversationId}`,
    messages: initialMessages,
    transport,
    resume: shouldResume,
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
  // 回复不会因此丢：生成托管在 ChatRunner DO 里，断流不影响它跑完并落库；
  // 回来时 resume 还能接回直播。
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
    if (isBusy) return;
    // 选中 skill 时无参数也可发（指令本身就是完整消息）
    if (!selectedSkill && !text) return;
    if (messages.length === 0) pendingFirstMessageRef.current = true;
    // 主动发言就是「我要看新内容」：哪怕刚才上滚在读前文，也弹回底部
    resetStick();
    onInputChange("");
    // slash 通路发短指令纯文本，agent 端由系统提示强制走 readSkill 读正文
    const outgoing = selectedSkill
      ? buildSkillDirectiveText(selectedSkill.name, text)
      : text;
    setSelectedSkill(null);
    void sendMessage({ text: outgoing });
  };

  // "streaming" 只说明流的 start chunk 到了，离模型首字还差几秒：最后一条助手
  // 消息真渲染出内容之前继续挂着指示条，别让屏幕上只剩一条空消息
  const showThinking =
    status === "submitted" ||
    (status === "streaming" &&
      (lastMessage?.role !== "assistant" || !hasVisibleParts(lastMessage)));

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
          <AssistantEmptyState
            skills={slashCommands}
            onPickSkill={(item) => {
              setSelectedSkill(item);
              inputRef.current?.focus();
            }}
            onPickSample={(text) => {
              onInputChange(text);
              inputRef.current?.focus();
            }}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={isBusy && message.id === lastMessage?.id}
                toolDisplays={ASSISTANT_TOOLS}
                renderToolOutput={renderDiscoveryToolOutput}
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
            slashCommands={slashCommands}
            selectedSlashCommand={selectedSkill}
            onSelectSlashCommand={setSelectedSkill}
            inputRef={inputRef}
          />
        </div>
      </div>
    </div>
  );
}
