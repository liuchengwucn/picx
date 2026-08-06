import { useEffect, useRef } from "react";

/** 距底不超过这个像素数就算「贴着底」，继续跟随流式输出 */
const STICK_TO_BOTTOM_PX = 80;

/**
 * 聊天记录区的贴底跟随滚动。
 * 是否跟随只由 scroll 事件写入——scroll 事件只在滚动位置真的变化时触发，所以它
 * 读到的是「用户主动滚到哪」；而在 effect 里现算距底距离是分不清「用户上滚了」
 * 和「内容刚变高」的：注水整段历史后 scrollTop 还是 0、距底巨大，会被误判成
 * 用户上滚，结果会话一打开就停在最旧的一条。
 * 流式每来一个 chunk，最后一条消息都是新对象 → 以 lastMessage 为依赖即可持续贴底。
 */
export function useStickToBottom(lastMessage: unknown) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !lastMessage) return;
    if (!stickToBottomRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [lastMessage]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    stickToBottomRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight <=
      STICK_TO_BOTTOM_PX;
  };

  /** 主动发言/切会话＝「我要看新内容」：强制回到贴底跟随 */
  const resetStick = () => {
    stickToBottomRef.current = true;
  };

  return { scrollRef, handleScroll, resetStick };
}
