// 必须排在 routeTree 之前：路由模块加载期就可能触发 getLocale()，客户端的
// custom-negotiate 策略得先注册好，否则首访解析落到 en 并被写进 cookie。
import "#/lib/locale-client-strategy";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import TanStackQueryProvider, {
  getContext,
} from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // 每次 getRouter() 都新建 context, 保证 SSR 每请求一个 QueryClient
  // (Worker isolate 内跨请求共享单例会导致内容冻结, 见 root-provider.tsx)。
  // 通过 Wrap 把同一个 queryClient 传给 provider, 让路由 context (loader 侧)
  // 与组件树 (Provider 侧) 用的是同一实例。
  const context = getContext();

  const router = createTanStackRouter({
    routeTree,

    context,

    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,

    Wrap: ({ children }) => (
      <TanStackQueryProvider queryClient={context.queryClient}>
        {children}
      </TanStackQueryProvider>
    ),
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
