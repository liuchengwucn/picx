import { useEffect, useState } from "react";

/** 整个 app 是否已经过了首帧 hydration。见 useHydrated 里为什么放模块级。 */
let appHydrated = false;

/**
 * 首帧是否已经过了 hydration。用途只有一个: 让「首次客户端渲染」与服务端那帧
 * 逐属性相等。React 的 hydration 不 diff 属性(只对结构/文本不一致报错并丢弃子树
 * 重渲), 所以任何依赖客户端才知道的状态(登录态、我的投票)的属性, 首帧必须先按
 * 服务端那帧的值渲染, 挂载后再翻。
 *
 * 标志放模块级而不是纯组件 state: 组件级 useState(false)+useEffect 分不清
 * 「hydration 后首次挂载」与「SPA 导航挂载」, 后者会白空/白 disable 一帧。
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(appHydrated);
  useEffect(() => {
    appHydrated = true;
    if (!hydrated) setHydrated(true);
  }, [hydrated]);
  return hydrated;
}
