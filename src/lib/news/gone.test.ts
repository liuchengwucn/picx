/**
 * 下架资讯的 410 升级：路径匹配的边界（爬虫试抓的路由模板不该触发查库）、
 * 只有 hidden 才升级、其余 404 一律原样放行。
 */
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../test/helpers/sqlite-d1";
import { goneIfHiddenStory, isHiddenStory, matchNewsStoryPath } from "./gone";

type Db = ReturnType<typeof createTestDb>["db"];

let db: Db;

beforeEach(() => {
  db = createTestDb().db;
});

// 裸 SQL 而不是 db.insert(): centroid 那列的 toDriver 发的是 number[], node:sqlite
// 绑不了数组(真 D1 可以), 而这组用例根本不关心向量 —— 用 blob 字面量绕开。
async function seed(
  shortId: string,
  status: "active" | "archived" | "hidden",
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.run(sql`
    INSERT INTO news_stories
      (id, short_id, title, summary, centroid, first_seen_at, last_activity_at,
       status, created_at, updated_at)
    VALUES
      (${shortId}, ${shortId}, '{"en":"t"}', '{"en":"s"}', X'00000000',
       ${now}, ${now}, ${status}, ${now}, ${now})
  `);
}

function notFoundResponse(): Response {
  return new Response("<html>gone or never existed</html>", {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Kept": "yes" },
  });
}

describe("matchNewsStoryPath", () => {
  it("认得资讯详情页", () => {
    expect(matchNewsStoryPath("/news/jEspUO")).toBe("jEspUO");
    expect(matchNewsStoryPath("/news/px07O4")).toBe("px07O4");
  });

  it("不认路由模板 —— Googlebot 会从 JS 包里挖出这个去试抓", () => {
    expect(matchNewsStoryPath("/news/$shortId")).toBeNull();
    expect(matchNewsStoryPath("/news/:shortId")).toBeNull();
  });

  it("不认列表页、尾斜杠与更深的路径", () => {
    expect(matchNewsStoryPath("/news")).toBeNull();
    expect(matchNewsStoryPath("/news/")).toBeNull();
    expect(matchNewsStoryPath("/news/jEspUO/")).toBeNull();
    expect(matchNewsStoryPath("/news/jEspUO/extra")).toBeNull();
    expect(matchNewsStoryPath("/p/jEspUO")).toBeNull();
  });

  it("长度越界不认", () => {
    expect(matchNewsStoryPath("/news/abc")).toBeNull();
    expect(matchNewsStoryPath("/news/abcdefghijklmnopq")).toBeNull();
  });
});

describe("isHiddenStory", () => {
  it("只对 hidden 为真", async () => {
    await seed("hidden1", "hidden");
    await seed("active1", "active");
    await seed("archiv1", "archived");
    expect(await isHiddenStory(db, "hidden1")).toBe(true);
    expect(await isHiddenStory(db, "active1")).toBe(false);
    expect(await isHiddenStory(db, "archiv1")).toBe(false);
    expect(await isHiddenStory(db, "nobody")).toBe(false);
  });
});

describe("goneIfHiddenStory", () => {
  it("下架的 story 升级成 410，页面本身原样保留", async () => {
    await seed("hidden1", "hidden");
    const gone = await goneIfHiddenStory(
      "/news/hidden1",
      notFoundResponse(),
      db,
    );
    expect(gone?.status).toBe(410);
    expect(await gone?.text()).toBe("<html>gone or never existed</html>");
    // 读者看到的东西不变，变的只有状态码
    expect(gone?.headers.get("X-Kept")).toBe("yes");
    expect(gone?.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("库里没有这条 → 保持 404（以后可能会有）", async () => {
    expect(
      await goneIfHiddenStory("/news/nobody", notFoundResponse(), db),
    ).toBeNull();
  });

  it("还在架上的 story 不升级", async () => {
    await seed("active1", "active");
    expect(
      await goneIfHiddenStory("/news/active1", notFoundResponse(), db),
    ).toBeNull();
  });

  it("非资讯详情页一律放行", async () => {
    await seed("hidden1", "hidden");
    expect(
      await goneIfHiddenStory("/gallery/w/$period", notFoundResponse(), db),
    ).toBeNull();
    expect(
      await goneIfHiddenStory("/news/$shortId", notFoundResponse(), db),
    ).toBeNull();
  });
});
