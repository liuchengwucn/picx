import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "#/db/schema";
import { INITIAL_CREDITS, initializeUserCredits } from "#/db/user-extensions";

interface AppEnvBindings {
  DB: D1Database;
}

// 获取 D1 数据库实例
const appEnv = env as typeof env & AppEnvBindings;
const db = drizzle(appEnv.DB, { schema });

export const auth = betterAuth({
  database: appEnv.DB, // D1 原生支持，自动检测
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    },
  },
  user: {
    additionalFields: {
      credits: {
        type: "number",
        defaultValue: INITIAL_CREDITS,
        required: true,
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      // GitHub OAuth 回调路径
      if (ctx.path.startsWith("/callback/github")) {
        const newSession = ctx.context.newSession;
        if (newSession?.user?.id) {
          const success = await initializeUserCredits(newSession.user.id, db);
          if (!success) {
            console.error(
              `Failed to initialize credits for user ${newSession.user.id}`,
            );
            // 注意：此时用户已创建，无法回滚，但至少记录了错误
          }
        }
      }
    }),
  },
  plugins: [tanstackStartCookies()],
});
