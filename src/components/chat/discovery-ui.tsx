import type { ToolUIPart } from "ai";
import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolDisplayMap } from "#/components/chat/chat-message";
import {
  type DiscoveredPaper,
  PaperResultCards,
} from "#/components/chat/paper-result-cards";
import { m } from "#/paraglide/messages";

/** 发现三件套在活动区块里的展示（键名与 buildDiscoveryTools 一一对应），两个聊天入口共用 */
export const DISCOVERY_TOOL_DISPLAYS: ToolDisplayMap = {
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
};

/**
 * recommendPapers（模型精选推荐）的输出在正文流里就地渲染成可入库的卡片；
 * 搜索工具的结果只有模型自己可见，不渲染。服务端落库时保留该工具的 output
 * （CARD_TOOL_TYPES），历史回显也能重建出同样的卡片。
 * 模块级函数、引用天然稳定：ChatMessage 是 memo 的，直接作为 renderToolOutput
 * 传入即可，无需 useCallback。
 */
export function renderDiscoveryToolOutput(part: ToolUIPart): ReactNode {
  if (part.type !== "tool-recommendPapers") return null;
  if (part.state !== "output-available") return null;
  // output 来自 D1 里存着的历史 JSON：早期格式或 {error} 分支都可能到这儿，
  // 形状不对就当没有卡片，别让一条旧消息把整个聊天区渲染崩掉
  const output = part.output as { results?: unknown } | undefined;
  if (!Array.isArray(output?.results) || output.results.length === 0)
    return null;
  return <PaperResultCards results={output.results as DiscoveredPaper[]} />;
}
