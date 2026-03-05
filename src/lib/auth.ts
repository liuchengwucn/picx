import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { initializeUserCredits } from "#/db/user-extensions";

export const auth = betterAuth({
	emailAndPassword: {
		enabled: true,
	},
	user: {
		additionalFields: {
			credits: {
				type: "number",
				defaultValue: 10,
				required: true,
			},
		},
	},
	hooks: {
		after: createAuthMiddleware(async (ctx) => {
			if (ctx.path.startsWith("/sign-up")) {
				const newSession = ctx.context.newSession;
				if (newSession) {
					await initializeUserCredits(newSession.user.id);
				}
			}
		}),
	},
	plugins: [tanstackStartCookies()],
});
