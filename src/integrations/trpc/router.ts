import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "./init";
import { paperRouter } from "./routers/paper";
import { sseRouter } from "./routers/sse";
import { uploadRouter } from "./routers/upload";
import { userRouter } from "./routers/user";

const todos = [
	{ id: 1, name: "Get groceries" },
	{ id: 2, name: "Buy a new phone" },
	{ id: 3, name: "Finish the project" },
];

const todosRouter = {
	list: publicProcedure.query(() => todos),
	add: publicProcedure
		.input(z.object({ name: z.string() }))
		.mutation(({ input }) => {
			const newTodo = { id: todos.length + 1, name: input.name };
			todos.push(newTodo);
			return newTodo;
		}),
} satisfies TRPCRouterRecord;

export const trpcRouter = createTRPCRouter({
	todos: todosRouter,
	user: userRouter,
	paper: paperRouter,
	upload: uploadRouter,
	sse: sseRouter,
});
export type TRPCRouter = typeof trpcRouter;
