import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directionSources, directions } from "#/db/schema";
import { REVIEW_GUEST_USER_ID } from "#/lib/review-guest";
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { adminRouter } from "./admin";

type Db = ReturnType<typeof createTestDb>["db"];
/** 手动触发拿到的 workflow 实例参数，逐次记下来（守卫要验的是「一个都没起飞」） */
type CreatedInstance = { id: string; params: unknown };

function makeCaller(opts: {
  session?: { user: { id: string; role?: string | null } } | null;
  adminIds?: string;
  db?: unknown;
  workflow?: { create: (options: CreatedInstance) => Promise<unknown> };
}) {
  const ctx = {
    // whoami 不碰 db：默认刻意不建测试库，免得纯中间件测试被整条迁移历史牵连
    db: opts.db ?? {},
    headers: new Headers(),
    env: { ADMIN_USER_IDS: opts.adminIds, DIGEST_WORKFLOW: opts.workflow },
    auth: { api: { getSession: async () => opts.session ?? null } },
  };
  return adminRouter.createCaller(ctx as never);
}

const ADMIN_SESSION = { user: { id: "u-admin", role: "admin" } };

function four(prefix: string): Record<string, string> {
  return {
    en: `${prefix} en`,
    "zh-cn": `${prefix} zh-cn`,
    "zh-tw": `${prefix} zh-tw`,
    ja: `${prefix} ja`,
  };
}

/** dir-on 启用中，dir-off 已停用 */
async function seedDirections(db: Db) {
  await db.insert(directions).values([
    {
      id: "dir-on",
      slug: "on",
      name: four("On"),
      focusBrief: "启用中的方向",
      isActive: true,
      sortOrder: 0,
    },
    {
      id: "dir-off",
      slug: "off",
      name: four("Off"),
      focusBrief: "已停用的方向",
      isActive: false,
      sortOrder: 1,
    },
  ]);
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

  // 全量遍历而非逐个点名：新加端点时漏挂 adminProcedure 就是权限洞，这条会在加
  // 端点的那一刻红掉。isAdmin 排在 .input() 之前，所以不用构造合法输入就先抛。
  // 两轮都要跑：未登录轮只能抓出 publicProcedure，而最可能误用的其实是同一个
  // ../init 里的邻居 protectedProcedure —— 它未登录时同样抛 UNAUTHORIZED，
  // 只有「已登录的普通用户」这一轮才能把它揪出来（任意登录用户能改方向、
  // 拉全站反馈、触发 workflow）。
  it("路由里每一个端点都挂了 adminProcedure", async () => {
    type Callers = Record<string, (input?: unknown) => Promise<unknown>>;
    const names = Object.keys(adminRouter._def.procedures);
    expect(names.length).toBeGreaterThan(1);

    const anonymous = makeCaller({}) as unknown as Callers;
    for (const name of names) {
      await expect(anonymous[name](undefined), name).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    }

    const authed = makeCaller({
      session: { user: { id: "u1", role: null } },
    }) as unknown as Callers;
    for (const name of names) {
      await expect(authed[name](undefined), name).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });
});

/**
 * 手动触发是 Phase 3 新开的第二条起飞跑道，deleteDirectionGuarded 的 still_active
 * 守卫（见 admin-store.ts 顶部那段论证）押在「停用即无新实例起飞」上，所以这里的
 * isActive 判定不是锦上添花：漏掉它，对已停用无历史的方向「触发 → 立刻删除」就能
 * 造出「在飞实例往被 DELETE 掉的 digest 插子行」的外键死循环。
 */
describe("triggerDigest 的 isActive 守卫", () => {
  let db: Db;
  let created: CreatedInstance[];
  let caller: ReturnType<typeof makeCaller>;

  beforeEach(async () => {
    db = createTestDb().db;
    await seedDirections(db);
    created = [];
    caller = makeCaller({
      session: ADMIN_SESSION,
      db,
      workflow: {
        create: async (options) => {
          created.push(options);
          return options;
        },
      },
    });
  });

  it("启用中的方向照旧起飞（实例 id 带 -m 后缀避开 cron 的当日确定性 id）", async () => {
    const result = await caller.triggerDigest({ directionId: "dir-on" });
    expect(result.instanceId).toMatch(/^digest-on-\d{8}-m\d{6}$/);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      id: result.instanceId,
      params: { directionId: "dir-on" },
    });
  });

  it("已停用的方向：BAD_REQUEST，且一个实例都没起飞", async () => {
    await expect(
      caller.triggerDigest({ directionId: "dir-off" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "direction not active",
    });
    // 断言落在「create 压根没被调用」上而不只是抛错：守卫写在 create 之后同样会抛，
    // 但那时实例已经在飞了
    expect(created).toEqual([]);
  });

  it("不存在的方向：NOT_FOUND，同样不起飞", async () => {
    await expect(
      caller.triggerDigest({ directionId: "dir-nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(created).toEqual([]);
  });
});

/**
 * 输入被拒时的 zod issue 路径。只断言「抛了 BAD_REQUEST」太松（任何输入错误都是它），
 * 要验的是错误指到了具体字段 —— 站长得知道是哪一个键缺了。
 */
async function rejectedInputPaths(
  promise: Promise<unknown>,
): Promise<string[]> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { issues?: { path: unknown[] }[] } })
      .cause;
    return (cause?.issues ?? []).map((issue) => issue.path.join("."));
  }
  throw new Error("expected the input to be rejected");
}

/**
 * 源配置的必填项按 adapterType 分叉。适配器那边是硬 throw（sources.ts），而错配的
 * 源要等到周六 workflow 跑才失败一次、好几周才熔断，所以保存这一刻就得拦住。
 */
describe("upsertSource 的按适配器必填校验", () => {
  let db: Db;
  let caller: ReturnType<typeof makeCaller>;

  beforeEach(async () => {
    db = createTestDb().db;
    await seedDirections(db);
    caller = makeCaller({ session: ADMIN_SESSION, db });
  });

  it("arxiv_query 缺 query（config 存成 {}）→ 指到 config.query", async () => {
    expect(
      await rejectedInputPaths(
        caller.upsertSource({
          directionId: "dir-on",
          adapterType: "arxiv_query",
          config: {},
          enabled: true,
        }),
      ),
    ).toEqual(["config.query"]);
  });

  it("arxiv_query 的 query 只有空白 → 照样拦住", async () => {
    expect(
      await rejectedInputPaths(
        caller.upsertSource({
          directionId: "dir-on",
          adapterType: "arxiv_query",
          config: { query: "   " },
          enabled: true,
        }),
      ),
    ).toEqual(["config.query"]);
  });

  it("rss 只填了 query → 指到 config.url", async () => {
    expect(
      await rejectedInputPaths(
        caller.upsertSource({
          directionId: "dir-on",
          adapterType: "rss",
          config: { query: "cat:cs.AI" },
          enabled: true,
        }),
      ),
    ).toEqual(["config.url"]);
  });

  it("字段名拼错（ur）被 strip 剥掉，于是当作缺 url 抓住", async () => {
    expect(
      await rejectedInputPaths(
        caller.upsertSource({
          directionId: "dir-on",
          adapterType: "rss",
          config: { ur: "https://example.com/feed.xml" } as unknown as {
            url?: string;
          },
          enabled: true,
        }),
      ),
    ).toEqual(["config.url"]);
  });

  it("rss 的 url 不是合法 URL → 仍由 sourceConfig 的 .url() 指到 config.url", async () => {
    expect(
      await rejectedInputPaths(
        caller.upsertSource({
          directionId: "dir-on",
          adapterType: "rss",
          config: { url: "example.com/feed.xml" },
          enabled: true,
        }),
      ),
    ).toEqual(["config.url"]);
  });

  it("切换适配器后残留的无关字段无害：rss + 合法 url + 残留 query 照样保存", async () => {
    const result = await caller.upsertSource({
      directionId: "dir-on",
      adapterType: "rss",
      config: { url: "https://example.com/feed.xml", query: "残留" },
      enabled: true,
    });
    expect(result).toMatchObject({ id: expect.stringMatching(/^dsrc-/) });
    const rows = await db.select().from(directionSources);
    expect(rows).toHaveLength(1);
    expect(rows[0].config).toEqual({
      url: "https://example.com/feed.xml",
      query: "残留",
    });
  });

  // 上面那条「拼错字段名被抓住」的前提：zod 的默认 strip 语义把未知键剥掉，
  // 剥掉之后必填项就缺了。改成 passthrough 的话拼错的键会原样入库、喂给适配器。
  it("未知键被 strip 剥掉，不混进库里", async () => {
    await caller.upsertSource({
      directionId: "dir-on",
      adapterType: "rss",
      config: {
        url: "https://example.com/feed.xml",
        ur: "拼错的键",
      } as unknown as { url?: string },
      enabled: true,
    });
    const rows = await db.select().from(directionSources);
    expect(rows[0].config).toEqual({ url: "https://example.com/feed.xml" });
  });

  it("arxiv_query 齐了 query 就能保存（校验不误伤正常配置）", async () => {
    await expect(
      caller.upsertSource({
        directionId: "dir-on",
        adapterType: "arxiv_query",
        config: { query: "cat:cs.LO AND abs:formalization", maxResults: 50 },
        enabled: true,
      }),
    ).resolves.toMatchObject({ id: expect.stringMatching(/^dsrc-/) });
  });
});
