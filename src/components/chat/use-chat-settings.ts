import { useRef, useState } from "react";
// 仅类型导入：chat.ts 是服务端模块（drizzle/R2 一大串），值导入会被打进客户端包
import type { ChatReasoningEffort } from "#/lib/chat";

export const REASONING_EFFORTS: readonly ChatReasoningEffort[] = [
  "off",
  "low",
  "high",
];

export interface ChatSettings {
  webSearch: boolean;
  reasoningEffort: ChatReasoningEffort;
}

/** 默认开：搜索是 agentic 的（模型自主决定调不调），常开的成本可控 */
function loadStoredWebSearch(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(key) !== "0";
  } catch {
    // Chrome「阻止所有 cookie」下访问 localStorage 本身就抛 SecurityError
    return true;
  }
}

/**
 * 默认「轻量」(low)：保持默认带思考（当前模型本就默认思考），但日常提问用
 * 低预算档就够；重问题用户自己升到「思考」。
 * 旧四档时代存下的 "medium" 不在白名单里，自动回落到默认档。
 */
function loadStoredReasoningEffort(key: string): ChatReasoningEffort {
  if (typeof window === "undefined") return "low";
  try {
    const raw = window.localStorage.getItem(key);
    const known = REASONING_EFFORTS.find((effort) => effort === raw);
    return known ?? "low";
  } catch {
    // 同 loadStoredWebSearch：读不了就用默认值
    return "low";
  }
}

function persistSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 隐私模式等场景写不进就算了，设置退化为仅当前页面生效
  }
}

/**
 * localStorage 记忆的聊天设置（网页搜索开关 + thinking 档位）。
 * storagePrefix 区分表面（"chat" 论文页 / "assistant" 助手页）：两处使用场景
 * 不同，键名刻意分开互不影响。lazy init 只在挂载时读一次 localStorage。
 * storagePrefix 须在组件生命周期内保持稳定（lazy init 只在挂载时捕获键名）。
 * settingsRef：transport 是 useMemo 一次性建好的（useChat 也不会因 props 变化
 * 换 transport），prepareSendMessagesRequest 里必须经 ref 拿最新设置；每次渲染
 * 同步一份是幂等写。
 */
export function useChatSettings(storagePrefix: "chat" | "assistant") {
  const webSearchKey = `picx.${storagePrefix}.webSearch`;
  const reasoningKey = `picx.${storagePrefix}.reasoningEffort`;

  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(() =>
    loadStoredWebSearch(webSearchKey),
  );
  const [reasoningEffort, setReasoningEffort] = useState<ChatReasoningEffort>(
    () => loadStoredReasoningEffort(reasoningKey),
  );
  const settingsRef = useRef<ChatSettings>({
    webSearch: webSearchEnabled,
    reasoningEffort,
  });
  settingsRef.current = { webSearch: webSearchEnabled, reasoningEffort };

  const toggleWebSearch = () => {
    const next = !webSearchEnabled;
    setWebSearchEnabled(next);
    persistSetting(webSearchKey, next ? "1" : "0");
  };

  const changeReasoningEffort = (value: string) => {
    const next = REASONING_EFFORTS.find((effort) => effort === value) ?? "off";
    setReasoningEffort(next);
    persistSetting(reasoningKey, next);
  };

  return {
    webSearchEnabled,
    reasoningEffort,
    settingsRef,
    toggleWebSearch,
    changeReasoningEffort,
  };
}
