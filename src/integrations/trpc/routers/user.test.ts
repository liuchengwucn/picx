import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "#/db/schema";
import { MAX_CREDITS } from "#/db/user-extensions";
import { REVIEW_GUEST_USER_ID } from "#/lib/review-guest";
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { userRouter } from "./user";

type Db = ReturnType<typeof createTestDb>["db"];

function makeCaller(db: Db, userId: string) {
  const ctx = {
    db,
    headers: new Headers(),
    env: {},
    auth: { api: { getSession: async () => ({ user: { id: userId } }) } },
  };
  return userRouter.createCaller(ctx as never);
}

async function seedUser(
  db: Db,
  id: string,
  overrides: Partial<typeof user.$inferInsert> = {},
) {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

async function readUser(db: Db, id: string) {
  const [row] = await db
    .select({ lastSeenAt: user.lastSeenAt, credits: user.credits })
    .from(user)
    .where(eq(user.id, id));
  return row;
}

describe("userRouter.heartbeat", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb().db;
  });

  it("stamps lastSeenAt on first heartbeat", async () => {
    await seedUser(db, "u1");
    const before = Date.now();
    await makeCaller(db, "u1").heartbeat();
    const row = await readUser(db, "u1");
    expect(row.lastSeenAt).not.toBeNull();
    // timestamp 模式按秒存，允许 1s 截断
    expect(row.lastSeenAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("does not re-stamp within an hour", async () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000);
    await seedUser(db, "u1", { lastSeenAt: recent });
    await makeCaller(db, "u1").heartbeat();
    const row = await readUser(db, "u1");
    expect(
      Math.abs((row.lastSeenAt?.getTime() ?? 0) - recent.getTime()),
    ).toBeLessThan(1000);
  });

  it("re-stamps after an hour", async () => {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await seedUser(db, "u1", { lastSeenAt: stale });
    await makeCaller(db, "u1").heartbeat();
    const row = await readUser(db, "u1");
    expect(row.lastSeenAt?.getTime()).toBeGreaterThan(
      stale.getTime() + 60 * 60 * 1000,
    );
  });

  it("still stamps when credits are at the cap", async () => {
    await seedUser(db, "u1", { credits: MAX_CREDITS });
    const { granted } = await makeCaller(db, "u1").heartbeat();
    expect(granted).toBe(false);
    const row = await readUser(db, "u1");
    expect(row.lastSeenAt).not.toBeNull();
    expect(row.credits).toBe(MAX_CREDITS);
  });

  it("grants the daily bonus when eligible", async () => {
    await seedUser(db, "u1", { credits: 5, lastDailyBonusDate: "2000-01-01" });
    const { granted } = await makeCaller(db, "u1").heartbeat();
    expect(granted).toBe(true);
    const row = await readUser(db, "u1");
    expect(row.credits).toBe(8);
  });

  it("throws NOT_FOUND for a user id with no row", async () => {
    // 没有行时必须在盖戳前就抛，而不是落到 claimDailyBonusIfEligible 里
    await expect(makeCaller(db, "ghost").heartbeat()).rejects.toThrow(
      "User not found",
    );
  });
});

/**
 * 语义变更点：旧的 claimDailyBonus 对只读访客抛 FORBIDDEN，heartbeat 改为静默返回
 * granted:false —— 心跳是后台行为，访客不该因此在控制台里收获一片红。
 */
describe("userRouter.heartbeat review guest", () => {
  let db: Db;

  beforeEach(async () => {
    vi.stubEnv("VITE_ENABLE_REVIEW_GUEST", "true");
    db = createTestDb().db;
    await seedUser(db, REVIEW_GUEST_USER_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns granted:false and writes nothing for a read-only guest", async () => {
    const { granted } = await makeCaller(db, REVIEW_GUEST_USER_ID).heartbeat();
    expect(granted).toBe(false);
    // lastSeenAt 仍为 NULL 证明它在任何写之前就短路了
    const row = await readUser(db, REVIEW_GUEST_USER_ID);
    expect(row.lastSeenAt).toBeNull();
  });
});
