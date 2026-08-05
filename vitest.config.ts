import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] })],
  resolve: {
    alias: {
      "cloudflare:workers": fileURLToPath(
        new URL("./test/mocks/cloudflare-workers.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // .claude/worktrees 下的残留副本会让同名测试跑两遍（biome 已同样排除）
    exclude: ["**/node_modules/**", "**/.claude/**"],
  },
});
