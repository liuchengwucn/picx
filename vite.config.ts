import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

/** 唯一允许在 SSR 图里 import pdfjs-dist 的目录（见下方 stub-pdfjs-ssr） */
const PDF_COMPONENT_DIR = fileURLToPath(
  new URL("./src/components/papers/pdf/", import.meta.url),
);

const config = defineConfig({
  // OrbStack VM 内的工具（curl/playwright）经 host.internal 访问 mac 侧 dev server
  server: { allowedHosts: ["host.internal"] },
  // package.json 的 build 脚本给 vite 显式加了 --max-old-space-size=3072，原因在这里：
  //
  // Workers Builds 的构建容器约 4GB，node 据此把默认老生代定在 ~2.0GB。而本项目
  // 在 SSR 环境的 "rendering chunks" 阶段实测就需要这么多——加 PDF tab 之前的
  // f3492c7 在 1792MB 下 OOM、2048MB 才勉强过，也就是说线上构建长期只剩不到 10%
  // 余量，下一个提交无论是什么都会把它推过线（PDF tab 只是恰好排到：需求涨到
  // 2048 挂、2304 过）。峰值跟产物大小不成比例：SSR 包只涨了 12 KiB gzip，但
  // client 与 ssr 两个环境在同一个进程里先后构建，client 那 1.26MB 的
  // pdf.worker 资源与 225KB 样式的驻留内存要一直背到 SSR 阶段。
  //
  // 取 3072 而不是 4096：容器总量就 4GB，堆开太大只会把「V8 干净地报 OOM」换成
  // 「容器被 OOM killer 杀掉」，后者在构建日志里更难认。
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
    // pdfjs 只在浏览器里跑（阅读器 tab），但它照样会被打进 SSR 产物。
    //
    // 归因要点（别搞反，搞反了就会把这个插件当成多余的删掉）：字节进包**不是**
    // 因为服务端执行了什么，而是因为 rollup 在**构建期**静态跟进依赖链。
    // $shortId.tsx 里 `lazy(() => import("…/pdf-reader-view"))` 的 import() 说明符是
    // 字面量，rollup 把整条子树纳入 SSR 图；use-pdf-viewer 里那几个 await import()
    // 同理。所以「改成 <ClientOnly>、挂载后再渲染」之类的运行时手段一个都不管用，
    // 字节该进还是进。（Fizz 确实会在服务端解析 lazy 并渲染组件，那是 loading
    // 遮罩能被 SSR 出来的原因，但它跟打包与否无关。）
    //
    // 代价：pdf.mjs + pdf_viewer.mjs + 第二份 1.26MB 的 pdf.worker + 225KB 样式
    // ≈ +604 KiB gzip，一度把 Worker 脚本从 2785 KiB 推过免费版 3 MiB 的红线。
    // 运行时倒是无害——那些 import 都在 effect 里，服务端永不执行。
    //
    // 约束：只能命中 ssr 环境。客户端环境必须拿到真模块，否则阅读器直接白屏——
    // 这是空模块 stub 唯一的失败模式，也是唯一需要盯住的地方。
    {
      name: "stub-pdfjs-ssr",
      enforce: "pre",
      resolveId(id, importer, opts) {
        if (!opts?.ssr) return;
        if (id !== "pdfjs-dist" && !id.startsWith("pdfjs-dist/")) return;
        // 白名单之外一律构建期报错，而不是默默发一个空模块。
        // 因为空模块对「先 await import() 再取属性」这种写法是完全静默的：
        // 构建、tsc、vitest 全绿，只有线上 worker 抛 "x is not a function"。
        // 而服务端真有 pdfjs 需求（src/lib/pdf.ts、pdf-trim.ts 用的是
        // pdfjs-serverless），有人把它换成 pdfjs-dist 是很自然的一步重构——
        // 这一步必须在构建期就撞墙。importer 实测在 dev 与 build 两条 SSR 路径下
        // 形状一致：绝对 POSIX 路径、不带 query（虚拟模块或入口则为 undefined，
        // 那种情况我们不认识，放行给 stub，保持保守）。
        if (importer && !importer.startsWith(PDF_COMPONENT_DIR)) {
          this.error(
            `${importer} 在 SSR 图里 import 了 ${id}。pdfjs-dist 已被 stub-pdfjs-ssr ` +
              `换成空模块（仅供浏览器使用），在服务端取到的任何导出都是 undefined。` +
              `服务端请改用 pdfjs-serverless（见 src/lib/pdf.ts、src/lib/pdf-trim.ts）；` +
              `若确实是浏览器专用代码，请放进 ${PDF_COMPONENT_DIR}。`,
          );
        }
        return "\0pdfjs-ssr-stub";
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
