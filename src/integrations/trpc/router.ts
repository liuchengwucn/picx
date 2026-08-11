import { createTRPCRouter } from "./init";
import { adminRouter } from "./routers/admin";
import { apiConfigRouter } from "./routers/api-config";
import { assistantRouter } from "./routers/assistant";
import { chatRouter } from "./routers/chat";
import { digestRouter } from "./routers/digest";
import { newsRouter } from "./routers/news";
import { paperRouter } from "./routers/paper";
import { readerRouter } from "./routers/reader";
import { userRouter } from "./routers/user";
import { whiteboardPromptRouter } from "./routers/whiteboard-prompt";

export const trpcRouter = createTRPCRouter({
  user: userRouter,
  paper: paperRouter,
  apiConfig: apiConfigRouter,
  whiteboardPrompt: whiteboardPromptRouter,
  reader: readerRouter,
  chat: chatRouter,
  news: newsRouter,
  digest: digestRouter,
  assistant: assistantRouter,
  admin: adminRouter,
});
export type TRPCRouter = typeof trpcRouter;
