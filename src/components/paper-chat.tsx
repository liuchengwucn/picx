import { useChat } from "@ai-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
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
import { createPortal } from "react-dom";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useTRPC } from "#/integrations/trpc/react";
// 仅类型导入：chat.ts 是服务端模块（drizzle/R2 一大串），值导入会被打进客户端包
import type { ChatReasoningEffort } from "#/lib/chat";
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
 * 输入区工具栏微开关的视觉语言（两个开关必须一致）。
 * 开启态做成「按下的实体按钮」：浅棕底 + 细边框 + 内凹阴影，一眼可辨；
 * 关闭态无底色、明显灰化，hover 时浮出细边框提示可点。
 */
const TOGGLE_BASE_CLASS =
  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] tracking-[0.14em] uppercase transition-colors focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none";
const TOGGLE_ON_CLASS =
  "border-[var(--academic-brown)]/40 bg-[var(--academic-brown)]/10 text-[var(--academic-brown)] shadow-[inset_0_1px_3px_rgba(87,61,38,0.22)] hover:bg-[var(--academic-brown)]/15";
const TOGGLE_OFF_CLASS =
  "border-transparent text-[var(--ink-soft)]/50 hover:border-[var(--line)] hover:text-[var(--ink-soft)]";

/** 聊天设置存 localStorage 跨会话记住（读写都要过 typeof window 守卫，SSR 无 window） */
const WEB_SEARCH_STORAGE_KEY = "picx.chat.webSearch";
const REASONING_STORAGE_KEY = "picx.chat.reasoningEffort";

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
    // 同 loadStoredWebSearch：读不了就用默认值
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
function ToolTrace({
  done,
  kind,
}: {
  done: boolean;
  kind: "readPaper" | "webSearch";
}) {
  const DoneIcon = kind === "readPaper" ? BookOpen : Globe;
  const label =
    kind === "readPaper"
      ? done
        ? m.chat_read_paper_done()
        : m.chat_reading_paper()
      : done
        ? m.chat_searched_web()
        : m.chat_searching_web();
  return (
    <p className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-[var(--ink-soft)] uppercase">
      {done ? (
        <DoneIcon className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      )}
      {label}
    </p>
  );
}

/** 活动区块的行：key 在 ChatMessage 里按原始 part 下标生成（part 顺序稳定追加） */
interface ActivityItem {
  key: string;
  part: UIMessage["parts"][number];
}

/** 流式头部的当前活动：看最后一个活动 part 在干嘛 */
function currentActivityLabel(items: ActivityItem[]): string {
  const last = items[items.length - 1]?.part;
  if (last && isToolUIPart(last) && last.type === "tool-readPaper") {
    return last.state === "output-available" || last.state === "output-error"
      ? m.chat_read_paper_done()
      : m.chat_reading_paper();
  }
  if (last && isToolUIPart(last) && last.type === "tool-web_search") {
    return last.state === "input-streaming"
      ? m.chat_searching_web()
      : m.chat_searched_web();
  }
  return m.chat_thinking();
}

/**
 * 助手消息顶部的统一活动区块：整条消息的所有 reasoning part 与工具状态行按
 * 原始顺序收进同一个折叠区（多轮工具调用不再各自散落一个折叠按钮）。
 * 展开/收起：流式且正文未开始 → 默认展开实时显示进展；正文一出现 → 自动收起。
 * userOpen 为 null 表示用户没手动开合过、跟随上述自动逻辑；手动开合过则以手动
 * 状态为准（自动收起不会跟用户抢）。历史回显（isStreaming=false）默认收起。
 */
function ActivityBlock({
  items,
  isStreaming,
  textStarted,
}: {
  items: ActivityItem[];
  isStreaming: boolean;
  textStarted: boolean;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const live = isStreaming && !textStarted;
  const expanded = userOpen ?? live;
  return (
    <div className="pb-1">
      <button
        type="button"
        onClick={() => setUserOpen(!expanded)}
        aria-expanded={expanded}
        className="flex items-center gap-2 rounded-sm text-[11px] tracking-[0.14em] text-[var(--ink-soft)] uppercase hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
      >
        {live ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform",
              expanded && "rotate-90",
            )}
          />
        )}
        {live ? currentActivityLabel(items) : m.chat_activity_label()}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 border-l border-dashed border-[var(--line)] pl-3">
          {items.map(({ key, part }) => {
            if (part.type === "reasoning") {
              return (
                <div
                  key={key}
                  className="text-xs leading-relaxed whitespace-pre-wrap text-[var(--ink-soft)]"
                >
                  {part.text}
                </div>
              );
            }
            if (isToolUIPart(part) && part.type === "tool-readPaper") {
              return (
                <ToolTrace
                  key={key}
                  kind="readPaper"
                  done={
                    part.state === "output-available" ||
                    part.state === "output-error"
                  }
                />
              );
            }
            if (isToolUIPart(part) && part.type === "tool-web_search") {
              // 搜索在 OpenRouter 服务端执行，流里只有工具调用没有 output part：
              // 参数一到齐（input-available）就当"已搜索"，结果以 source part 到达
              return (
                <ToolTrace
                  key={key}
                  kind="webSearch"
                  done={part.state !== "input-streaming"}
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
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
            {/* shrink-0 + nowrap：body 上有 [overflow-wrap:anywhere]（防长 URL
                溢出），它会把这个 span 的 min-content 压成单字符宽，flex 收缩时
                序号会被逐字折行成「1 / 0 / .」竖排 */}
            <span className="shrink-0 whitespace-nowrap tabular-nums text-[var(--ink-soft)]">
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
  isStreaming,
}: {
  message: UIMessage;
  /** 该消息是否正在流式生成（只有最后一条会是 true），驱动活动区块的自动开合 */
  isStreaming: boolean;
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
  // 思考与工具轨迹统一收进消息顶部的活动区块（保持 parts 原始顺序）。
  // 空 reasoning part（有的模型开思考也可能不给内容）在这里就滤掉，
  // 免得渲染出一个点开只有空白的区块。
  const activityItems: ActivityItem[] = message.parts
    // key 用过滤前的原始下标：part 顺序是稳定追加的，下标不会因后续 part 变动
    .map((part, index) => ({ part, key: `${message.id}-activity-${index}` }))
    .filter(
      ({ part }) =>
        (part.type === "reasoning" &&
          (part.state === "streaming" || part.text.trim().length > 0)) ||
        (isToolUIPart(part) &&
          (part.type === "tool-readPaper" || part.type === "tool-web_search")),
    );
  // 「正文已开始」的判定：存在非空 text part。模型可能在工具轮之间输出中间
  // 文本，那之后的思考也会被收起——可接受，比精确判定简单得多。
  const textStarted = message.parts.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
  return (
    <div className="border-l-2 border-[var(--academic-brown)]/35 pl-3">
      {activityItems.length > 0 && (
        <ActivityBlock
          items={activityItems}
          isStreaming={isStreaming}
          textStarted={textStarted}
        />
      )}
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
        // reasoning / 工具 part 已并入顶部活动区块；未知 part 不渲染也不崩
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

  // 聊天设置（lazy init 只在挂载时读一次 localStorage）
  const [webSearchEnabled, setWebSearchEnabled] =
    useState<boolean>(loadStoredWebSearch);
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>(
    loadStoredReasoningEffort,
  );
  // transport 是 useMemo 一次性建好的（useChat 也不会因 props 变化换 transport），
  // prepareSendMessagesRequest 里必须经 ref 拿最新设置；每次渲染同步一份是幂等写
  const chatSettingsRef = useRef({
    webSearch: webSearchEnabled,
    reasoningEffort,
  });
  chatSettingsRef.current = { webSearch: webSearchEnabled, reasoningEffort };

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
    // 主动发言就是「我要看新内容」：哪怕刚才上滚在读前文，也弹回底部跟自己的
    // 消息和随后的回答
    stickToBottomRef.current = true;
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
            <ChatMessage
              key={message.id}
              message={message}
              isStreaming={isBusy && message.id === lastMessage?.id}
            />
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
        {/* 设置行：与 ToolTrace 同一套 11px 大写微标签语汇。搜索是 agentic 的：
            开着也只是允许模型在需要时搜，不是每条都搜 */}
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
