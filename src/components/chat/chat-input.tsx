import { Brain, Globe, Loader2, SendHorizontal, X } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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

/** slash 选择器里的一条候选（助手页的 skill）；id 只做 React key */
export interface SlashCommandItem {
  id: string;
  name: string;
  description: string;
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
  /**
   * slash 候选（`/` 开头时浮出选择器）。三个 props 全部可选且状态提在调用方：
   * 不传时（论文页）整条 slash 通路的代码路径与从前完全一致。
   */
  slashCommands?: SlashCommandItem[];
  selectedSlashCommand?: SlashCommandItem | null;
  onSelectSlashCommand?: (item: SlashCommandItem | null) => void;
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
  slashCommands,
  selectedSlashCommand,
  onSelectSlashCommand,
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

  /**
   * slash 选择器。打开条件：调用方接入了 slash（有候选与回调）、尚未选中、
   * 且输入以 `/` 开头。高亮 index 在每次输入变化（即过滤结果变化）时于
   * onChange 里重置为 0，不用 effect（避免再添一条 exhaustiveDependencies 抑制）。
   */
  const [slashHighlight, setSlashHighlight] = useState(0);
  const slashEnabled =
    !!onSelectSlashCommand && (slashCommands?.length ?? 0) > 0;
  const slashOpen =
    slashEnabled && !selectedSlashCommand && input.startsWith("/");
  const slashQuery = input.slice(1).toLowerCase();
  const filteredSlash = slashOpen
    ? (slashCommands ?? []).filter(
        (item) =>
          item.name.toLowerCase().includes(slashQuery) ||
          item.description.toLowerCase().includes(slashQuery),
      )
    : [];
  // 读取处夹取：state 里的 index 存在不经过 onChange 的越界路径（如 React Query
  // refetch 让 slashCommands 变短），键盘与渲染一律用夹取后的值
  const slashActive = Math.min(
    slashHighlight,
    Math.max(filteredSlash.length - 1, 0),
  );
  // combobox a11y 的稳定 id（listbox 容器与每个 option）
  const slashListboxId = useId();
  const slashOptionId = (index: number) => `${slashListboxId}-opt-${index}`;

  const selectSlash = (item: SlashCommandItem) => {
    onSelectSlashCommand?.(item);
    onInputChange("");
  };

  // 高亮项滚进视野：useCallback 稳定身份，只在高亮切换（ref 从 undefined 换成
  // 本函数）时触发一次，普通重渲染不会反复 detach/attach
  const scrollSlashOptionIntoView = useCallback(
    (node: HTMLButtonElement | null) =>
      node?.scrollIntoView({ block: "nearest" }),
    [],
  );

  // 选中 skill 后可见 placeholder 换成参数提示，aria-label 必须同步
  const effectivePlaceholder = selectedSlashCommand
    ? m.assistant_slash_args_placeholder()
    : placeholder;

  return (
    <>
      <div className="relative flex items-end gap-2 rounded-lg border border-transparent px-2 py-1.5 transition-colors focus-within:border-[var(--academic-brown)]/60 focus-within:bg-[var(--parchment-warm)]/60">
        {slashOpen && (
          // 视觉语汇对齐 DropdownMenuContent（bg-popover + 细边框 + shadow-md）
          <div className="absolute bottom-full left-0 z-10 mb-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
            <p className="px-3 pt-2 pb-1 text-[11px] tracking-[0.14em] text-[var(--ink-soft)] uppercase">
              {m.assistant_slash_hint()}
            </p>
            {filteredSlash.length === 0 ? (
              <p className="px-3 pb-2.5 text-sm text-[var(--ink-soft)]">
                {m.assistant_slash_no_match()}
              </p>
            ) : (
              // div 而非 ul：biome 的 a11y 规则不接受 ul+role=listbox
              <div
                id={slashListboxId}
                className="max-h-56 overflow-y-auto p-1"
                role="listbox"
              >
                {filteredSlash.map((item, index) => (
                  <button
                    key={item.id}
                    id={slashOptionId(index)}
                    type="button"
                    role="option"
                    aria-selected={index === slashActive}
                    ref={
                      index === slashActive
                        ? scrollSlashOptionIntoView
                        : undefined
                    }
                    // onMouseDown 而非 onClick：click 要等 mouseup，textarea
                    // 先失焦可能引发布局变化，点击会落空
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectSlash(item);
                    }}
                    onMouseEnter={() => setSlashHighlight(index)}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left",
                      index === slashActive && "bg-[var(--academic-brown)]/10",
                    )}
                  >
                    <span className="font-mono text-xs text-[var(--academic-brown)]">
                      /{item.name}
                    </span>
                    <span className="line-clamp-1 text-xs text-[var(--ink-soft)]">
                      {item.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {selectedSlashCommand && (
          // 选中态 chip：沿用 TOGGLE_ON_CLASS 的「按下的实体按钮」语汇
          <span className="mb-1.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--academic-brown)]/40 bg-[var(--academic-brown)]/10 px-1.5 py-0.5 font-mono text-xs text-[var(--academic-brown)] shadow-[inset_0_1px_3px_rgba(87,61,38,0.22)]">
            /{selectedSlashCommand.name}
            <button
              type="button"
              onClick={() => onSelectSlashCommand?.(null)}
              aria-label={m.assistant_slash_clear()}
              title={m.assistant_slash_clear()}
              className="rounded-sm hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <textarea
          ref={attachRef}
          value={input}
          onChange={(event) => {
            // 输入一变过滤结果就变，高亮回到第一项（非 slash 场景 0→0 无重渲染）
            setSlashHighlight(0);
            onInputChange(event.target.value);
          }}
          onKeyDown={(event) => {
            // slash 选择器打开时先接管键盘；IME 组合中的按键（选字上下移动、
            // 确认候选的 Enter）一律不拦
            if (slashOpen && !event.nativeEvent.isComposing) {
              if (event.key === "ArrowDown" && filteredSlash.length > 0) {
                event.preventDefault();
                setSlashHighlight(
                  Math.min(slashActive + 1, filteredSlash.length - 1),
                );
                return;
              }
              if (event.key === "ArrowUp" && filteredSlash.length > 0) {
                event.preventDefault();
                setSlashHighlight(Math.max(slashActive - 1, 0));
                return;
              }
              if (event.key === "Escape") {
                // 关闭 = 去掉触发它的 `/` 前缀，余下文本保留
                event.preventDefault();
                onInputChange(input.slice(1));
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                // 列表为空时 slashActive=0 也取不到项，保持放行发送的语义
                const item = filteredSlash[slashActive];
                if (item) {
                  event.preventDefault();
                  selectSlash(item);
                  return;
                }
                // 无命中放行给发送：用户可能真想发一句 `/` 开头的话
              }
            }
            // 已选中 skill 且输入为空时，Backspace 撤销选中（chip 的键盘等价物）
            if (
              selectedSlashCommand &&
              input.length === 0 &&
              event.key === "Backspace"
            ) {
              event.preventDefault();
              onSelectSlashCommand?.(null);
              return;
            }
            if (event.key !== "Enter" || event.shiftKey) return;
            // 中文/日文输入法选字时的 Enter 属于组合过程，不能当成发送
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            onSend();
          }}
          maxLength={MAX_INPUT_CHARS}
          rows={2}
          placeholder={effectivePlaceholder}
          aria-label={effectivePlaceholder}
          // combobox 语义只在接入 slash 的页面挂上（条件 spread：论文页零额外
          // 属性，biome 的静态 role 检查也不会把 textbox 误判成不支持 aria-expanded）
          {...(slashEnabled
            ? {
                role: "combobox",
                "aria-expanded": slashOpen,
                "aria-controls": slashOpen ? slashListboxId : undefined,
                "aria-activedescendant":
                  slashOpen && filteredSlash.length > 0
                    ? slashOptionId(slashActive)
                    : undefined,
              }
            : undefined)}
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
            // 选中 skill 时无参数也可发（指令本身就是完整消息）
            disabled={(!input.trim() && !selectedSlashCommand) || sendDisabled}
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
