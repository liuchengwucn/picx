import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { user, userApiConfigs } from "#/db/schema";
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { apiConfigRouter } from "./api-config";

type Db = ReturnType<typeof createTestDb>["db"];

function makeCaller(db: Db, userId: string) {
  const ctx = {
    db,
    headers: new Headers(),
    env: {},
    auth: { api: { getSession: async () => ({ user: { id: userId } }) } },
  };
  return apiConfigRouter.createCaller(ctx as never);
}

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

/**
 * 直接写库而不是走 create：create 会用 CONFIG_ENCRYPTION_KEY 加密密钥，而这里要验的
 * 是 delete 的默认继承，与加解密无关。createdAt 显式给值——继承取的是「最早创建」，
 * 靠 $defaultFn 的话同一毫秒内插入的几条无法定序。
 */
async function seedConfig(
  db: Db,
  userId: string,
  name: string,
  opts: { isDefault?: boolean; createdAt: Date },
) {
  const id = crypto.randomUUID();
  await db.insert(userApiConfigs).values({
    id,
    userId,
    name,
    openaiApiKey: "enc",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiModel: "gpt-4o-mini",
    geminiApiKey: "enc",
    geminiBaseUrl: "https://generativelanguage.googleapis.com",
    geminiModel: "gemini-2.0-flash",
    isDefault: opts.isDefault ?? false,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
  });
  return id;
}

async function listDefaults(db: Db, userId: string) {
  return db
    .select({ name: userApiConfigs.name, isDefault: userApiConfigs.isDefault })
    .from(userApiConfigs)
    .where(eq(userApiConfigs.userId, userId))
    .orderBy(asc(userApiConfigs.createdAt));
}

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-01-02T00:00:00Z");
const T2 = new Date("2026-01-03T00:00:00Z");

describe("apiConfigRouter.delete", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb().db;
    await seedUser(db, "u1");
  });

  it("promotes the oldest remaining config when the default is deleted", async () => {
    const target = await seedConfig(db, "u1", "default", {
      isDefault: true,
      createdAt: T1,
    });
    await seedConfig(db, "u1", "oldest", { createdAt: T0 });
    await seedConfig(db, "u1", "newest", { createdAt: T2 });

    await makeCaller(db, "u1").delete(target);

    expect(await listDefaults(db, "u1")).toEqual([
      { name: "oldest", isDefault: true },
      { name: "newest", isDefault: false },
    ]);
  });

  it("leaves the existing default alone when a non-default is deleted", async () => {
    await seedConfig(db, "u1", "oldest", { createdAt: T0 });
    const target = await seedConfig(db, "u1", "victim", { createdAt: T1 });
    await seedConfig(db, "u1", "default", { isDefault: true, createdAt: T2 });

    await makeCaller(db, "u1").delete(target);

    expect(await listDefaults(db, "u1")).toEqual([
      { name: "oldest", isDefault: false },
      { name: "default", isDefault: true },
    ]);
  });

  it("deleting the only config leaves nothing to promote", async () => {
    const target = await seedConfig(db, "u1", "only", {
      isDefault: true,
      createdAt: T0,
    });

    await makeCaller(db, "u1").delete(target);

    expect(await listDefaults(db, "u1")).toEqual([]);
  });

  // 继承必须限定在本人名下：漏掉 userId 谓词的话，删自己的默认配置会把别人最早的
  // 那条设成默认（在 D1 上是跨账号的静默写入）。
  it("never promotes another user's config", async () => {
    await seedUser(db, "u2");
    await seedConfig(db, "u2", "other-user", { createdAt: T0 });
    const target = await seedConfig(db, "u1", "mine", {
      isDefault: true,
      createdAt: T1,
    });

    await makeCaller(db, "u1").delete(target);

    expect(await listDefaults(db, "u2")).toEqual([
      { name: "other-user", isDefault: false },
    ]);
  });

  it("rejects deleting a config owned by someone else", async () => {
    await seedUser(db, "u2");
    const target = await seedConfig(db, "u2", "theirs", {
      isDefault: true,
      createdAt: T0,
    });

    await expect(makeCaller(db, "u1").delete(target)).rejects.toThrow(
      /not found/i,
    );
    expect(await listDefaults(db, "u2")).toEqual([
      { name: "theirs", isDefault: true },
    ]);
  });
});
