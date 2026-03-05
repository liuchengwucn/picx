import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { INITIAL_CREDITS, initializeUserCredits } from "#/db/user-extensions";

export const auth = betterAuth({
	emailAndPassword: {
		enabled: true,
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
			if (ctx.path.startsWith("/sign-up")) {
				const newSession = ctx.context.newSession;
				if (newSession?.user?.id) {
					const success = await initializeUserCredits(newSession.user.id);
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
