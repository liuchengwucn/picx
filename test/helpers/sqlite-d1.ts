/**
 * 测试用的真 SQLite「D1」：把 drizzle-orm/d1 接到 node:sqlite 的内存库上，
 * schema 由 drizzle/ 下的迁移文件真实回放而来。
 *
 * 为什么不用 mock 链：WHERE / JOIN / GROUP BY / 相关子查询这些语义只有让 SQL
 * 真跑一遍才能验证（例如「只暴露 published」是 WHERE 里的事，mock 链看不见）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "#/db/schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle/", import.meta.url));

function applyMigrations(sqlite: DatabaseSync): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(MIGRATIONS_DIR + file, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}

/** 最小 D1Database 表面（drizzle-orm/d1 只用到 prepare/bind/all/raw/run） */
function createD1Client(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      // node:sqlite 的 all() 返回对象，同名列会互相覆盖；drizzle 的 raw() 需要
      // 按 select 顺序取值，所以重名必须显式报错而不是静默错位。
      // columns() 只对返回结果集的语句合法，故延迟到 raw() 里再取。
      const orderedColumns = () => {
        const columns = stmt.columns().map((c) => c.name);
        if (new Set(columns).size !== columns.length) {
          throw new Error(`duplicate column names in select: ${columns.join()}`);
        }
        return columns;
      };
      const bind = (...params: unknown[]) => ({
        all: async () => ({ results: stmt.all(...(params as never[])) }),
        raw: async () => {
          const columns = orderedColumns();
          return stmt
            .all(...(params as never[]))
            .map((row) =>
              columns.map((c) => (row as Record<string, unknown>)[c]),
            );
        },
        first: async () => stmt.get(...(params as never[])) ?? null,
        run: async () => stmt.run(...(params as never[])),
      });
      return { bind, ...bind() };
    },
    batch: async () => {
      throw new Error("batch() is not supported by the sqlite test harness");
    },
  };
}

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: DatabaseSync;
}

/** 新建一个跑完全部迁移的内存库 + drizzle 实例 */
export function createTestDb(): TestDb {
  const sqlite = new DatabaseSync(":memory:");
  applyMigrations(sqlite);
  const db = drizzle(createD1Client(sqlite) as unknown as D1Database, {
    schema,
  });
  return { db, sqlite };
}
