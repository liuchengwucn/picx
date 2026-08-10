import { useSyncExternalStore } from "react";

/** 永不发通知的 store: 这里要的不是订阅, 只是 React 对两个 snapshot 的分诊。 */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * 本组件是否已经过了 hydration。用途只有一个: 让「本组件首次客户端渲染」与服务端
 * 那帧逐属性相等。React 的 hydration 不 diff 属性(只对结构/文本不一致报错并丢弃
 * 子树重渲), 所以任何依赖客户端才知道的状态(登录态、我的投票)的属性, 首帧必须先按
 * 服务端那帧的值渲染, 挂载后再翻。
 *
 * 用 useSyncExternalStore 的双 snapshot 而不是模块级标志 / useState+useEffect:
 *
 * - 模块级标志(踩过): 它在「任意一个组件的 effect 跑完」时就翻成 true, 而 hydration
 *   是分批的 —— 页面靠上的组件(Header)先 hydrate 并把标志翻了, 靠下的子树(简报期页
 *   的论文卡)之后才 hydrate, 于是那些组件**首次**渲染读到的就已经是 true, 门等于没设:
 *   它们直接按解析后的登录态渲染, 撞上服务端那帧的 aria-disabled="true", 属性不被
 *   修补 → 按钮永久点不动。必须按「这个组件自己有没有 hydrate 完」来判断。
 * - useState(false)+useEffect: 分不清「hydration 后首次挂载」与「SPA 导航挂载」,
 *   后者会白 disable 一帧。
 *
 * 双 snapshot 两件事一次做到: hydration 那次渲染 React 取 getServerSnapshot(false),
 * 与服务端一致, 之后自动补一次更新翻成 true; 而 SPA 导航是纯客户端挂载, 直接取
 * getSnapshot(true), 不多渲染那一帧。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
