import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEW_GUEST_USER_ID } from "#/lib/review-guest";
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { adminRouter } from "./admin";

function makeCaller(opts: {
  session?: { user: { id: string; role?: string | null } } | null;
  adminIds?: string;
}) {
  const { db } = createTestDb();
  const ctx = {
    db,
    headers: new Headers(),
    env: { ADMIN_USER_IDS: opts.adminIds },
    auth: { api: { getSession: async () => opts.session ?? null } },
  };
  return adminRouter.createCaller(ctx as never);
}

describe("adminProcedure 权限矩阵", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未登录 → UNAUTHORIZED", async () => {
    await expect(makeCaller({}).whoami()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("普通登录用户（无 role、不在白名单）→ FORBIDDEN", async () => {
    await expect(
      makeCaller({ session: { user: { id: "u1", role: null } } }).whoami(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("review-guest 合成会话 → FORBIDDEN（即使被塞进白名单也不放行）", async () => {
    // isReviewGuestSession 只在访客模式开启时才判定，测试环境默认关闭，
    // 这里显式开启，才是这条用例真正要守的场景（评审访客拿不到管理权限）。
    vi.stubEnv("VITE_ENABLE_REVIEW_GUEST", "true");
    await expect(
      makeCaller({
        session: { user: { id: REVIEW_GUEST_USER_ID, role: null } },
        adminIds: REVIEW_GUEST_USER_ID,
      }).whoami(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("白名单用户 → 放行", async () => {
    await expect(
      makeCaller({
        session: { user: { id: "u-admin", role: null } },
        adminIds: "u-admin, u-other",
      }).whoami(),
    ).resolves.toEqual({ userId: "u-admin" });
  });
  it("role=admin → 放行", async () => {
    await expect(
      makeCaller({ session: { user: { id: "u2", role: "admin" } } }).whoami(),
    ).resolves.toEqual({ userId: "u2" });
  });
});
