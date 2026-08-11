import { getHomeToday } from "#/lib/home/today";
import { createTRPCRouter, publicProcedure } from "../init";

export const homeRouter = createTRPCRouter({
  today: publicProcedure.query(({ ctx }) => getHomeToday(ctx.db)),
});
