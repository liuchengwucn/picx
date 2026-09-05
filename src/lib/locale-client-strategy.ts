/**
 * 客户端的 custom-negotiate 策略，与 src/server.ts 里的服务端实现成对：两边都走
 * locale-negotiation.ts 的 pickLocale，服务端喂 Accept-Language，这里喂
 * navigator.languages，同一个浏览器两边得出同一个 locale。
 *
 * 必须在客户端第一次 getLocale() 之前注册（router.tsx 顶部 side-effect import）。
 * 没有它，客户端解析链跳过未注册的 custom 策略直接落到 baseLocale(en)，而 runtime
 * 首次解析成功会顺手 setLocale 把结果写进 cookie ——于是非英语浏览器的首访不只是
 * hydration 失配，还被永久钉成英文（2026-09-05 生产实测）。
 *
 * 客户端的 custom 策略是按 strategy 数组顺序执行的（不像服务端恒排最前），所以
 * 这里不需要像 server.ts 那样先查 cookie 让位。
 */

import { pickLocale } from "#/lib/locale-negotiation";
import { defineCustomClientStrategy } from "#/paraglide/runtime";

defineCustomClientStrategy("custom-negotiate", {
  getLocale: () => {
    // router.tsx 在 SSR 侧也会被加载，这个 handler 只应在浏览器里给出答案。
    // Workers 里 navigator 存在但没有 languages，落回 undefined 让链条继续走 baseLocale。
    if (typeof navigator === "undefined" || !navigator.languages) {
      return undefined;
    }
    return pickLocale(navigator.languages);
  },
  // 持久化由 strategy 里的 cookie 策略负责，这里没有自己的存储。
  setLocale: () => {},
});
