import { beforeEach, describe, expect, it, vi } from "vitest";
import { papers } from "#/db/schema";
import { paperRouter } from "./paper";

function createSelectChain(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
}

function createDbMock(selectResults: unknown[][] = []) {
  const select = vi.fn();

  for (const result of selectResults) {
    select.mockImplementationOnce(() => createSelectChain(result));
  }

  select.mockImplementation(() => createSelectChain([]));

  const insert = vi.fn((table) => ({
    values: vi.fn().mockReturnValue({
      returning: vi
        .fn()
        .mockResolvedValue(
          table === papers ? [{ id: "paper-1", status: "pending" }] : [],
        ),
    }),
  }));

  const update = vi.fn(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "user-1", credits: 9 }]),
      }),
    }),
  }));

  return {
    select,
    insert,
    update,
  };
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: { id: "user-1" },
        }),
      },
    },
    headers: new Headers(),
    env: {
      PAPER_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
      PAPERS_BUCKET: {
        put: vi.fn().mockResolvedValue(undefined),
      },
    },
    db: createDbMock(),
    ...overrides,
  };
}

describe("paperRouter.create security checks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an api config that does not belong to the caller", async () => {
    const ctx = createContext({
      db: createDbMock([[]]),
    });

    const caller = paperRouter.createCaller(ctx as never);

    await expect(
      caller.create({
        sourceType: "upload",
        filename: "paper.pdf",
        fileSize: 8,
        r2Key: "papers/user-1/paper.pdf",
        apiConfigId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "API configuration not found",
    });
  });

  it("rejects an upload r2Key under another user's prefix", async () => {
    // 否则登录用户可以传他人前缀的 key，白嫖解析别人已上传的私有 PDF。
    const ctx = createContext();

    const caller = paperRouter.createCaller(ctx as never);

    await expect(
      caller.create({
        sourceType: "upload",
        filename: "paper.pdf",
        fileSize: 8,
        r2Key: "papers/other-user/x.pdf",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Invalid r2Key",
    });
  });

  it("rejects a prompt template that does not belong to the caller", async () => {
    const ctx = createContext({
      db: createDbMock([[{ id: "cfg-1" }], []]),
    });

    const caller = paperRouter.createCaller(ctx as never);

    await expect(
      caller.create({
        sourceType: "upload",
        filename: "paper.pdf",
        fileSize: 8,
        r2Key: "papers/user-1/paper.pdf",
        apiConfigId: "11111111-1111-4111-8111-111111111111",
        promptId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Prompt template not found",
    });
  });
});

const PAPER_ID = "33333333-3333-4333-8333-333333333333";

describe("paperRouter.getContent access control", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("serves a public paper's full text to anonymous callers", async () => {
    // 段落分享链接的核心前提：公开论文的原文不该被登录墙挡住。
    const ctx = createContext({
      auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
      db: createDbMock([
        [{ id: PAPER_ID, userId: "other-user", isPublic: true }],
        [{ markdownR2Key: "paper-content/x/full.md" }],
      ]),
      env: {
        PAPERS_BUCKET: {
          get: vi.fn().mockResolvedValue({ text: async () => "# hello" }),
        },
      },
    });

    const caller = paperRouter.createCaller(ctx as never);

    await expect(caller.getContent({ paperId: PAPER_ID })).resolves.toEqual({
      available: true,
      markdown: "# hello",
      imageBase: `/api/paper-content/${PAPER_ID}/images/`,
    });
    // 公开路径不该白付一次 session 查库
    expect(ctx.auth.api.getSession).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller on a private paper", async () => {
    const ctx = createContext({
      auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
      db: createDbMock([
        [{ id: PAPER_ID, userId: "other-user", isPublic: false }],
      ]),
    });

    const caller = paperRouter.createCaller(ctx as never);

    await expect(
      caller.getContent({ paperId: PAPER_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a signed-in non-owner on a private paper", async () => {
    const ctx = createContext({
      db: createDbMock([
        [{ id: PAPER_ID, userId: "other-user", isPublic: false }],
      ]),
    });

    const caller = paperRouter.createCaller(ctx as never);

    await expect(
      caller.getContent({ paperId: PAPER_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
