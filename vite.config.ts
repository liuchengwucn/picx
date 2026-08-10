import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
  // OrbStack VM 内的工具（curl/playwright）经 host.internal 访问 mac 侧 dev server
  server: { allowedHosts: ["host.internal"] },
  build: {
    rollupOptions: {
      external: ["cloudflare:workers"],
    },
  },
  optimizeDeps: {
    exclude: ["cloudflare:workers"],
  },
  plugins: [
    // In dev mode, vite:import-analysis scans all dynamic imports regardless of
    // import.meta.env.SSR guards. Stub cloudflare:workers for the client environment
    // so the dev server doesn't fail. SSR environment gets the real module from workerd.
    {
      name: "stub-cloudflare-workers",
      enforce: "pre",
      resolveId(id, _importer, opts) {
        if (id === "cloudflare:workers" && !opts?.ssr) {
          return "\0cloudflare-workers-stub";
        }
      },
      load(id) {
        if (id === "\0cloudflare-workers-stub") {
          return "export const env = {};";
        }
      },
    },
    // pdfjs 只在浏览器里跑（阅读器 tab），但它仍然会被拖进 SSR 图：
    // React.lazy 挡不住——Fizz 在服务端会直接解析 lazy 的 payload 并渲染组件，
    // 所以 pdf-reader-view.tsx 在 SSR 侧确实被求值，它的静态 CSS import 和
    // use-pdf-viewer 里那几个 await import() 都会被 vite 扫进 SSR 依赖图。
    // 运行时无害（那些 import 在 effect 里，服务端永不执行），但产物会被打进
    // dist/server/assets 并由 wrangler 一起上传：pdf.mjs + pdf_viewer.mjs +
    // 第二份 1.26MB 的 pdf.worker + 225KB 样式 ≈ +604 KiB gzip，
    // 刚好把 Worker 脚本从 2785 KiB 推过免费版 3 MiB 的红线。
    //
    // 约束：只能命中 ssr 环境。客户端环境必须拿到真模块，否则阅读器直接白屏——
    // 这是空模块 stub 唯一的失败模式，也是唯一需要盯住的地方。
    // 服务端自己用的是 pdfjs-serverless（src/lib/pdf.ts），前缀不同不会被误伤。
    {
      name: "stub-pdfjs-ssr",
      enforce: "pre",
      resolveId(id, _importer, opts) {
        if (
          opts?.ssr &&
          (id === "pdfjs-dist" || id.startsWith("pdfjs-dist/"))
        ) {
          return "\0pdfjs-ssr-stub";
        }
      },
      load(id) {
        if (id === "\0pdfjs-ssr-stub") {
          // 一个 stub 兼顾三种形态：命名空间导入（pdfjs-dist、pdf_viewer.mjs）、
          // `?url` 的 default 导出、以及纯副作用的 CSS import。三者在服务端都
          // 只需要「能解析、不产出字节」，取值路径全都在 effect 里，跑不到。
          return "export default undefined;";
        }
      },
    },
    // devtools 事件总线固定监听 42069，多个 worktree 同时 dev 会端口冲突，
    // 副实例用 DEVTOOLS_BUS_PORT 错开
    devtools({
      eventBusConfig: process.env.DEVTOOLS_BUS_PORT
        ? { port: Number(process.env.DEVTOOLS_BUS_PORT) }
        : undefined,
    }),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      strategy: ["localStorage", "preferredLanguage", "baseLocale"],
    }),
    // 本地 dev 不建 remote preview 会话（AI binding 是 remote-only，在部分网络下
    // 隧道不可达会导致 dev server 启动失败）；embed 在 dev 走 REST 回退，
    // 见 news-cron 的 embedProvider
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
