import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { creditTransactions, papers as papersTable, user } from "#/db/schema";
import type { PaperQueueMessage } from "#/integrations/trpc/init";
import type { Env } from "#/types/env";
import { createTestDb } from "../../test/helpers/sqlite-d1";
import queueConsumer, {
  isRetryableError,
  UserApiConfigError,
} from "./queue-consumer";

const DEAD_LETTER_REASON =
  "processing aborted: queue retries exhausted (worker likely killed by resource limits)";

const NOW = new Date("2026-08-24T00:00:00Z");

type Db = ReturnType<typeof createTestDb>["db"];

function fakeMessage(body: PaperQueueMessage) {
  return {
    id: `msg-${body.paperId}`,
    timestamp: NOW,
    body,
    attempts: 4,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function fakeDlqBatch(bodies: PaperQueueMessage[]) {
  const messages = bodies.map(fakeMessage);
  return {
    batch: {
      queue: "paper-processing-dlq",
      messages,
      ackAll: vi.fn(),
      retryAll: vi.fn(),
      // biome-ignore lint/suspicious/noExplicitAny: test double, matches MessageBatch shape loosely
    } as any,
    messages,
  };
}

async function seedUser(db: Db, id: string, credits: number) {
  await db.insert(user).values({
    id,
    name: id,
    email: `${id}@example.com`,
    credits,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function seedPaper(
  db: Db,
  row: {
    id: string;
    userId: string;
    status:
      | "pending"
      | "parsing"
      | "processing_text"
      | "processing_image"
      | "completed"
      | "failed";
    whiteboardRegenerating?: boolean;
    deletedAt?: Date;
  },
) {
  await db.insert(papersTable).values({
    id: row.id,
    shortId: `sid-${row.id}`,
    userId: row.userId,
    title: `Paper ${row.id}`,
    sourceType: "arxiv",
    pdfR2Key: `papers/${row.id}.pdf`,
    fileSize: 1,
    status: row.status,
    whiteboardRegenerating: row.whiteboardRegenerating ?? false,
    deletedAt: row.deletedAt ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function fetchPaper(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(papersTable)
    .where(eq(papersTable.id, id));
  if (!row) throw new Error(`paper ${id} not found`);
  return row;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("queue() routing to DLQ handler", () => {
  it("batch.queue === paper-processing-dlq 走 handleDeadLetterBatch,不当作普通消息处理", async () => {
    const { db, d1 } = createTestDb();
    await seedUser(db, "u1", 5);
    await seedPaper(db, { id: "p1", userId: "u1", status: "processing_text" });
    const env = { DB: d1 } as unknown as Env;

    const { batch, messages } = fakeDlqBatch([
      { paperId: "p1", userId: "u1", generateWhiteboard: true },
    ]);

    await queueConsumer.queue(batch, env);

    const row = await fetchPaper(db, "p1");
    expect(row.status).toBe("failed");
    expect(row.errorMessage).toBe(DEAD_LETTER_REASON);
    expect(messages[0].ack).toHaveBeenCalledTimes(1);
    expect(messages[0].retry).not.toHaveBeenCalled();
  });
});

describe("handleDeadLetterBatch", () => {
  it("在途论文(processing_text) + generateWhiteboard 且无 apiConfigId → 标 failed 写真实原因,退 1 credit,写 refund 流水,消息 ack", async () => {
    const { db, d1 } = createTestDb();
    await seedUser(db, "u1", 5);
    await seedPaper(db, { id: "p1", userId: "u1", status: "processing_text" });
    const env = { DB: d1 } as unknown as Env;

    const { batch, messages } = fakeDlqBatch([
      {
        paperId: "p1",
        userId: "u1",
        generateWhiteboard: true,
        // apiConfigId 缺省 = 未使用 BYOK,视为「已扣费」
      },
    ]);

    await queueConsumer.queue(batch, env);

    const paper = await fetchPaper(db, "p1");
    expect(paper.status).toBe("failed");
    expect(paper.errorMessage).toBe(DEAD_LETTER_REASON);

    const [refreshedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, "u1"));
    expect(refreshedUser?.credits).toBe(6);

    const txs = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.relatedPaperId, "p1"));
    expect(txs).toHaveLength(1);
    expect(txs[0]?.type).toBe("refund");
    expect(txs[0]?.amount).toBe(1);

    expect(messages[0].ack).toHaveBeenCalledTimes(1);
    expect(messages[0].retry).not.toHaveBeenCalled();
  });

  it("已 completed 的论文不受影响(终态行绝不覆盖),消息照常 ack", async () => {
    const { db, d1 } = createTestDb();
    await seedUser(db, "u1", 5);
    await seedPaper(db, { id: "p1", userId: "u1", status: "completed" });
    const env = { DB: d1 } as unknown as Env;

    const { batch, messages } = fakeDlqBatch([
      { paperId: "p1", userId: "u1", generateWhiteboard: true },
    ]);

    await queueConsumer.queue(batch, env);

    const paper = await fetchPaper(db, "p1");
    expect(paper.status).toBe("completed");
    expect(paper.errorMessage).toBeNull();

    const [refreshedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, "u1"));
    expect(refreshedUser?.credits).toBe(5);

    expect(messages[0].ack).toHaveBeenCalledTimes(1);
    expect(messages[0].retry).not.toHaveBeenCalled();
  });

  it("regenerate_whiteboard 消息:不改 papers.status,只清 whiteboardRegenerating,消息 ack", async () => {
    const { db, d1 } = createTestDb();
    await seedUser(db, "u1", 5);
    await seedPaper(db, {
      id: "p1",
      userId: "u1",
      status: "completed",
      whiteboardRegenerating: true,
    });
    const env = { DB: d1 } as unknown as Env;

    const { batch, messages } = fakeDlqBatch([
      { paperId: "p1", userId: "u1", type: "regenerate_whiteboard" },
    ]);

    await queueConsumer.queue(batch, env);

    const paper = await fetchPaper(db, "p1");
    expect(paper.status).toBe("completed");
    expect(paper.whiteboardRegenerating).toBe(false);

    // regenerate 消息从不经 markPaperFailedForMessage,不应产生任何 credit 流水
    const txs = await db.select().from(creditTransactions);
    expect(txs).toHaveLength(0);

    expect(messages[0].ack).toHaveBeenCalledTimes(1);
    expect(messages[0].retry).not.toHaveBeenCalled();
  });

  it("论文行缺失:不抛错,不写库,消息照常 ack", async () => {
    const { db, d1 } = createTestDb();
    await seedUser(db, "u1", 5);
    const env = { DB: d1 } as unknown as Env;

    const { batch, messages } = fakeDlqBatch([
      { paperId: "missing", userId: "u1", generateWhiteboard: true },
    ]);

    await expect(queueConsumer.queue(batch, env)).resolves.toBeUndefined();

    expect(messages[0].ack).toHaveBeenCalledTimes(1);
    expect(messages[0].retry).not.toHaveBeenCalled();
    void db; // 无对应行可查,仅断言未抛错 + ack
  });

  it("同批次里一条消息体畸形(null)不拖累其余健康消息:畸形消息 retry,健康消息照常 ack 且被正确标 failed", async () => {
    const { db, d1 } = createTestDb();
    await seedUser(db, "u1", 5);
    await seedPaper(db, { id: "p1", userId: "u1", status: "processing_text" });
    const env = { DB: d1 } as unknown as Env;

    const poisonMessage = {
      id: "msg-poison",
      timestamp: NOW,
      // biome-ignore lint/suspicious/noExplicitAny: 故意构造畸形消息体
      body: null as any,
      attempts: 4,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const healthyMessage = fakeMessage({
      paperId: "p1",
      userId: "u1",
      generateWhiteboard: true,
    });

    const batch = {
      queue: "paper-processing-dlq",
      messages: [poisonMessage, healthyMessage],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
      // biome-ignore lint/suspicious/noExplicitAny: test double, matches MessageBatch shape loosely
    } as any;

    await expect(queueConsumer.queue(batch, env)).resolves.toBeUndefined();

    expect(poisonMessage.retry).toHaveBeenCalledTimes(1);
    expect(poisonMessage.ack).not.toHaveBeenCalled();

    expect(healthyMessage.ack).toHaveBeenCalledTimes(1);
    expect(healthyMessage.retry).not.toHaveBeenCalled();

    const paper = await fetchPaper(db, "p1");
    expect(paper.status).toBe("failed");
    expect(paper.errorMessage).toBe(DEAD_LETTER_REASON);
  });
});

describe("isRetryableError", () => {
  it("R2 内部错误 (10001) 判为可重试：put 场景", () => {
    expect(
      isRetryableError(
        new Error(
          "put: We encountered an internal error. Please try again. (10001)",
        ),
      ),
    ).toBe(true);
  });

  it("R2 内部错误 (10001) 判为可重试：get 场景", () => {
    expect(
      isRetryableError(
        new Error(
          "get: We encountered an internal error. Please try again. (10001)",
        ),
      ),
    ).toBe(true);
  });

  it("仅含错误码 (10001)、不含内部错误文案 也判为可重试", () => {
    expect(
      isRetryableError(new Error("put: unexpected response (10001)")),
    ).toBe(true);
  });

  it("仅含内部错误文案、不含错误码 也判为可重试", () => {
    expect(
      isRetryableError(
        new Error("put: We encountered an internal error. Please try again."),
      ),
    ).toBe(true);
  });

  it("非匹配错误判为不可重试", () => {
    expect(isRetryableError(new Error("Invalid PDF structure"))).toBe(false);
  });

  it("UserApiConfigError 判为不可重试", () => {
    expect(isRetryableError(new UserApiConfigError("x"))).toBe(false);
  });

  it("既有正例：网络超时仍判为可重试", () => {
    expect(isRetryableError(new Error("Request timed out: ETIMEDOUT"))).toBe(
      true,
    );
  });

  it("既有正例：5xx 仍判为可重试", () => {
    expect(isRetryableError(new Error("HTTP 503 Service Unavailable"))).toBe(
      true,
    );
  });
});
