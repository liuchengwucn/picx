import { getTableColumns } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantSkills } from "#/db/schema";
import { REVIEW_GUEST_USER_ID } from "#/lib/review-guest";
import { skillsRouter } from "./skills";

// 项目里目前没有真实的 D1/sqlite 测试基座（唯一先例 security.test.ts 全靠手写
// vi.fn() 链式 mock），但这个 router 的用例（唯一约束、按 userId 计数上限、
// 越权 NOT_FOUND）都依赖真实的查询语义,逐条摆 mock 返回值既啰嗦又不可信。
// 这里改用 SQLiteSyncDialect 把 drizzle 生成的 where/orderBy 条件编译成真实 SQL
// 文本再做等值匹配，本质是给 assistant_skills 单表现算一个内存版 drizzle 执行器。
// 只覆盖本路由实际用到的形状：eq/and 等值条件、desc 排序、limit、count(*)。
type Row = typeof assistantSkills.$inferSelect;
type InsertValues = typeof assistantSkills.$inferInsert;

const dialect = new SQLiteSyncDialect();
const columns = getTableColumns(assistantSkills);
const dbNameToKey = Object.fromEntries(
  Object.entries(columns).map(([key, col]) => [col.name, key]),
) as Record<string, string>;

function isColumnRef(value: unknown): value is { name: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "columnType" in value &&
    "name" in value
  );
}

function isAggregate(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "queryChunks" in value &&
    !("columnType" in value)
  );
}

function uniqueMessage(): string {
  return "UNIQUE constraint failed: assistant_skills.user_id, assistant_skills.name";
}

/** eq/and 等值条件 → 逐子句 `"table"."col" = ?` 解析为 { key(js), value } 对 */
function parseEqClauses(condition: unknown): { key: string; value: unknown }[] {
  const { sql, params } = dialect.sqlToQuery(condition as never);
  const body = sql.replace(/^\(/, "").replace(/\)$/, "");
  const clauses = body.split(" and ");
  let paramIndex = 0;
  return clauses.map((clause) => {
    const match = /^"[^"]+"\."([^"]+)"\s*=\s*\?$/.exec(clause.trim());
    if (!match) {
      throw new Error(`fake db: unsupported where clause: ${clause}`);
    }
    const key = dbNameToKey[match[1] as string];
    if (!key) throw new Error(`fake db: unknown column: ${match[1]}`);
    return { key, value: params[paramIndex++] };
  });
}

function matches(row: Row, condition: unknown): boolean {
  if (!condition) return true;
  return parseEqClauses(condition).every(
    ({ key, value }) => (row as Record<string, unknown>)[key] === value,
  );
}

function parseOrderBy(order: unknown): { key: string; dir: 1 | -1 } {
  const { sql } = dialect.sqlToQuery(order as never);
  const match = /^"[^"]+"\."([^"]+)"(?:\s+(asc|desc))?$/.exec(sql.trim());
  if (!match) throw new Error(`fake db: unsupported orderBy: ${sql}`);
  const key = dbNameToKey[match[1] as string];
  if (!key) throw new Error(`fake db: unknown column: ${match[1]}`);
  return { key, dir: match[2] === "desc" ? -1 : 1 };
}

function applyDefaults(values: InsertValues): Row {
  const row: Record<string, unknown> = { ...values };
  for (const [key, col] of Object.entries(columns)) {
    if (row[key] !== undefined) continue;
    if (col.defaultFn) row[key] = col.defaultFn();
    else if (col.hasDefault) row[key] = col.default;
  }
  return row as Row;
}

function findConflict(rows: Row[], candidate: Row): boolean {
  return rows.some(
    (r) =>
      r.id !== candidate.id &&
      r.userId === candidate.userId &&
      r.name === candidate.name,
  );
}

class SelectBuilder {
  private _where: unknown;
  private _orderBy: unknown[] = [];
  private _limitN: number | undefined;

  constructor(
    private rows: Row[],
    private selection?: Record<string, unknown>,
  ) {}

  from(_table: unknown) {
    return this;
  }

  where(condition: unknown) {
    this._where = condition;
    return this;
  }

  orderBy(...cols: unknown[]) {
    this._orderBy = cols;
    return this;
  }

  limit(n: number) {
    this._limitN = n;
    return this;
  }

  private exec(): unknown[] {
    let filtered = this.rows.filter((r) => matches(r, this._where));

    if (this.selection) {
      const aggEntry = Object.entries(this.selection).find(([, v]) =>
        isAggregate(v),
      );
      if (aggEntry) return [{ [aggEntry[0]]: filtered.length }];
    }

    if (this._orderBy.length > 0) {
      const specs = this._orderBy.map(parseOrderBy);
      filtered = [...filtered].sort((a, b) => {
        for (const { key, dir } of specs) {
          const av = (a as Record<string, unknown>)[key] as
            | string
            | number
            | Date;
          const bv = (b as Record<string, unknown>)[key] as
            | string
            | number
            | Date;
          if (av === bv) continue;
          return av > bv ? dir : -dir;
        }
        return 0;
      });
    }

    if (this._limitN !== undefined) filtered = filtered.slice(0, this._limitN);

    if (!this.selection) return filtered.map((r) => ({ ...r }));
    return filtered.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(
        this.selection as Record<string, unknown>,
      )) {
        if (isColumnRef(field)) {
          out[key] = (r as Record<string, unknown>)[
            dbNameToKey[field.name] as string
          ];
        }
      }
      return out;
    });
  }

  // biome-ignore lint/suspicious/noThenProperty: 故意实现 thenable 以模拟 drizzle 惰性查询链
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?:
      | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
}

function createFakeDb() {
  const rows: Row[] = [];

  return {
    select(selection?: Record<string, unknown>) {
      return new SelectBuilder(rows, selection);
    },
    insert(_table: unknown) {
      return {
        async values(data: InsertValues | InsertValues[]) {
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const withDefaults = applyDefaults(item);
            if (findConflict(rows, withDefaults)) {
              throw new Error(uniqueMessage());
            }
            rows.push(withDefaults);
          }
        },
      };
    },
    update(_table: unknown) {
      return {
        set(patch: Partial<Row>) {
          return {
            async where(condition: unknown) {
              const targets = rows.filter((r) => matches(r, condition));
              for (const target of targets) {
                const candidate = { ...target, ...patch };
                if (findConflict(rows, candidate)) {
                  throw new Error(uniqueMessage());
                }
              }
              for (const target of targets) Object.assign(target, patch);
            },
          };
        },
      };
    },
    delete(_table: unknown) {
      return {
        async where(condition: unknown) {
          for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row && matches(row, condition)) rows.splice(i, 1);
          }
        },
      };
    },
    _rows: rows,
  };
}

type FakeDb = ReturnType<typeof createFakeDb>;

function createContext(
  db: FakeDb,
  overrides: { userId?: string; extraEnv?: Record<string, string> } = {},
) {
  const userId = overrides.userId ?? "user-1";
  return {
    auth: {
      api: {
        getSession: vi.fn().mockResolvedValue({ user: { id: userId } }),
      },
    },
    headers: new Headers(),
    env: {},
    db,
  };
}

const validInput = {
  name: "my-skill",
  description: "does a thing",
  body: "# instructions",
};

describe("skillsRouter CRUD", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = createFakeDb();
  });

  it("creates a skill and reads it back via list/get; list omits body", async () => {
    const caller = skillsRouter.createCaller(createContext(db) as never);

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
    const callerA = skillsRouter.createCaller(
      createContext(db, { userId: "user-1" }) as never,
    );
    const callerB = skillsRouter.createCaller(
      createContext(db, { userId: "user-2" }) as never,
    );

    await callerA.create(validInput);

    await expect(callerA.create(validInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    await expect(callerB.create(validInput)).resolves.toMatchObject({
      id: expect.any(String),
    });
  });

  it("updates name/enabled and advances updatedAt; renaming into a collision is rejected", async () => {
    const caller = skillsRouter.createCaller(createContext(db) as never);

    const { id } = await caller.create(validInput);
    await caller.create({ ...validInput, name: "other-skill" });

    // 秒级/毫秒级 timestamp 同一时刻更新可能相等，先把它拨到过去再更新
    const row = db._rows.find((r) => r.id === id);
    if (!row) throw new Error("seed row missing");
    const past = new Date(Date.now() - 60_000);
    row.updatedAt = past;

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
    const callerA = skillsRouter.createCaller(
      createContext(db, { userId: "user-1" }) as never,
    );
    const callerB = skillsRouter.createCaller(
      createContext(db, { userId: "user-2" }) as never,
    );

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
  let db: FakeDb;

  beforeEach(() => {
    (
      import.meta.env as unknown as Record<string, string | undefined>
    ).VITE_ENABLE_REVIEW_GUEST = "1";
    db = createFakeDb();
  });

  afterEach(() => {
    (
      import.meta.env as unknown as Record<string, string | undefined>
    ).VITE_ENABLE_REVIEW_GUEST = undefined;
  });

  it("allows reads but forbids create/update/delete for the review-guest session", async () => {
    const guestCaller = skillsRouter.createCaller(
      createContext(db, { userId: REVIEW_GUEST_USER_ID }) as never,
    );
    const ownerCaller = skillsRouter.createCaller(
      createContext(db, { userId: REVIEW_GUEST_USER_ID }) as never,
    );
    // 先用一个非 guest 会话种一条数据（review-guest 场景下 create 本就该被挡）
    void ownerCaller;

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
    const normalCaller = skillsRouter.createCaller(
      createContext(db, { userId: "user-1" }) as never,
    );
    await expect(normalCaller.create(validInput)).resolves.toMatchObject({
      id: expect.any(String),
    });
  });
});

describe("skillsRouter per-user skill limit", () => {
  it("rejects the 51st skill with PRECONDITION_FAILED", async () => {
    const db = createFakeDb();
    const caller = skillsRouter.createCaller(createContext(db) as never);

    const seed: InsertValues[] = Array.from({ length: 50 }, (_, i) => ({
      userId: "user-1",
      name: `skill-${i}`,
      description: "seed",
      body: "seed body",
    }));
    // 直接批量灌库，绕过 tRPC 更快；生产 D1 的绑定参数上限在真实迁移脚本里另有处理
    await db.insert(null).values(seed);

    await expect(
      caller.create({ ...validInput, name: "one-too-many" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
