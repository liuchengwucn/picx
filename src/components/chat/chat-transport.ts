import { DefaultChatTransport, type UIMessage } from "ai";
import type { ChatSettings } from "#/components/chat/use-chat-settings";
import { getLocale } from "#/paraglide/runtime";

/**
 * 两个聊天面板共用的 transport 工厂，承担两种请求的定位：
 * - 发送（POST）：服务端只收最后一条消息（历史真源在 D1），且 parts 仅放行
 *   text。extraBody 提供路由定位字段（paperShortId / conversationId）；
 *   sendMessage 时通过 options.body 传的字段（如 sessionId）经 `...body` 保留。
 * - 重连（GET，resumeStream）：reconnectQuery 提供 query 定位字段
 *   （conversationId / sessionId），有活跃生成流则 SSE 重放+跟进，否则 204。
 * settingsRef / reconnectQuery 经 ref 或闭包取值——transport 用 useMemo 建一次，
 * 设置变化不重建。
 */
export function createTextOnlyChatTransport(options: {
  api: string;
  settingsRef: { readonly current: ChatSettings };
  extraBody: () => Record<string, unknown>;
  /** 重连 GET 的 query 定位字段。刻意必填：设成可选，调用方漏传时 resume 会静默失效 */
  reconnectQuery: () => Record<string, string>;
}): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport<UIMessage>({
    api: options.api,
    prepareReconnectToStreamRequest: () => ({
      // 默认形状是 `${api}/${chatId}/stream`，而我们的 useChat id 带前缀且
      // 路由是 query 定位，这里整体覆写
      api: `${options.api}?${new URLSearchParams(options.reconnectQuery())}`,
    }),
    prepareSendMessagesRequest: ({ messages, body }) => {
      const last = messages[messages.length - 1];
      return {
        body: {
          ...body,
          ...options.extraBody(),
          locale: getLocale(),
          webSearch: options.settingsRef.current.webSearch,
          reasoningEffort: options.settingsRef.current.reasoningEffort,
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
  });
}
