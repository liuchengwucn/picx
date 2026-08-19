/**
 * catalog 注入文本的装配（真 SQLite）。这一层的价值全在**那条查询的形状**：
 * 纯函数 buildSkillsCatalogEntries 的单测挡不住「SQL 里加回 enabled 过滤 / 加回 limit」，
 * 而那正是 catalog 侧复活 bug 的入口。所以这里必须走真库。
 */
import { describe, expect, it } from "vitest";
import { assistantSkills, user } from "#/db/schema";
import { BUILTIN_SKILL_NAMES } from "#/lib/builtin-skills";
import { SKILL_LIMITS } from "#/lib/skills";
import { buildSkillsCatalogForUser } from "#/lib/skills-catalog";
import { createTestDb } from "../../test/helpers/sqlite-d1";

type Db = ReturnType<typeof createTestDb>["db"];

async function seedUser(db: Db, id: string) {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    createdAt: now,
    updatedAt: now,
  });
}

/** 注入文本里的 skills 数组按出现顺序取名字（顺序断言用，不做集合比较） */
function namesInOrder(section: string): string[] {
  const match = section.match(/\{"skills":.*?,"truncated":(?:true|false)\}/);
  if (!match) return [];
  const parsed = JSON.parse(match[0]) as {
    skills: { name: string }[];
  };
  return parsed.skills.map((entry) => entry.name);
}

function isTruncated(section: string): boolean {
  return section.includes('"truncated":true');
}

describe("buildSkillsCatalogForUser", () => {
  it("零自建 skill 时注入三条内置", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");

    const names = namesInOrder(await buildSkillsCatalogForUser(db, "user-1"));
    expect(names).toEqual([...BUILTIN_SKILL_NAMES]);
  });

  it("自建 skill 排在内置之前", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    await db.insert(assistantSkills).values({
      userId: "user-1",
      name: "my-skill",
      description: "mine",
      body: "b",
    });

    const names = namesInOrder(await buildSkillsCatalogForUser(db, "user-1"));
    expect(names).toEqual(["my-skill", ...BUILTIN_SKILL_NAMES]);
  });

  // 复活陷阱在 catalog 查询侧的锁：关掉内置 = 一条 enabled=false 的同名用户行。
  // 若查询加回 `enabled = true` 过滤，这条覆盖查不出来，fact-check 会回到注入文本里。
  it("关掉的内置 skill 不出现在注入文本里", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    await db.insert(assistantSkills).values({
      userId: "user-1",
      name: "fact-check",
      description: "d",
      body: "b",
      enabled: false,
    });

    const section = await buildSkillsCatalogForUser(db, "user-1");
    expect(section).not.toContain("fact-check");
    expect(namesInOrder(section)).toEqual(
      [...BUILTIN_SKILL_NAMES].filter((name) => name !== "fact-check"),
    );
  });

  it("条目超过上限时截断并置 truncated", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    const total = SKILL_LIMITS.catalogMaxEntries + 5;
    await db.insert(assistantSkills).values(
      Array.from({ length: total }, (_, i) => ({
        userId: "user-1",
        name: `skill-${String(i).padStart(2, "0")}`,
        description: "d",
        body: "b",
        updatedAt: new Date(2020, 0, 1, 0, 0, i),
      })),
    );

    const section = await buildSkillsCatalogForUser(db, "user-1");
    // 内置排在用户行之后，30 条用户行已经吃满 25 的额度，所以一条内置都进不来
    expect(namesInOrder(section)).toHaveLength(SKILL_LIMITS.catalogMaxEntries);
    expect(isTruncated(section)).toBe(true);
    for (const name of BUILTIN_SKILL_NAMES) {
      expect(namesInOrder(section)).not.toContain(name);
    }
  });

  // limit 锁：查询若加回 `.limit(catalogMaxEntries + 1)`，updatedAt 最老的那条
  // disabled 同名行会被截在窗口外、压不住内置，fact-check 就在注入文本里复活了。
  // 用大量 disabled 填充行把它挤出窗口，同时让 enabled 条目少到内置仍进得了 25 条额度。
  it("覆盖判定不受读取窗口影响：最老的 disabled 同名行仍压住内置", async () => {
    const { db } = createTestDb();
    await seedUser(db, "user-1");
    // 最老的一条：模拟「很久以前关掉了内置 fact-check」
    await db.insert(assistantSkills).values({
      userId: "user-1",
      name: "fact-check",
      description: "d",
      body: "b",
      enabled: false,
      updatedAt: new Date(2020, 0, 1),
    });
    // 之后又建了一堆（都关着，好让内置仍有额度进 catalog）
    await db.insert(assistantSkills).values(
      Array.from({ length: SKILL_LIMITS.catalogMaxEntries + 3 }, (_, i) => ({
        userId: "user-1",
        name: `filler-${String(i).padStart(2, "0")}`,
        description: "d",
        body: "b",
        enabled: false,
        updatedAt: new Date(2021, 0, 1, 0, 0, i),
      })),
    );
    await db.insert(assistantSkills).values({
      userId: "user-1",
      name: "my-skill",
      description: "mine",
      body: "b",
      updatedAt: new Date(2022, 0, 1),
    });

    const section = await buildSkillsCatalogForUser(db, "user-1");
    expect(section).not.toContain("fact-check");
    expect(namesInOrder(section)).toEqual([
      "my-skill",
      ...[...BUILTIN_SKILL_NAMES].filter((name) => name !== "fact-check"),
    ]);
  });
});
