import { createTRPCRouter } from "./init";
import { apiConfigRouter } from "./routers/api-config";
import { assistantRouter } from "./routers/assistant";
import { chatRouter } from "./routers/chat";
import { newsRouter } from "./routers/news";
import { paperRouter } from "./routers/paper";
import { userRouter } from "./routers/user";
import { whiteboardPromptRouter } from "./routers/whiteboard-prompt";

export const trpcRouter = createTRPCRouter({
  user: userRouter,
  paper: paperRouter,
  apiConfig: apiConfigRouter,
  whiteboardPrompt: whiteboardPromptRouter,
  chat: chatRouter,
  news: newsRouter,
  assistant: assistantRouter,
});
export type TRPCRouter = typeof trpcRouter;
