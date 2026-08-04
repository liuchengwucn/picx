import { createTRPCRouter } from "./init";
import { apiConfigRouter } from "./routers/api-config";
import { chatRouter } from "./routers/chat";
import { paperRouter } from "./routers/paper";
import { readerRouter } from "./routers/reader";
import { uploadRouter } from "./routers/upload";
import { userRouter } from "./routers/user";
import { whiteboardPromptRouter } from "./routers/whiteboard-prompt";

export const trpcRouter = createTRPCRouter({
  user: userRouter,
  paper: paperRouter,
  upload: uploadRouter,
  apiConfig: apiConfigRouter,
  whiteboardPrompt: whiteboardPromptRouter,
  reader: readerRouter,
  chat: chatRouter,
});
export type TRPCRouter = typeof trpcRouter;
