import { Brain, Globe, Loader2, SendHorizontal, X } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { REASONING_EFFORTS } from "#/components/chat/use-chat-settings";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
// 仅类型导入：chat.ts 是服务端模块，值导入会被打进客户端包
import type { ChatReasoningEffort } from "#/lib/chat";
import { CHAT_CLIENT_LIMITS } from "#/lib/chat-errors";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";

/** 与服务端 maxInputChars 同源（超出直接 413） */
const MAX_INPUT_CHARS = CHAT_CLIENT_LIMITS.maxInputChars;
/** 只在接近上限时才露出计数器，平时不干扰书写 */
const COUNTER_VISIBLE_FROM = Math.floor(MAX_INPUT_CHARS * 0.9);

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

function reasoningEffortLabel(effort: ChatReasoningEffort): string {
  switch (effort) {
    case "off":
      return m.chat_reasoning_off();
    case "low":
      return m.chat_reasoning_low();
    case "high":
      return m.chat_reasoning_high();
  }
}

export interface ChatInputAreaProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isBusy: boolean;
  /**
   * 发送按钮的额外禁用条件（历史注水中/会话创建中等）；空输入内部已处理。
   * Enter 路径不经此项，onSend 必须自带守卫（现状两处 handleSend 都有）。
   */
  sendDisabled?: boolean;
  /** 发送按钮显示 spinner（如隐式建会话的请求在飞） */
  sendPending?: boolean;
  placeholder: string;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  reasoningEffort: ChatReasoningEffort;
  onReasoningEffortChange: (value: string) => void;
  /** 外部需要聚焦输入框时透传（如把 PDF 引用插进来之后） */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

/**
 * 聊天输入区整块：输入行 + 设置行。外层容器（border-t 与两侧留白）由使用方提供，
 * 两个面板的容器 padding 不同。
 * textarea 自身无边框（静息态就该像纸面而不是控件），焦点指示放在内层这个有圆角、
 * 且被 padding 从容器边缘让开的 wrapper 上：外层贴边，而 paper-card /
 * DialogContent 都是 overflow-hidden，挂在那儿的 ring 会被裁得只剩上边一条。
 * 这里用「描边显形 + 底色微亮」而不是 ring，既不会被裁，也保住了静息态的无边框观感。
 */
export function ChatInputArea({
  input,
  onInputChange,
  onSend,
  onStop,
  isBusy,
  sendDisabled,
  sendPending,
  placeholder,
  webSearchEnabled,
  onToggleWebSearch,
  reasoningEffort,
  onReasoningEffortChange,
  inputRef,
}: ChatInputAreaProps) {
  // 自己也要拿到 textarea（外部不一定传 inputRef），下面的自动增高要用
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const attachRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      localRef.current = node;
      if (inputRef) inputRef.current = node;
    },
    [inputRef],
  );

  /**
   * 随内容增高，上限交给 className 的 max-h-40（超过就内部滚动）。
   *
   * 没有这段的话 rows=2 是死高度：写第三行起就只剩一个 2 行的窗口在滚，而 PDF 的
   * 「问这段」会一次性塞进一段最长 2000 字的引用——实测注入后用户看到的是一个**看
   * 起来完全空白**的输入框（滚到了引用末尾那个空行），除了滚动条什么反馈都没有。
   * 用 useEffect 而不是 useLayoutEffect：这块要 SSR，且它必须早于 PaperChat 里那个
   * 「注入后把光标滚进视野」的 effect 跑——子组件的 effect 本来就排在父组件前面。
   *
   * ⚠️ `[input]` 是**必须**的，尽管 effect 体里没有读它：高度要跟着内容变，而内容只
   * 能从这个 prop 感知（节点走 ref，不在依赖表里）。biome 只看 effect 体，于是判定
   * 「依赖多于必要：input」并给出一个 **unsafe autofix：删掉多余依赖**。真被
   * `biome check --write --unsafe` 执行掉，依赖表就成了 `[]`，effect 只在挂载时跑一
   * 次，自动增高静默失效、且不会有任何测试或类型报错。删这条抑制前先想清楚这件事。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: input 是有意保留的「内容变了」信号，规则的 autofix 会删掉它并悄悄废掉自动增高（详见上方注释）
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  return (
    <>
      <div className="flex items-end gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors focus-within:border-[var(--academic-brown)]/60 focus-within:bg-[var(--parchment-warm)]/60">
        <textarea
          ref={attachRef}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            // 中文/日文输入法选字时的 Enter 属于组合过程，不能当成发送
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            onSend();
          }}
          maxLength={MAX_INPUT_CHARS}
          rows={2}
          placeholder={placeholder}
          aria-label={placeholder}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent text-sm leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-soft)]"
        />
        {isBusy ? (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={onStop}
            aria-label={m.chat_stop()}
            title={m.chat_stop()}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            onClick={onSend}
            disabled={!input.trim() || sendDisabled}
            aria-label={m.chat_send()}
            title={m.chat_send()}
          >
            {sendPending ? (
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
          onClick={onToggleWebSearch}
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
                reasoningEffort !== "off" ? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS,
              )}
            >
              <Brain className="h-3.5 w-3.5 shrink-0" />
              {reasoningEffortLabel(reasoningEffort)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuRadioGroup
              value={reasoningEffort}
              onValueChange={onReasoningEffortChange}
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
    </>
  );
}
