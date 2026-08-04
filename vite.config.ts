import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
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
    devtools(),
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
