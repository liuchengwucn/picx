import { isToolUIPart, type ToolUIPart, type UIMessage } from "ai";
import { ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CHAT_ERROR_CODES, type ChatErrorCode } from "#/lib/chat-errors";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/**
 * react-markdown 生成的 DOM 没有 class 可挂，只能靠后代选择器排版。
 *
 * 这里没用站内常见的 `prose`（typography 插件是装了的）：prose 的字号/行距/垂直
 * 节奏是按正文栏宽调的，塞进 360px 的侧栏会显得又大又松，而且它自带 max-width
 * 与一堆需要 `max-w-none`、`prose-sm` 层层压回去的默认值。侧栏只需要一套更紧的
 * 排版，直接写清单比对抗 prose 更短也更可控。
 */
export const MARKDOWN_CLASS = [
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

/** 一个工具在活动区块里的展示方式 */
export interface ToolDisplay {
  icon: LucideIcon;
  running: () => string;
  done: () => string;
  /**
   * 完成判定；缺省 = output-available | output-error（本地工具）。
   * server tool（如 web_search）流里没有 output part，用 state !== "input-streaming"
   */
  isDone?: (state: string) => boolean;
}

/** key 是工具名（不含 "tool-" 前缀）。不在 map 里的工具 part 不进活动区块 */
export type ToolDisplayMap = Record<string, ToolDisplay>;

function toolNameOf(partType: string): string {
  return partType.slice("tool-".length);
}

function isToolDone(state: string, display: ToolDisplay): boolean {
  return display.isDone
    ? display.isDone(state)
    : state === "output-available" || state === "output-error";
}

/**
 * 工具「跑完了但没成事」的判定。本站的工具不抛异常，失败走的是正常返回值里的
 * `{ error }`（如 readPaper 拿不到全文、guest 被拒写档案），只看 state 会把它们
 * 显示成「已完成」。
 */
function hasErrorOutput(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    // hasOwn 而非 in：防工具输出的原型链上恰好有 error
    Object.hasOwn(output, "error") &&
    (output as { error?: unknown }).error != null
  );
}

type ToolOutcome = "running" | "done" | "failed";

/**
 * 只取判定要用的两个字段：isToolUIPart 收窄出来的联合里还带着 dynamic-tool 分支，
 * 结构化描述比跟着 ai 的类型联合跑省事得多。
 */
interface ToolPartLike {
  state: string;
  output?: unknown;
}

function toolOutcome(part: ToolPartLike, display: ToolDisplay): ToolOutcome {
  if (part.state === "output-error") return "failed";
  if (part.state === "output-available" && hasErrorOutput(part.output))
    return "failed";
  return isToolDone(part.state, display) ? "done" : "running";
}

function toolOutcomeLabel(outcome: ToolOutcome, display: ToolDisplay): string {
  if (outcome === "failed") return m.chat_tool_failed();
  return outcome === "done" ? display.done() : display.running();
}

/**
 * /api/chat 的错误以稳定 code 下发：HTTP 非 2xx 时 body 是 `{"error": code}`，
 * transport 把整个 body 文本塞进 Error.message；流内错误则是裸 code
 * （`stream_failed`）。两条路径都在这里归一成用户文案。
 */
export function resolveChatErrorMessage(error: unknown): string {
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

export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

/** 助手回复里的工具调用：只以一行状态出现，不展开原始输入输出 */
function ToolTrace({
  part,
  display,
}: {
  part: ToolPartLike;
  display: ToolDisplay;
}) {
  const outcome = toolOutcome(part, display);
  const DoneIcon = display.icon;
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-[11px] tracking-[0.14em] uppercase",
        // 失败只是「这一步没成」，比成功更轻而不是更响：压低对比度，不用警示色
        outcome === "failed"
          ? "text-[var(--ink-soft)]/70"
          : "text-[var(--ink-soft)]",
      )}
    >
      {outcome === "running" ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <DoneIcon className="h-3.5 w-3.5 shrink-0" />
      )}
      {toolOutcomeLabel(outcome, display)}
    </p>
  );
}

/** 活动区块的行：key 在 ChatMessage 里按原始 part 下标生成（part 顺序稳定追加） */
interface ActivityItem {
  key: string;
  part: UIMessage["parts"][number];
}

/** 流式头部的当前活动：看最后一个活动 part 在干嘛 */
function currentActivityLabel(
  items: ActivityItem[],
  toolDisplays: ToolDisplayMap,
): string {
  const last = items[items.length - 1]?.part;
  if (last && isToolUIPart(last)) {
    const display = toolDisplays[toolNameOf(last.type)];
    if (display) {
      return toolOutcomeLabel(toolOutcome(last, display), display);
    }
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
  toolDisplays,
}: {
  items: ActivityItem[];
  isStreaming: boolean;
  textStarted: boolean;
  toolDisplays: ToolDisplayMap;
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
        {live
          ? currentActivityLabel(items, toolDisplays)
          : m.chat_activity_label()}
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
            if (isToolUIPart(part)) {
              const display = toolDisplays[toolNameOf(part.type)];
              // 服务端工具（如 OpenRouter 的 web_search）流里只有工具调用没有
              // output part，完成判定由各自的 display.isDone 决定
              if (display) {
                return <ToolTrace key={key} part={part} display={display} />;
              }
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
export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  toolDisplays,
  renderToolOutput,
}: {
  message: UIMessage;
  /** 该消息是否正在流式生成（只有最后一条会是 true），驱动活动区块的自动开合 */
  isStreaming: boolean;
  toolDisplays: ToolDisplayMap;
  /** 在正文流内渲染某个工具 part 的自定义块（assistant 的论文卡片用）；返回 null 则不渲染 */
  renderToolOutput?: (part: ToolUIPart, messageId: string) => React.ReactNode;
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
        // hasOwn 而非 in：防工具名撞 Object.prototype 键（如 toString）时误放行
        (isToolUIPart(part) &&
          Object.hasOwn(toolDisplays, toolNameOf(part.type))),
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
          toolDisplays={toolDisplays}
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
        // 调用方可以在正文流里为某个工具 part 渲染自定义块（如论文卡片）
        if (
          renderToolOutput &&
          isToolUIPart(part) &&
          part.type !== "dynamic-tool"
        ) {
          const node = renderToolOutput(part, message.id);
          if (node !== null && node !== undefined) {
            return <div key={`${message.id}-tool-${index}`}>{node}</div>;
          }
        }
        // reasoning / 工具 part 已并入顶部活动区块；未知 part 不渲染也不崩
        return null;
      })}
      {sources.length > 0 && <SourceFootnotes sources={sources} />}
    </div>
  );
});
