import { desc, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "#/db/schema";
import { assistantSkills } from "#/db/schema";
import { BUILTIN_SKILLS } from "#/lib/builtin-skills";
import {
  buildSkillsCatalogEntries,
  buildSkillsCatalogSection,
  SKILL_LIMITS,
} from "#/lib/skills";

type Db = DrizzleD1Database<typeof schema>;

/**
 * catalog 注入文本的完整装配：查库 → 合并内置 → 渲染。
 *
 * ⚠️ 查询必须是「该用户的全部行」——不带 enabled 过滤、不带 limit。
 * 关掉的内置 skill 在库里是一条 enabled=false 的同名行，只有把它查出来才能压住内置版本；
 * 加 limit 同理会让第 26 行之后的用户行压不住同名内置。过滤 enabled 是
 * buildSkillsCatalogEntries 在合并之后做的事，不是 SQL 的事。
 *
 * 抛错由调用方降级（catalog 查不出来只是跳过注入，不阻断对话）。
 */
export async function buildSkillsCatalogForUser(
  db: Db,
  userId: string,
): Promise<string> {
  const rows = await db
    .select({
      name: assistantSkills.name,
      description: assistantSkills.description,
      enabled: assistantSkills.enabled,
    })
    .from(assistantSkills)
    .where(eq(assistantSkills.userId, userId))
    .orderBy(desc(assistantSkills.updatedAt));
  const entries = buildSkillsCatalogEntries(rows, BUILTIN_SKILLS);
  return buildSkillsCatalogSection(
    entries.slice(0, SKILL_LIMITS.catalogMaxEntries),
    entries.length > SKILL_LIMITS.catalogMaxEntries,
  );
}
