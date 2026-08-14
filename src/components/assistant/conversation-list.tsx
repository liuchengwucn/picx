import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type ConversationGroupKind,
  conversationTimeLabel,
  groupConversations,
} from "#/lib/assistant/group-conversations";
import { cn } from "#/lib/utils";
import { m } from "#/paraglide/messages";
import { getLocale } from "#/paraglide/runtime";

/** 少于这个条数不渲染搜索框：三五条会话上面摆一个搜索框纯属噪音 */
const SEARCH_VISIBLE_FROM = 8;

export interface ConversationListItem {
  id: string;
  title: string | null;
  updatedAt: Date;
  lastMessageText: string | null;
}

interface ConversationListProps {
  conversations: ConversationListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** 每分钟走一针的时钟，由页面持有——分组边界要能跨过午夜 */
  now: number;
  /** 窄屏面板要被开关的 aria-controls 指向；桌面侧栏不传 */
  listId?: string;
}

function groupLabel(
  kind: ConversationGroupKind,
  date: Date | null,
  monthFormat: Intl.DateTimeFormat,
): string {
  if (kind === "today") return m.assistant_group_today();
  if (kind === "yesterday") return m.assistant_group_yesterday();
  if (kind === "week") return m.assistant_group_this_week();
  return date ? monthFormat.format(date) : "";
}

/**
 * 会话列表：搜索 + 分组标题 + 双行行。桌面侧栏与窄屏 overlay 面板共用这一份。
 * 搜索是纯前端过滤，不写 URL——列表本来就全量在手，刷新即丢是可接受的。
 */
export function ConversationList({
  conversations,
  activeId,
  onSelect,
  now,
  listId,
}: ConversationListProps) {
  const [query, setQuery] = useState("");
  const locale = getLocale();

  const keyword = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      keyword
        ? conversations.filter((row) =>
            `${row.title ?? ""}\n${row.lastMessageText ?? ""}`
              .toLowerCase()
              .includes(keyword),
          )
        : conversations,
    [conversations, keyword],
  );
  const groups = useMemo(
    () => groupConversations(filtered, now),
    [filtered, now],
  );
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }),
    [locale],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {conversations.length >= SEARCH_VISIBLE_FROM && (
        <div className="relative px-3 pb-1">
          <Search className="pointer-events-none absolute top-1/2 left-5 size-3 -translate-y-1/2 text-[var(--ink-soft)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={m.assistant_search_placeholder()}
            aria-label={m.assistant_search_placeholder()}
            maxLength={100}
            className="w-full rounded-md border border-[var(--line)] bg-[var(--parchment-warm)]/40 py-1 pr-6 pl-6 text-xs text-[var(--ink)] transition-colors outline-none placeholder:text-[var(--ink-soft)] focus:border-[var(--academic-brown)]/60"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={m.assistant_search_clear()}
              className="absolute top-1/2 right-5 -translate-y-1/2 text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}

      <nav
        id={listId}
        aria-label={m.assistant_conversations()}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {groups.length === 0 ? (
          <p className="px-3 py-4 text-xs leading-relaxed text-[var(--ink-soft)]">
            {m.assistant_search_no_match()}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <h3 className="mx-3 mt-3 mb-0.5 flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-[var(--academic-brown)] uppercase after:h-px after:flex-1 after:bg-[var(--line)] after:content-['']">
                {groupLabel(group.kind, group.date, monthFormat)}
              </h3>
              <ul>
                {group.items.map((row) => {
                  const isActive = row.id === activeId;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(row.id)}
                        aria-current={isActive ? "true" : undefined}
                        // 无圆角是刻意的：左边那条棕线必须上下齐平切断，
                        // 圆角会把它拗成一道弧，正是旧版看着别扭的原因。
                        className={cn(
                          "block w-full border-l-2 py-1.5 pr-3 pl-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-[var(--academic-brown)]/40 focus-visible:ring-inset focus-visible:outline-none",
                          isActive
                            ? "border-[var(--academic-brown)] bg-[var(--parchment-warm)]"
                            : "border-transparent hover:bg-[var(--parchment-warm)]/60",
                        )}
                      >
                        <span
                          className={cn(
                            "block truncate text-[13px] leading-snug",
                            isActive
                              ? "font-semibold text-[var(--academic-brown-deep)]"
                              : "text-[var(--ink)]",
                            !row.title && "italic",
                          )}
                        >
                          {row.title ?? m.assistant_untitled()}
                        </span>
                        <span className="mt-0.5 flex items-baseline gap-2 text-[11px] text-[var(--ink-soft)]">
                          <span className="min-w-0 flex-1 truncate">
                            {row.lastMessageText ?? ""}
                          </span>
                          {/* now 每分钟才走一针：刚更新的会话会比它「新」，
                              不夹住就会出现「30 秒钟后」这种标签 */}
                          <span className="shrink-0 tabular-nums">
                            {conversationTimeLabel(
                              Math.min(row.updatedAt.getTime(), now),
                              group.kind,
                              locale,
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </nav>
    </div>
  );
}
