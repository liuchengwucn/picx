// upsertCandidatesSeen 的落库语义，跑在真 SQLite 上（json_patch 是 SQL 侧行为，
// mock 链看不见）。核心不变式：source_meta 是多方共写的口袋，重新见到一条候选
// 只能合并自己那几个键，不能整份写回。
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { directionCandidates, directions } from "#/db/schema";
import { createTestDb } from "../../../test/helpers/sqlite-d1";
import { upsertCandidatesSeen } from "./store";
import type { CandidateItem } from "./types";

const DIRECTION_ID = "dir-test";
const URL_A = "https://example.com/posts/a";

let db: ReturnType<typeof createTestDb>["db"];

function candidate(over: Partial<CandidateItem> = {}): CandidateItem {
  return {
    canonicalUrl: URL_A,
    title: "A post",
    kind: "intel",
    sourceLabel: "src-a",
    ...over,
  };
}

async function readRow() {
  const rows = await db
    .select()
    .from(directionCandidates)
    .where(
      and(
        eq(directionCandidates.directionId, DIRECTION_ID),
        eq(directionCandidates.canonicalUrl, URL_A),
      ),
    );
  expect(rows).toHaveLength(1);
  return rows[0];
}

beforeEach(async () => {
  db = createTestDb().db;
  await db.insert(directions).values({
    id: DIRECTION_ID,
    slug: "test-direction",
    name: { "zh-cn": "测试方向" },
    focusBrief: "当前关注：测试。",
  });
});

describe("upsertCandidatesSeen", () => {
  it("writes sourceLabel and publishedAt on first sighting", async () => {
    await upsertCandidatesSeen(db, DIRECTION_ID, [
      candidate({ publishedAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    const row = await readRow();
    expect(row.status).toBe("seen");
    expect(row.kind).toBe("intel");
    expect(row.sourceMeta).toEqual({
      sourceLabel: "src-a",
      publishedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("keeps sourceMeta keys written by other stages when the candidate is seen again", async () => {
    await upsertCandidatesSeen(db, DIRECTION_ID, [
      candidate({ publishedAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    // 精读阶段往同一个口袋里写标注（本行模拟 hardRule 影子判定的写入）
    await db
      .update(directionCandidates)
      .set({
        sourceMeta: {
          sourceLabel: "src-a",
          publishedAt: "2026-08-01T00:00:00.000Z",
          hardRule: { verdict: "fail", note: "toy scale" },
        },
      })
      .where(eq(directionCandidates.canonicalUrl, URL_A));

    await upsertCandidatesSeen(db, DIRECTION_ID, [
      candidate({
        sourceLabel: "angle-2",
        publishedAt: "2026-08-08T00:00:00.000Z",
      }),
    ]);

    expect((await readRow()).sourceMeta).toEqual({
      sourceLabel: "angle-2",
      publishedAt: "2026-08-08T00:00:00.000Z",
      hardRule: { verdict: "fail", note: "toy scale" },
    });
  });

  it("does not drop an existing publishedAt when the new sighting has none", async () => {
    await upsertCandidatesSeen(db, DIRECTION_ID, [
      candidate({ publishedAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    // 同一条目被另一个无日期的来源再次命中：日期是 4b 解析步花钱换来的，不能被抹掉
    await upsertCandidatesSeen(db, DIRECTION_ID, [
      candidate({ sourceLabel: "angle-2" }),
    ]);
    expect((await readRow()).sourceMeta).toEqual({
      sourceLabel: "angle-2",
      publishedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("refreshes lastSeenAt without moving firstSeenAt or resetting status", async () => {
    await upsertCandidatesSeen(db, DIRECTION_ID, [candidate()]);
    const first = await readRow();
    await db
      .update(directionCandidates)
      .set({ status: "rejected" })
      .where(eq(directionCandidates.canonicalUrl, URL_A));

    await upsertCandidatesSeen(db, DIRECTION_ID, [candidate()]);
    const again = await readRow();
    expect(again.firstSeenAt).toEqual(first.firstSeenAt);
    expect(again.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      first.lastSeenAt.getTime(),
    );
    // 重新见到不等于重新参评：状态由评审步改，入池这一步不许碰
    expect(again.status).toBe("rejected");
  });

  it("is idempotent across repeated runs (replay safety)", async () => {
    const items = [candidate(), candidate({ canonicalUrl: `${URL_A}-2` })];
    await upsertCandidatesSeen(db, DIRECTION_ID, items);
    await upsertCandidatesSeen(db, DIRECTION_ID, items);
    const rows = await db
      .select()
      .from(directionCandidates)
      .where(eq(directionCandidates.directionId, DIRECTION_ID));
    expect(rows).toHaveLength(2);
  });
});
