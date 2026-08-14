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
import { REVIEW_GUEST_USER_ID } from "#/lib/review-guest";
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

    const list = await caller.list();
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

    await caller.update({ id, name: "renamed-skill", enabled: false });

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

    await expect(guestCaller.list()).resolves.toEqual([]);

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
