/**
 * listConversations 的两个派生字段。跑在真 SQLite（见 test/helpers/sqlite-d1）：
 * json_each / json_extract 的行为与关联子查询的相关性只有真引擎跑一遍才算数，
 * mock 链看不见「末条是纯工具调用时要往前找」这类语义。
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  conversationMembers,
  conversationMessages,
  conversations,
  user,
} from "#/db/schema";
import { createTestDb } from "../../../../test/helpers/sqlite-d1";
import { assistantRouter } from "./assistant";

type Db = ReturnType<typeof createTestDb>["db"];

function makeCaller(db: Db, userId: string) {
  const ctx = {
    db,
    headers: new Headers(),
    env: {},
    auth: { api: { getSession: async () => ({ user: { id: userId } }) } },
  };
  return assistantRouter.createCaller(ctx as never);
}

async function seedUser(db: Db, id: string) {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedConversation(db: Db, id: string, userId: string) {
  const now = new Date();
  await db.insert(conversations).values({
    id,
    type: "agent",
    title: id,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(conversationMembers)
    .values({ conversationId: id, userId, role: "owner" });
}

async function seedMessage(
  db: Db,
  conversationId: string,
  senderType: "user" | "assistant",
  parts: unknown[],
  createdAt: Date,
) {
  await db.insert(conversationMessages).values({
    id: `${conversationId}-${createdAt.getTime()}`,
    conversationId,
    senderType,
    senderId: senderType === "user" ? "u1" : null,
    parts,
    createdAt,
  });
}

describe("listConversations 派生字段", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb().db;
    await seedUser(db, "u1");
  });

  it("返回消息数与末条消息的正文", async () => {
    await seedConversation(db, "c1", "u1");
    await seedMessage(
      db,
      "c1",
      "user",
      [{ type: "text", text: "帮我找扩散模型的论文" }],
      new Date(1000),
    );
    await seedMessage(
      db,
      "c1",
      "assistant",
      [{ type: "text", text: "已经加进你的库了，共 6 篇" }],
      new Date(2000),
    );

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.messageCount).toBe(2);
    expect(row?.lastMessageText).toBe("已经加进你的库了，共 6 篇");
  });

  it("末条是纯工具调用时往前找到有正文的那条", async () => {
    await seedConversation(db, "c1", "u1");
    await seedMessage(
      db,
      "c1",
      "assistant",
      [{ type: "text", text: "这就去查" }],
      new Date(1000),
    );
    await seedMessage(
      db,
      "c1",
      "assistant",
      [{ type: "tool-searchNews", state: "output-available" }],
      new Date(2000),
    );

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.messageCount).toBe(2);
    expect(row?.lastMessageText).toBe("这就去查");
  });

  it("空白 text part 不算正文", async () => {
    await seedConversation(db, "c1", "u1");
    await seedMessage(
      db,
      "c1",
      "assistant",
      [{ type: "text", text: "有内容" }],
      new Date(1000),
    );
    await seedMessage(
      db,
      "c1",
      "assistant",
      [{ type: "text", text: "   " }],
      new Date(2000),
    );

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.lastMessageText).toBe("有内容");
  });

  it("一条消息都没有时计数为 0、正文为 null", async () => {
    await seedConversation(db, "c1", "u1");

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.messageCount).toBe(0);
    expect(row?.lastMessageText).toBeNull();
  });

  it("正文超长时截到 120 字符", async () => {
    await seedConversation(db, "c1", "u1");
    await seedMessage(
      db,
      "c1",
      "assistant",
      [{ type: "text", text: "a".repeat(300) }],
      new Date(1000),
    );

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.lastMessageText).toHaveLength(120);
  });

  it("两个会话的计数与末条正文互不串台", async () => {
    // 关联子查询丢失相关性（`where ... = conversations.id` 退化成恒真）这类 bug，
    // 单会话场景结构上测不出来：只有一个会话时结果照样是对的。必须两个会话对照。
    const now = new Date();
    await seedConversation(db, "c1", "u1");
    await seedConversation(db, "c2", "u1");
    // 给两个会话不同的 updatedAt，让 listConversations 的排序确定，避免依赖数组下标。
    await db
      .update(conversations)
      .set({ updatedAt: new Date(now.getTime() - 60_000) })
      .where(eq(conversations.id, "c1"));
    await db
      .update(conversations)
      .set({ updatedAt: now })
      .where(eq(conversations.id, "c2"));

    await seedMessage(
      db,
      "c1",
      "user",
      [{ type: "text", text: "c1 第一条" }],
      new Date(1000),
    );
    await seedMessage(
      db,
      "c1",
      "assistant",
      [{ type: "text", text: "X" }],
      new Date(2000),
    );
    await seedMessage(
      db,
      "c2",
      "user",
      [{ type: "text", text: "Y" }],
      new Date(1500),
    );

    const rows = await makeCaller(db, "u1").listConversations();
    const row1 = rows.find((r) => r.id === "c1");
    const row2 = rows.find((r) => r.id === "c2");

    expect(row1?.messageCount).toBe(2);
    expect(row1?.lastMessageText).toBe("X");
    expect(row2?.messageCount).toBe(1);
    expect(row2?.lastMessageText).toBe("Y");
  });

  it("一条消息含多个 text part 时取第一段", async () => {
    await seedConversation(db, "c1", "u1");
    await seedMessage(
      db,
      "c1",
      "assistant",
      [
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段" },
      ],
      new Date(1000),
    );

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.lastMessageText).toBe("第一段");
  });
});
