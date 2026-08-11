import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEW_GUEST_USER_ID } from "#/lib/review-guest";
import { adminRouter } from "./admin";

function makeCaller(opts: {
  session?: { user: { id: string; role?: string | null } } | null;
  adminIds?: string;
}) {
  const ctx = {
    // whoami 不碰 db：这里刻意不建测试库，免得纯中间件测试被整条迁移历史牵连
    db: {},
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
  it("非 admin 的 role 值（role=user）→ FORBIDDEN", async () => {
    await expect(
      makeCaller({ session: { user: { id: "u1", role: "user" } } }).whoami(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("ADMIN_USER_IDS 为空串 → 不能变成人人放行", async () => {
    await expect(
      makeCaller({
        session: { user: { id: "u1", role: null } },
        adminIds: "",
      }).whoami(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("白名单用户 → 放行（被测 id 落在带前导空格的那一项，锁住 trim）", async () => {
    await expect(
      makeCaller({
        session: { user: { id: "u-admin", role: null } },
        adminIds: "u-other, u-admin",
      }).whoami(),
    ).resolves.toEqual({ userId: "u-admin" });
  });
  it("role=admin → 放行", async () => {
    await expect(
      makeCaller({ session: { user: { id: "u2", role: "admin" } } }).whoami(),
    ).resolves.toEqual({ userId: "u2" });
  });
  it("多角色 role=admin,user → 放行（与插件的逗号分割语义一致）", async () => {
    await expect(
      makeCaller({
        session: { user: { id: "u3", role: "admin,user" } },
      }).whoami(),
    ).resolves.toEqual({ userId: "u3" });
  });

  // 全量遍历而非逐个点名：新加端点时漏挂 adminProcedure（哪怕一个 publicProcedure）
  // 就是权限洞，这条会在加端点的那一刻红掉。isAdmin 排在 .input() 之前，所以
  // 未登录时不需要构造合法输入就会先抛 UNAUTHORIZED。
  it("路由里每一个端点都挂了 adminProcedure", async () => {
    const caller = makeCaller({}) as unknown as Record<
      string,
      (input?: unknown) => Promise<unknown>
    >;
    const names = Object.keys(adminRouter._def.procedures);
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) {
      await expect(caller[name](undefined), name).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    }
  });
});
