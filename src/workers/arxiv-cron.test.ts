import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { papers as papersTable, user } from "#/db/schema";
import { createTestDb } from "../../test/helpers/sqlite-d1";
import {
  type HFPaper,
  intFromEnv,
  resolveSelection,
  selectPapers,
  sweepStalePapers,
} from "./arxiv-cron";

function mk(id: string, upvotes: number): HFPaper {
  return { paper: { id, title: `Paper ${id}`, upvotes } };
}

// 打乱的输入：同时验证返回值按 upvotes 降序
const papers: HFPaper[] = [
  mk("a", 40),
  mk("b", 120),
  mk("c", 5),
  mk("d", 50),
  mk("e", 10),
];

const ids = (list: HFPaper[]) => list.map((p) => p.paper.id);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selectPapers - 旧逻辑等价（默认 30/3）", () => {
  it("取所有 upvotes >= 30 的论文，按 upvotes 降序", () => {
    const selected = selectPapers(papers, 30, 3);
    expect(ids(selected)).toEqual(["b", "d", "a"]);
    expect(selected.map((p) => p.paper.upvotes)).toEqual([120, 50, 40]);
  });

  it("阈值是闭区间：upvotes 恰等于阈值算过线", () => {
    const onBoundary = [mk("hit", 30), mk("miss", 29), mk("x", 1), mk("y", 2)];
    expect(ids(selectPapers(onBoundary, 30, 0))).toEqual(["hit"]);
    const atHundred = [mk("hit", 100), mk("miss", 99)];
    expect(ids(selectPapers(atHundred, 100, 0))).toEqual(["hit"]);
  });

  it("过线不足 3 篇时补到 top-3", () => {
    // 阈值 100 只有 b 过线，不足 3 篇 → 退化为 top-3
    const selected = selectPapers(papers, 100, 3);
    expect(ids(selected)).toEqual(["b", "d", "a"]);
  });

  it("全部低于阈值时补到 top-3", () => {
    const allLow = [mk("x", 1), mk("y", 9), mk("z", 3), mk("w", 7)];
    expect(ids(selectPapers(allLow, 30, 3))).toEqual(["y", "w", "z"]);
  });

  it("输入少于 3 篇时全部返回且不报错", () => {
    const few = [mk("x", 2), mk("y", 8)];
    expect(ids(selectPapers(few, 30, 3))).toEqual(["y", "x"]);
    expect(selectPapers([], 30, 3)).toEqual([]);
  });

  it("不修改入参数组（导出的函数不该改动调用方传进来的数组）", () => {
    const input = [mk("a", 40), mk("b", 120), mk("c", 5)];
    const snapshot = ids(input);
    selectPapers(input, 30, 3);
    expect(ids(input)).toEqual(snapshot);
  });
});

describe("selectPapers - 切换终态（100/0）", () => {
  it("只取过线的爆款", () => {
    expect(ids(selectPapers(papers, 100, 0))).toEqual(["b"]);
  });

  it("无人过线时返回空数组，不补底", () => {
    const allLow = [mk("x", 99), mk("y", 30), mk("z", 3)];
    expect(selectPapers(allLow, 100, 0)).toEqual([]);
  });
});

describe("resolveSelection", () => {
  it("未配置任何 env 时 = 旧逻辑 30/3（部署即零变化）", () => {
    expect(resolveSelection({})).toEqual({ minUpvotes: 30, topFallback: 3 });
  });

  it("切换终态：100/0", () => {
    expect(
      resolveSelection({ HF_MIN_UPVOTES: "100", HF_TOP_FALLBACK: "0" }),
    ).toEqual({ minUpvotes: 100, topFallback: 0 });
  });

  it("只设其中一个时，另一个吃默认", () => {
    expect(resolveSelection({ HF_MIN_UPVOTES: "80" })).toEqual({
      minUpvotes: 80,
      topFallback: 3,
    });
    expect(resolveSelection({ HF_TOP_FALLBACK: "0" })).toEqual({
      minUpvotes: 30,
      topFallback: 0,
    });
  });

  it("非法值回落默认", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveSelection({ HF_MIN_UPVOTES: "abc", HF_TOP_FALLBACK: "-2" }),
    ).toEqual({ minUpvotes: 30, topFallback: 3 });
  });
});

describe("sweepStalePapers", () => {
  // 跑在真 SQLite 上：谓词（在途状态 × 24h × 未软删）是 WHERE 里的事，
  // mock 链看不见；先数再写的计数正确性也要 SQL 真跑一遍才能验。
  const NOW = new Date("2026-08-18T12:00:00Z");
  const STALE = new Date(NOW.getTime() - 25 * 60 * 60 * 1000); // 超 24h
  const FRESH = new Date(NOW.getTime() - 1 * 60 * 60 * 1000); // 24h 内

  type Db = ReturnType<typeof createTestDb>["db"];

  async function seed(
    db: Db,
    rows: Array<{
      id: string;
      status:
        | "pending"
        | "parsing"
        | "processing_text"
        | "processing_image"
        | "completed"
        | "failed";
      updatedAt: Date;
      deletedAt?: Date;
      errorMessage?: string;
    }>,
  ) {
    await db.insert(user).values({
      id: "u1",
      name: "u1",
      email: "u1@example.com",
      createdAt: NOW,
      updatedAt: NOW,
    });
    for (const row of rows) {
      await db.insert(papersTable).values({
        id: row.id,
        shortId: `sid-${row.id}`,
        userId: "u1",
        title: `Paper ${row.id}`,
        sourceType: "arxiv",
        pdfR2Key: `papers/${row.id}.pdf`,
        fileSize: 1,
        status: row.status,
        errorMessage: row.errorMessage ?? null,
        deletedAt: row.deletedAt ?? null,
        createdAt: STALE,
        updatedAt: row.updatedAt,
      });
    }
  }

  async function fetchPaper(db: Db, id: string) {
    const [row] = await db
      .select({
        status: papersTable.status,
        errorMessage: papersTable.errorMessage,
        updatedAt: papersTable.updatedAt,
      })
      .from(papersTable)
      .where(eq(papersTable.id, id));
    if (!row) throw new Error(`paper ${id} not found`);
    return row;
  }

  it("超 24h 的各在途状态行被标 failed 并写入 errorMessage", async () => {
    const { db } = createTestDb();
    await seed(db, [
      { id: "p-pending", status: "pending", updatedAt: STALE },
      { id: "p-parsing", status: "parsing", updatedAt: STALE },
      { id: "p-text", status: "processing_text", updatedAt: STALE },
      { id: "p-image", status: "processing_image", updatedAt: STALE },
    ]);

    expect(await sweepStalePapers(db, NOW)).toBe(4);

    for (const id of ["p-pending", "p-parsing", "p-text", "p-image"]) {
      const row = await fetchPaper(db, id);
      expect(row.status).toBe("failed");
      expect(row.errorMessage).toBe("stale watchdog: stuck in processing >24h");
      expect(row.updatedAt.getTime()).toBe(NOW.getTime());
    }
  });

  it("24h 内在途行、completed/failed 行、已软删行都不受影响", async () => {
    const { db } = createTestDb();
    await seed(db, [
      { id: "p-fresh", status: "processing_text", updatedAt: FRESH },
      { id: "p-completed", status: "completed", updatedAt: STALE },
      {
        id: "p-failed",
        status: "failed",
        updatedAt: STALE,
        errorMessage: "original failure",
      },
      {
        id: "p-deleted",
        status: "pending",
        updatedAt: STALE,
        deletedAt: STALE,
      },
    ]);

    expect(await sweepStalePapers(db, NOW)).toBe(0);

    const fresh = await fetchPaper(db, "p-fresh");
    expect(fresh.status).toBe("processing_text");
    expect(fresh.errorMessage).toBeNull();
    expect(fresh.updatedAt.getTime()).toBe(FRESH.getTime());

    expect((await fetchPaper(db, "p-completed")).status).toBe("completed");
    // 已 failed 行的 errorMessage 不能被 watchdog 覆盖掉真实失败原因
    expect((await fetchPaper(db, "p-failed")).errorMessage).toBe(
      "original failure",
    );
    const deleted = await fetchPaper(db, "p-deleted");
    expect(deleted.status).toBe("pending");
    expect(deleted.updatedAt.getTime()).toBe(STALE.getTime());
  });

  it("混合场景下只清扫命中行且计数正确", async () => {
    const { db } = createTestDb();
    await seed(db, [
      { id: "p-stale-1", status: "pending", updatedAt: STALE },
      { id: "p-stale-2", status: "processing_image", updatedAt: STALE },
      { id: "p-fresh", status: "pending", updatedAt: FRESH },
      { id: "p-done", status: "completed", updatedAt: STALE },
      { id: "p-gone", status: "parsing", updatedAt: STALE, deletedAt: STALE },
    ]);

    expect(await sweepStalePapers(db, NOW)).toBe(2);
    expect((await fetchPaper(db, "p-stale-1")).status).toBe("failed");
    expect((await fetchPaper(db, "p-stale-2")).status).toBe("failed");
    expect((await fetchPaper(db, "p-fresh")).status).toBe("pending");
    expect((await fetchPaper(db, "p-done")).status).toBe("completed");
    expect((await fetchPaper(db, "p-gone")).status).toBe("parsing");
  });

  it("恰好 24h（边界）不算超时，lt 是开区间", async () => {
    const { db } = createTestDb();
    await seed(db, [
      {
        id: "p-exact",
        status: "pending",
        updatedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
      },
    ]);
    expect(await sweepStalePapers(db, NOW)).toBe(0);
    expect((await fetchPaper(db, "p-exact")).status).toBe("pending");
  });
});

describe("intFromEnv", () => {
  it("undefined / 空串 / 纯空白 → fallback", () => {
    expect(intFromEnv(undefined, "HF_MIN_UPVOTES", 30)).toBe(30);
    expect(intFromEnv("", "HF_MIN_UPVOTES", 30)).toBe(30);
    expect(intFromEnv("   ", "HF_MIN_UPVOTES", 30)).toBe(30);
  });

  it("解析合法的非负整数", () => {
    expect(intFromEnv("100", "HF_MIN_UPVOTES", 30)).toBe(100);
    expect(intFromEnv("0", "HF_TOP_FALLBACK", 3)).toBe(0);
  });

  it("非法值 → fallback 并告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const raw of ["abc", "-1", "1.5"]) {
      expect(intFromEnv(raw, "HF_MIN_UPVOTES", 30)).toBe(30);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0]?.[0]).toContain("HF_MIN_UPVOTES");
    expect(warn.mock.calls[0]?.[0]).toContain("abc");
  });
});
