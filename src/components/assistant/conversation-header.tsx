import {
  Check,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { formatRelative } from "#/lib/relative-time";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/** 服务端标题上限 80，输入框跟着卡同一个值，避免提交后被 tRPC 拒掉 */
const TITLE_MAX_CHARS = 80;

interface ConversationHeaderProps {
  title: string | null;
  messageCount: number;
  updatedAt: Date;
  now: number;
  /** 窄屏会话面板是否展开 */
  isListOpen: boolean;
  onToggleList: () => void;
  /** 窄屏面板的 id，供 aria-controls 指向 */
  listId: string;
  onRename: (title: string) => void;
  onDelete: () => void;
  isDeleting: boolean;
}

/**
 * 当前会话的报头。桌面与窄屏共用同一份——旧版窄屏另有一条折叠栏，
 * 两套结构两套代码，改一处漏一处。
 * 标题在两个断点都是「点一下就地重命名」，窄屏的展开交给独立的 ⌄ 按钮，
 * 免得同一个热区在两个断点是两种语义。
 */
export function ConversationHeader({
  title,
  messageCount,
  updatedAt,
  now,
  isListOpen,
  onToggleList,
  listId,
  onRename,
  onDelete,
  isDeleting,
}: ConversationHeaderProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  /** 已点过删除、正在等第二次确认（就地两步确认，不弹系统对话框） */
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const displayTitle = title ?? m.assistant_untitled();

  const submitRename = (value: string) => {
    setIsRenaming(false);
    onRename(value);
  };

  return (
    <div className="flex h-10 items-center gap-2 border-b border-[var(--line)] px-1">
      {isRenaming ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: 重命名是用户点标题显式发起的，光标必须落进来
          autoFocus
          // 空标题会话不能拿 i18n 兜底串当初值：直接失焦就会把「新会话」写死进库
          defaultValue={title ?? ""}
          placeholder={m.assistant_untitled()}
          maxLength={TITLE_MAX_CHARS}
          aria-label={m.assistant_rename()}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              submitRename(event.currentTarget.value);
            }
            if (event.key === "Escape") setIsRenaming(false);
          }}
          onBlur={(event) => submitRename(event.currentTarget.value)}
          className="min-w-0 flex-1 border-b border-[var(--academic-brown)]/50 bg-transparent px-1 font-serif text-[15px] text-[var(--ink)] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsRenaming(true)}
          title={m.assistant_rename()}
          className="min-w-0 truncate rounded-sm px-1 font-serif text-[15px] text-[var(--ink)] transition-colors hover:text-[var(--academic-brown)] focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:outline-none"
        >
          {displayTitle}
        </button>
      )}

      <span className="hidden shrink-0 text-[11px] text-[var(--ink-soft)] sm:inline">
        {m.assistant_message_count({ count: messageCount })} ·{" "}
        {/* now 每分钟才走一针，夹到 now 上即「刚刚」，否则会显示成「30 秒钟后」 */}
        {formatRelative(Math.min(updatedAt.getTime(), now), now, getLocale())}
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleList}
          aria-expanded={isListOpen}
          aria-controls={listId}
          aria-label={m.assistant_conversations()}
          className="md:hidden"
        >
          <ChevronDown
            className={cn(
              "size-4 text-[var(--ink-soft)] transition-transform",
              isListOpen && "rotate-180",
            )}
          />
        </Button>

        {isConfirmingDelete ? (
          <span className="flex items-center gap-1 bg-[var(--parchment-warm)] px-2 py-1">
            <span className="text-xs text-[var(--ink-soft)]">
              {m.assistant_delete_confirm()}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDelete}
              disabled={isDeleting}
              aria-label={m.assistant_delete()}
              title={m.assistant_delete()}
            >
              {isDeleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 text-[var(--sienna)]" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsConfirmingDelete(false)}
              aria-label={m.cancel()}
              title={m.cancel()}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${m.edit()}: ${displayTitle}`}
              >
                <MoreHorizontal className="h-4 w-4 text-[var(--ink-soft)]" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setIsRenaming(true)}>
                <Pencil className="h-3.5 w-3.5" />
                {m.assistant_rename()}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={isDeleting}
                onSelect={() => setIsConfirmingDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {m.assistant_delete()}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
    </div>
  );
}
