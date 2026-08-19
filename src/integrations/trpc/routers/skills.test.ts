/**
 * skills 路由的 CRUD / 越权 / 唯一约束 / 上限四件套。
 *
 * 跑在真 SQLite 上（见 test/helpers/sqlite-d1）而非 mock 链：isUniqueViolation
 * 靠 error.message 正则识别唯一约束冲突，只有让 assistant_skills_user_name_uq
 * 这条真索引在真引擎里跑一遍、抛出真的 "UNIQUE constraint failed" 才测得到；
 * per-user 计数上限、越权 NOT_FOUND 同理依赖 WHERE 的真实语义。
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantSkills, user } from "#/db/schema";
import { BUILTIN_SKILLS, BUILTIN_TIMESTAMP } from "#/lib/builtin-skills";
import { REVIEW_GUEST_USER_ID } from "#/lib/review-guest";
import { SKILL_LIMITS } from "#/lib/skills";
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { skillsRouter } from "./skills";

type Db = ReturnType<typeof createTestDb>["db"];

function makeCaller(db: Db, userId: string) {
  const ctx = {
    db,
    headers: new Headers(),
    env: {},
    auth: { api: { getSession: async () => ({ user: { id: userId } }) } },
  };
  return skillsRouter.createCaller(ctx as never);
}

async function seedUsers(db: Db, ids: string[]) {
  const now = new Date();
  await db.insert(user).values(
    ids.map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

const validInput = {
  name: "my-skill",
  description: "does a thing",
  body: "# instructions",
};

describe("skillsRouter CRUD", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb().db;
    await seedUsers(db, ["user-1", "user-2"]);
  });

  it("creates a skill and reads it back via list/get; list omits body", async () => {
    const caller = makeCaller(db, "user-1");

    const { id } = await caller.create(validInput);
    expect(id).toBeTruthy();

    // list 头部固定是内置行（见下方 "builtin skills"），这里只看用户自己的部分
    const list = (await caller.list()).filter((row) => !row.builtin);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: validInput.name });
    expect(list[0]).not.toHaveProperty("body");

    const got = await caller.get({ id });
    expect(got).toMatchObject(validInput);
  });

  it("rejects a duplicate name for the same user but allows it for another user", async () => {
    const callerA = makeCaller(db, "user-1");
    const callerB = makeCaller(db, "user-2");

    await callerA.create(validInput);

    await expect(callerA.create(validInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await expect(callerB.create(validInput)).resolves.toMatchObject({
      id: expect.any(String),
    });
  });

  it("updates name/enabled and advances updatedAt; renaming into a collision is rejected", async () => {
    const caller = makeCaller(db, "user-1");

    const { id } = await caller.create(validInput);
    await caller.create({ ...validInput, name: "other-skill" });

    // 秒级 timestamp 同一时刻更新可能相等，先把它拨到过去再更新
    const past = new Date(Date.now() - 60_000);
    await db
      .update(assistantSkills)
      .set({ updatedAt: past })
      .where(eq(assistantSkills.id, id));

    // 返回值是 UI navigate 的地基（内置实体化时 id 会变），必须钉住
    await expect(
      caller.update({ id, name: "renamed-skill", enabled: false }),
    ).resolves.toEqual({ id });

    const got = await caller.get({ id });
    expect(got.name).toBe("renamed-skill");
    expect(got.enabled).toBe(false);
    expect(got.updatedAt.getTime()).toBeGreaterThan(past.getTime());

    await expect(
      caller.update({ id, name: "other-skill" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("hides other users' skills behind NOT_FOUND for get/update/delete", async () => {
    const callerA = makeCaller(db, "user-1");
    const callerB = makeCaller(db, "user-2");

    const { id } = await callerA.create(validInput);

    await expect(callerB.get({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      callerB.update({ id, name: "hijacked" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.delete({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // 没被越权写坏
    const stillA = await callerA.get({ id });
    expect(stillA.name).toBe(validInput.name);
  });
});

describe("skillsRouter review-guest read-only guard", () => {
  let db: Db;

  beforeEach(async () => {
    vi.stubEnv("VITE_ENABLE_REVIEW_GUEST", "true");
    db = createTestDb().db;
    await seedUsers(db, [REVIEW_GUEST_USER_ID, "user-1"]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows reads but forbids create/update/delete for the review-guest session", async () => {
    const guestCaller = makeCaller(db, REVIEW_GUEST_USER_ID);

    // 内置行对访客也可见（读操作不受限），但访客名下没有任何真实行
    const guestList = await guestCaller.list();
    expect(guestList).toHaveLength(BUILTIN_SKILLS.length);
    expect(guestList.every((row) => row.builtin)).toBe(true);

    await expect(guestCaller.create(validInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      guestCaller.update({ id: "does-not-matter", name: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      guestCaller.delete({ id: "does-not-matter" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not block a normal (non-guest) session even while guest mode is enabled", async () => {
    const normalCaller = makeCaller(db, "user-1");
    await expect(normalCaller.create(validInput)).resolves.toMatchObject({
      id: expect.any(String),
    });
  });
});

describe("skillsRouter per-user skill limit", () => {
  it("rejects the 51st skill with PRECONDITION_FAILED", async () => {
    const db = createTestDb().db;
    await seedUsers(db, ["user-1"]);
    const caller = makeCaller(db, "user-1");

    // 直接批量灌库，绕过 tRPC 更快
    await db.insert(assistantSkills).values(
      Array.from({ length: 50 }, (_, i) => ({
        userId: "user-1",
        name: `skill-${i}`,
        description: "seed",
        body: "seed body",
      })),
    );

    await expect(
      caller.create({ ...validInput, name: "one-too-many" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("builtin skills", () => {
  const BUILTIN_ID = "builtin:fact-check";

  it("list 把内置行排在最前并标记 builtin", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const caller = makeCaller(db, "u1");
    await caller.create({ name: "mine", description: "d", body: "b" });

    const rows = await caller.list();
    expect(rows.slice(0, 3).map((row) => row.name)).toEqual([
      "fact-check",
      "daily-brief",
      "topic-scan",
    ]);
    expect(rows.slice(0, 3).every((row) => row.builtin)).toBe(true);
    // enabled 决定 slash 选择器里是否出现；updatedAt 用常量是为了 SSR/CSR 一致
    expect(rows[0]).toMatchObject({
      enabled: true,
      updatedAt: BUILTIN_TIMESTAMP,
      bodyChars: expect.any(Number),
    });
    expect(rows.at(-1)).toMatchObject({ name: "mine", builtin: false });
  });

  it("get 虚拟 id 返回内置内容", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const row = await makeCaller(db, "u1").get({ id: BUILTIN_ID });
    expect(row.name).toBe("fact-check");
    expect(row.body.length).toBeGreaterThan(0);
    expect(row.enabled).toBe(true);
  });

  it("update 虚拟 id 会实体化成一条真实行", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const caller = makeCaller(db, "u1");

    const { id } = await caller.update({ id: BUILTIN_ID, enabled: false });
    expect(id).not.toBe(BUILTIN_ID);

    const stored = await db
      .select()
      .from(assistantSkills)
      .where(eq(assistantSkills.userId, "u1"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: "fact-check", enabled: false });
    // 实体化后 list 不再出现内置版本（否则关掉的 skill 会复活）
    const rows = await caller.list();
    expect(rows.filter((row) => row.name === "fact-check")).toHaveLength(1);
    expect(rows.find((row) => row.name === "fact-check")?.enabled).toBe(false);
  });

  it("重复实体化只留一行", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const caller = makeCaller(db, "u1");
    const first = await caller.update({ id: BUILTIN_ID, enabled: false });
    const second = await caller.update({ id: BUILTIN_ID, enabled: true });
    expect(second.id).toBe(first.id);
    const stored = await db
      .select()
      .from(assistantSkills)
      .where(eq(assistantSkills.userId, "u1"));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.enabled).toBe(true);
  });

  it("已满 maxPerUser 时仍能实体化（否则用户关不掉内置）", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const caller = makeCaller(db, "u1");
    for (let i = 0; i < SKILL_LIMITS.maxPerUser; i++) {
      await caller.create({ name: `s-${i}`, description: "d", body: "b" });
    }
    await expect(
      caller.update({ id: BUILTIN_ID, enabled: false }),
    ).resolves.toMatchObject({ id: expect.any(String) });
  });

  // 改名撞名有两条路径要守：未实体化时靠回退查询查不到行（下面这条），
  // 已实体化时靠 guard（再下面那条）。删掉 guard 只有后者会红。
  it("把内置改名撞上已有 skill 时报 CONFLICT 而不是覆盖它", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const caller = makeCaller(db, "u1");
    await caller.create({
      name: "my-notes",
      description: "keep",
      body: "keep me",
    });

    await expect(
      caller.update({ id: BUILTIN_ID, name: "my-notes", body: "clobber" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 原有 skill 必须原封不动
    const [row] = await db
      .select()
      .from(assistantSkills)
      .where(eq(assistantSkills.name, "my-notes"));
    expect(row).toMatchObject({ description: "keep", body: "keep me" });
  });

  it("已实体化后再改名撞上已有 skill，仍报 CONFLICT 而不是 500", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const caller = makeCaller(db, "u1");
    await caller.create({
      name: "my-notes",
      description: "keep",
      body: "keep me",
    });
    // 先实体化一次：此后库里已有真实的 fact-check 行，
    // 失败回退路径能查到它，guard 是这里唯一的防线
    await caller.update({ id: BUILTIN_ID, enabled: false });

    await expect(
      caller.update({ id: BUILTIN_ID, name: "my-notes" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const [row] = await db
      .select()
      .from(assistantSkills)
      .where(eq(assistantSkills.name, "my-notes"));
    expect(row).toMatchObject({ description: "keep", body: "keep me" });
  });

  it("用户已有同名 skill 时，带内容的补丁报 CONFLICT 而不是覆盖他的正文", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const caller = makeCaller(db, "u1");
    // 用户自己写了一条恰好也叫 fact-check 的 skill
    await caller.create({
      name: "fact-check",
      description: "mine",
      body: "MY PRECIOUS BODY",
    });

    // 编辑器保存的默认形状：name/description/body 都带上。后退键回到 builtin URL
    // 再保存就是这个请求，绝不能把内置正文盖到用户那条上。
    await expect(
      caller.update({
        id: BUILTIN_ID,
        name: "fact-check",
        description: "builtin desc",
        body: "builtin body",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const [row] = await db
      .select()
      .from(assistantSkills)
      .where(eq(assistantSkills.name, "fact-check"));
    expect(row).toMatchObject({
      description: "mine",
      body: "MY PRECIOUS BODY",
    });
  });

  it("未知内置名在 get/update/delete 三处都是 NOT_FOUND", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    const caller = makeCaller(db, "u1");
    const unknown = "builtin:nope";

    await expect(caller.get({ id: unknown })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller.update({ id: unknown, enabled: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.delete({ id: unknown })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("delete 虚拟 id 报 NOT_FOUND", async () => {
    const { db } = createTestDb();
    await seedUsers(db, ["u1"]);
    await expect(
      makeCaller(db, "u1").delete({ id: BUILTIN_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
