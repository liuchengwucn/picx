/**
 * listConversations 的两个派生字段。跑在真 SQLite（见 test/helpers/sqlite-d1）：
 * json_each / json_extract 的行为与关联子查询的相关性只有真引擎跑一遍才算数，
 * mock 链看不见「末条是纯工具调用时要往前找」这类语义。
 */
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
  await db
    .insert(conversations)
    .values({ id, type: "agent", title: id, createdBy: userId, createdAt: now, updatedAt: now });
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
    await seedMessage(db, "c1", "user", [{ type: "text", text: "帮我找扩散模型的论文" }], new Date(1000));
    await seedMessage(db, "c1", "assistant", [{ type: "text", text: "已经加进你的库了，共 6 篇" }], new Date(2000));

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.messageCount).toBe(2);
    expect(row?.lastMessageText).toBe("已经加进你的库了，共 6 篇");
  });

  it("末条是纯工具调用时往前找到有正文的那条", async () => {
    await seedConversation(db, "c1", "u1");
    await seedMessage(db, "c1", "assistant", [{ type: "text", text: "这就去查" }], new Date(1000));
    await seedMessage(db, "c1", "assistant", [{ type: "tool-searchNews", state: "output-available" }], new Date(2000));

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.messageCount).toBe(2);
    expect(row?.lastMessageText).toBe("这就去查");
  });

  it("空白 text part 不算正文", async () => {
    await seedConversation(db, "c1", "u1");
    await seedMessage(db, "c1", "assistant", [{ type: "text", text: "有内容" }], new Date(1000));
    await seedMessage(db, "c1", "assistant", [{ type: "text", text: "   " }], new Date(2000));

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
    await seedMessage(db, "c1", "assistant", [{ type: "text", text: "a".repeat(300) }], new Date(1000));

    const [row] = await makeCaller(db, "u1").listConversations();

    expect(row?.lastMessageText).toHaveLength(120);
  });
});
