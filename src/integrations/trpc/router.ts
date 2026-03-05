import type { TRPCRouterRecord } from "@trpc/server";
import { createTRPCRouter } from "./init";
import { paperRouter } from "./routers/paper";
import { sseRouter } from "./routers/sse";
import { uploadRouter } from "./routers/upload";
import { userRouter } from "./routers/user";

export const trpcRouter = createTRPCRouter({
  user: userRouter,
  paper: paperRouter,
  upload: uploadRouter,
  sse: sseRouter,
});
export type TRPCRouter = typeof trpcRouter;
