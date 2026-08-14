// src/workers/digest-cron.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { directions } from "#/db/schema";
import type { Env } from "#/types/env";

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const db = drizzle(env.DB);
    const active = await db
      .select({ id: directions.id, slug: directions.slug })
      .from(directions)
      .where(eq(directions.isActive, true));

    const periodEnd = new Date(controller.scheduledTime).toISOString();
    const dateTag = periodEnd.slice(0, 10).replaceAll("-", "");
    let created = 0;
    for (const [i, d] of active.entries()) {
      try {
        // 确定性 id：同一天重复触发（如手动重放 cron）会 throw，天然幂等
        // staggerMinutes：按下标错峰启动，降低/错开全部方向实例同时打 arXiv 的概率
        // （不是硬保证——429 退避本身可能把某实例的扫描推回别的实例窗口内；周报
        // 场景延迟几十分钟完全免费，真正的兜底是每源的重试+熔断降级）。扫描
        // 阶段常超 2 分钟，且 429 重试一轮就是 5 分钟起，故用 10 分钟一档把
        // 7 个方向摊满一小时，尽量压平对 export.arxiv.org 的请求曲线
        await env.DIGEST_WORKFLOW.create({
          id: `digest-${d.slug}-${dateTag}`,
          params: { directionId: d.id, periodEnd, staggerMinutes: i * 10 },
        });
        created++;
      } catch (e) {
        console.log(
          `[DigestCron] skip ${d.slug} (likely duplicate instance):`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    console.log(`[DigestCron] created ${created}/${active.length} instances`);
  },
};
